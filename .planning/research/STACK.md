# Technology Stack: Stripe Payment Integration

**Project:** Frontrun v2.0 - USD Token Purchase
**Researched:** 2026-02-21
**Confidence:** HIGH

---

## Recommended Stack Additions

These are NEW packages to add to the existing stack. The existing Next.js 16 / React 19 / Supabase / Tailwind / shadcn/ui stack remains unchanged.

### Stripe Server SDK

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `stripe` | ^20.3.1 | Server-side Stripe API: create PaymentIntents, verify webhook signatures, manage payment methods | Official Node.js SDK. Used exclusively in server actions and route handlers -- never exposed to the client. Actively maintained, current API version 2026-01-28. Provides `stripe.webhooks.constructEvent()` for webhook signature verification. |

### Stripe Client SDK

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@stripe/stripe-js` | ^8.8.0 | Client-side Stripe.js loader -- async-loads Stripe.js from Stripe CDN, provides TypeScript types | Required peer dependency for `@stripe/react-stripe-js`. Lazy-loads Stripe.js so it does not block page render. Must call `loadStripe()` outside component render to avoid re-creating the Stripe object on every render. |
| `@stripe/react-stripe-js` | ^5.6.0 | React components for Stripe Elements: `<Elements>` provider, `<ExpressCheckoutElement>`, `useStripe()` / `useElements()` hooks | Provides the `<ExpressCheckoutElement>` component that renders Apple Pay / Google Pay buttons. Handles Stripe Elements lifecycle (create, mount, destroy) via React. Compatible with React 19. Eliminates manual DOM mounting. |

### Nothing Else

| Category | Decision | Rationale |
|----------|----------|-----------|
| Payment database table | NOT needed | Token purchases credit the existing `token_ledger` with reason `token_purchase`. The `reference_id` column stores the Stripe PaymentIntent ID for audit trail. No separate purchases table -- the ledger IS the purchase record. A `purchases` table would duplicate what the ledger already provides. |
| State management | NOT needed | Zustand already handles client state. The payment flow is transactional (one-shot), not ongoing state to manage. |
| Form library | NOT needed | Express Checkout Element renders its own UI -- no form fields for the developer to manage. No React Hook Form involvement in payment. |
| CSS / UI library | NOT needed | Stripe Elements render in a Stripe-hosted iframe with their own styles. The surrounding purchase page uses existing shadcn/ui components (`Card`, `Button`, `Badge`). |
| Webhook verification library | NOT needed | The `stripe` SDK includes built-in `stripe.webhooks.constructEvent()` for HMAC signature verification. No third-party library needed. |
| Database migration tool | NOT needed | Supabase CLI already handles migrations. The only schema change is adding `token_purchase` as a valid ledger reason (and optionally a small `purchases` metadata column, but even that is optional since PaymentIntent ID goes in `reference_id`). |

---

## Key Integration Decisions

### PaymentIntents API (NOT Checkout Sessions)

**Decision:** Use PaymentIntents API with the Express Checkout Element.

**Why PaymentIntents over Checkout Sessions:**
- Express Checkout Element renders Apple Pay / Google Pay buttons inline in your UI -- no redirect to a Stripe-hosted page
- Fixed token packs ($5/$10/$20) are simple enough that Checkout Sessions' built-in tax/shipping/discount features add zero value
- PaymentIntents keeps the user in-app, which is critical for the mobile-first experience -- tapping a pack, authenticating with Face ID, and seeing tokens credited should feel instant
- The flow matches the existing app pattern: user action -> server action -> atomic DB update -> Realtime balance push

**When Checkout Sessions WOULD be better:** If we needed a full cart, tax calculation, shipping addresses, or a hosted receipt page. We don't.

### Express Checkout Element (NOT Payment Request Button)

**Decision:** Use `<ExpressCheckoutElement>` from `@stripe/react-stripe-js`.

**Why Express Checkout Element over Payment Request Button:**
- Payment Request Button is legacy -- Stripe explicitly documents a migration path to Express Checkout Element and recommends it for all new integrations
- Express Checkout Element supports Apple Pay, Google Pay, Link, PayPal, Klarna, Amazon Pay -- all from a single `<ExpressCheckoutElement />` component
- Automatically detects and shows only payment methods available on the user's device/browser (Apple Pay on Safari/iOS, Google Pay on Chrome/Android)
- Responsive grid layout that adapts to available space -- works well in the mobile-first card-based purchase UI

### Server Actions for PaymentIntent Creation (NOT API Routes)

**Decision:** Create PaymentIntents via Next.js server actions in `src/lib/payments/actions.ts`.

**Why server actions:**
- Matches the existing codebase pattern -- all mutations are server actions in `src/lib/*/actions.ts`
- The server action creates a PaymentIntent and returns the `clientSecret` directly to the client component
- No need to set up REST endpoints -- the server action handles validation, Stripe API calls, and error handling in one function
- Type-safe with the existing `{ success: true; data } | { success: false; error }` return pattern

### Route Handler for Stripe Webhooks (NOT Server Actions)

**Decision:** Use a Next.js Route Handler at `src/app/api/webhooks/stripe/route.ts`.

**Why a route handler, not a server action:**
- Webhooks are inbound HTTP POST requests from Stripe servers -- they cannot call server actions
- Route Handler is the App Router way to handle inbound HTTP requests
- Must access the raw request body via `request.text()` for webhook signature verification (the raw body must match the HMAC; parsed JSON will not work)
- The webhook handler is the single point where payment confirmation atomically credits tokens to the user's ledger

### Webhook-Driven Token Crediting (NOT Optimistic)

**Decision:** Only credit tokens when the `payment_intent.succeeded` webhook fires.

**Why not optimistic (credit on client confirm):**
- `stripe.confirmPayment()` succeeding on the client means the payment was submitted, not that money moved
- The payment can still fail asynchronously (bank decline, fraud check, insufficient funds)
- The webhook is the only reliable signal that Stripe received the funds
- Double-crediting is worse than a 1-2 second delay -- the append-only ledger has no "undo" mechanism
- The existing `useUserBalance` hook subscribes to Realtime `INSERT` events on `token_ledger`, so the balance updates automatically once the webhook writes the ledger entry

---

## Payment Flow

```
1. User navigates to /purchase (or taps "Buy Tokens" from profile/balance)
2. User selects a token pack ($5 = 500 tokens, $10 = 1100 tokens, $20 = 2500 tokens)
3. Client component calls server action: createPaymentIntent({ packId, userId })
4. Server action:
   a. Validates user is authenticated
   b. Looks up pack tier -> amount in cents (500, 1000, 2000)
   c. Creates Stripe PaymentIntent with:
      - amount: pack price in cents
      - currency: 'usd'
      - metadata: { user_id, pack_id, token_amount }
      - automatic_payment_methods: { enabled: true }
   d. Returns { clientSecret } to client
5. Client initializes <Elements> with clientSecret, mode, amount, currency
6. <ExpressCheckoutElement> renders Apple Pay / Google Pay button
7. User taps button -> biometric auth (Face ID / fingerprint)
8. On 'confirm' event:
   a. elements.submit()
   b. stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url } })
9. Stripe processes payment
10. Stripe fires payment_intent.succeeded webhook -> POST /api/webhooks/stripe
11. Route handler:
    a. Reads raw body via request.text()
    b. Verifies signature with stripe.webhooks.constructEvent()
    c. Extracts user_id, token_amount from event.data.object.metadata
    d. Inserts token_ledger row: { user_id, amount: token_amount, reason: 'token_purchase', reference_id: payment_intent_id }
    e. Returns 200
12. Supabase Realtime pushes INSERT on token_ledger
13. useUserBalance hook re-fetches balance -> UI updates
```

---

## Environment Variables (New)

```env
# Server-side only (never prefix with NEXT_PUBLIC_)
STRIPE_SECRET_KEY=sk_test_...          # Stripe secret key for server-side API calls
STRIPE_WEBHOOK_SECRET=whsec_...        # Webhook endpoint signing secret for signature verification

# Client-side (safe to expose -- this is the publishable key)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...  # Stripe publishable key for Stripe.js initialization
```

Set these in Netlify environment variables (site settings -> environment variables). For local development, add to `.env.local`.

---

## Apple Pay Domain Verification

Apple Pay on the web requires domain registration with Stripe. Without this, Apple Pay buttons will not appear on iOS/macOS.

**Steps:**
1. Register `frontrun.bet` in Stripe Dashboard -> Settings -> Payment Methods -> Domains
2. Stripe provides a verification file
3. Host the file at `public/.well-known/apple-developer-merchantid-domain-association` (Next.js serves files from `public/` statically)
4. Register the domain in both test mode and live mode
5. Verify it works by loading the page on an iPhone with a card in Apple Wallet

**Google Pay:** No domain registration required. Google Pay appears automatically on Chrome/Android when the user has a card saved in Google Pay.

---

## Installation

```bash
# 3 new production dependencies
npm install stripe @stripe/stripe-js @stripe/react-stripe-js
```

No new dev dependencies required.

---

## New File Structure

```
src/
  lib/
    payments/
      actions.ts          # Server actions: createPaymentIntent
      stripe.ts           # Stripe server client singleton
      packs.ts            # Token pack definitions (price, token amount, id)
    ...existing lib/
  app/
    (app)/
      purchase/
        page.tsx          # Purchase page (server component)
        PurchaseClient.tsx # Client component with ExpressCheckoutElement
      ...existing routes
    api/
      webhooks/
        stripe/
          route.ts        # Webhook handler: POST /api/webhooks/stripe
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Payment provider | Stripe | Square, PayPal direct, Braintree | Stripe has the best Apple Pay / Google Pay integration via Express Checkout Element. Single SDK handles both wallet types. Industry standard for web payments. No monthly fees -- only per-transaction (2.9% + $0.30). |
| Client integration | Express Checkout Element | Payment Request Button | Payment Request Button is legacy. Stripe documentation explicitly recommends migrating to Express Checkout Element. |
| Client integration | Express Checkout Element | Stripe Checkout (hosted page) | Checkout redirects users to a Stripe-hosted page -- breaks the mobile-first in-app feel. Express Checkout keeps users in the app with a native wallet sheet. |
| Server pattern | PaymentIntents + server actions | Checkout Sessions API | Checkout Sessions add redirect/session management complexity for zero benefit with fixed-price packs. PaymentIntents + server actions match the existing codebase pattern. |
| Token crediting | Webhook-driven | Optimistic (credit on client confirm) | Client confirmation does not guarantee payment success. The webhook is the only reliable signal that money moved. A 1-2 second delay is acceptable; double-crediting is not. |
| Purchase records | token_ledger (existing) | Separate purchases table | The token_ledger already has `reason` and `reference_id` columns. Adding `token_purchase` as a reason with the Stripe PaymentIntent ID in `reference_id` is sufficient. Keeps a single source of truth for all balance changes. |
| Idempotency | Stripe PaymentIntent metadata + ledger check | None | Before crediting tokens, the webhook handler checks if a ledger entry with this `reference_id` (PaymentIntent ID) already exists. This prevents double-crediting on webhook retries. |

---

## What NOT to Add

| Avoid | Why | What to Do Instead |
|-------|-----|---------------------|
| Separate `purchases` database table | Duplicates what `token_ledger` already tracks. Two sources of truth for balance = bugs. | Use `token_ledger` with `reason: 'token_purchase'` and `reference_id: pi_xxx` |
| Stripe Checkout (hosted page) | Redirects user away from app. Mobile users lose context. Return URL handling is fragile on Netlify. | Use PaymentIntents + Express Checkout Element for in-app payment |
| Payment Request Button Element | Legacy component. Stripe recommends Express Checkout Element for all new integrations. | Use `<ExpressCheckoutElement />` |
| Custom Apple Pay / Google Pay integration | Direct Apple Pay JS / Google Pay API integration is complex and duplicates what Stripe handles. | Stripe's Express Checkout Element wraps both wallet APIs behind a single component |
| Server-side rendering for payment page | Stripe Elements must run client-side (they load Stripe.js in the browser). SSR will fail. | Mark the payment component as `'use client'` and use `loadStripe()` |
| Storing card details | PCI compliance nightmare. Storing card numbers is never acceptable. | Stripe handles all card storage. We only store the PaymentIntent ID. |

---

## Stripe Pricing Impact

For the expected scale (10-20 users, occasional purchases):

| Pack | Price | Stripe Fee (2.9% + $0.30) | Net Revenue |
|------|-------|---------------------------|-------------|
| $5   | $5.00 | $0.45                     | $4.55       |
| $10  | $10.00| $0.59                     | $9.41       |
| $20  | $20.00| $0.88                     | $19.12      |

No monthly Stripe fees. No setup fees. Pay only when transactions occur. Apple Pay and Google Pay have the same fee structure as card payments through Stripe.

---

## Version Compatibility

| Package | Compatible With | Verified |
|---------|-----------------|----------|
| `stripe` ^20.3.1 | Node.js 16+ (Next.js 16 runs Node 18+) | YES -- npm shows active maintenance, published 15 days ago |
| `@stripe/stripe-js` ^8.8.0 | Any modern browser, React 19 | YES -- published 13 hours ago, actively maintained |
| `@stripe/react-stripe-js` ^5.6.0 | React 18+, React 19 | YES -- published 20 days ago, uses React hooks API |
| Express Checkout Element | `@stripe/stripe-js` ^8.x, `@stripe/react-stripe-js` ^5.x | YES -- Express Checkout Element is part of Stripe Elements, available in current SDK versions |

---

## Sources

- [stripe npm package](https://www.npmjs.com/package/stripe) -- v20.3.1, last published 15 days ago (HIGH confidence)
- [@stripe/stripe-js npm](https://www.npmjs.com/package/@stripe/stripe-js) -- v8.8.0, last published 13 hours ago (HIGH confidence)
- [@stripe/react-stripe-js npm](https://www.npmjs.com/package/@stripe/react-stripe-js) -- v5.6.0, last published 20 days ago (HIGH confidence)
- [Express Checkout Element docs](https://docs.stripe.com/elements/express-checkout-element) -- official Stripe documentation (HIGH confidence)
- [Accept payment with Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment) -- PaymentIntents flow with Express Checkout (HIGH confidence)
- [Migrate from Payment Request Button to Express Checkout](https://docs.stripe.com/elements/express-checkout-element/migration) -- confirms Express Checkout is the successor (HIGH confidence)
- [Checkout Sessions vs Payment Intents comparison](https://docs.stripe.com/payments/checkout-sessions-and-payment-intents-comparison) -- decision rationale (HIGH confidence)
- [Apple Pay on the web](https://docs.stripe.com/apple-pay?platform=web) -- domain verification requirements (HIGH confidence)
- [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature) -- constructEvent pattern (HIGH confidence)
- [Stripe + Next.js 15 complete guide](https://www.pedroalonso.net/blog/stripe-nextjs-complete-guide-2025/) -- server actions pattern (MEDIUM confidence, third-party but well-sourced)

---

*Stack research for: Frontrun v2.0 -- Stripe payment integration for USD token purchase*
*Researched: 2026-02-21*
