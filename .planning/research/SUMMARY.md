# Project Research Summary

**Project:** Frontrun v2.0 — USD Token Purchase via Stripe
**Domain:** In-app virtual currency purchase (Apple Pay / Google Pay via Stripe Express Checkout Element)
**Researched:** 2026-02-21
**Confidence:** HIGH

## Executive Summary

Adding real-money token purchases to Frontrun is a well-understood integration pattern with mature tooling. The approach is: Stripe PaymentIntents API + Express Checkout Element for the client-side wallet UX, a Next.js Route Handler for PaymentIntent creation, and a separate webhook Route Handler for fulfillment. The existing append-only token ledger integrates naturally — purchased tokens are indistinguishable from signup tokens, the existing `useUserBalance` Realtime subscription auto-updates the balance on any ledger INSERT, and the existing admin Supabase client handles server-side writes. Minimal new infrastructure is required: three new npm packages, two new Route Handlers, two new database tables (`token_purchases` for history/idempotency and `stripe_events` for webhook deduplication), one ledger CHECK constraint migration, and a Supabase RPC for atomic fulfillment.

The single most critical architectural decision is fulfillment-via-webhook-only. Token credits must happen exclusively in the `payment_intent.succeeded` webhook handler — never in client-side callbacks. The client-side `onConfirm` handler creates the PaymentIntent and calls `stripe.confirmPayment()`; it never credits tokens. This prevents double-crediting on Stripe's webhook retries (catastrophic in an append-only ledger), handles browser-close and network-failure scenarios, and matches Stripe's documented best practices. The existing Supabase Realtime subscription on `token_ledger` delivers the balance update to the client automatically once the webhook fires, so no polling infrastructure is needed.

Three unavoidable risks require deliberate mitigation: (1) Stripe's webhook retry behavior causing double-credits — mitigated by a `stripe_events` table with a UNIQUE constraint on `event_id` and an atomic Supabase RPC with a row lock; (2) Netlify's 10-second serverless timeout killing the webhook handler — mitigated by keeping the handler minimal and delegating all DB work to one fast RPC; and (3) Apple Pay requiring explicit domain registration that silently fails with no user-visible error — mitigated by registering domains before writing any code and verifying the `/.well-known/` path is accessible post-deploy. A legal gap also exists: the USD-in/prize-out pattern may trigger money transmitter classification and must be addressed in Terms of Service before accepting the first payment.

## Key Findings

### Recommended Stack

The integration requires exactly three new production npm packages layered onto the existing Next.js 16 / Supabase / Tailwind / shadcn/ui stack. No new dev dependencies. The server SDK (`stripe` ^20.3.1) lives exclusively in server-side code and handles PaymentIntent creation and webhook signature verification. The client packages (`@stripe/stripe-js` ^8.8.0, `@stripe/react-stripe-js` ^5.6.0) load Stripe.js from the CDN and provide the `<ExpressCheckoutElement>` React component. All three packages are actively maintained and verified compatible with React 19 and Next.js App Router.

**Core technologies:**
- `stripe` ^20.3.1: Server-side Stripe API, webhook signature verification via `stripe.webhooks.constructEvent()` — only the official SDK handles HMAC verification correctly; published 15 days ago
- `@stripe/stripe-js` ^8.8.0: Lazy-loads Stripe.js from CDN; must call `loadStripe()` outside component render to avoid re-creating the Stripe object on every render; published 13 hours ago
- `@stripe/react-stripe-js` ^5.6.0: Provides `<Elements>` provider and `<ExpressCheckoutElement>`, replacing the deprecated `<PaymentRequestButtonElement>` with unified Apple Pay / Google Pay / Link support; published 20 days ago

**Explicit non-additions:** No separate state management beyond existing Zustand, no custom payment form library, no Stripe Checkout hosted page (breaks mobile-first in-app UX by redirecting users away), no Payment Request Button (legacy — Stripe explicitly recommends Express Checkout Element for all new integrations).

See `/Users/sammylapp/.gemini/antigravity/Workspaces/Prediction Market/.planning/research/STACK.md` for full version compatibility table and alternatives considered.

### Expected Features

The feature set is focused and well-bounded. Three fixed token packs ($5/$10/$20) with optional bonus tokens on higher tiers keep the UX simple and avoid variable-amount edge cases. The most easily-missed dependency: the existing `token_ledger.reason` CHECK constraint must be migrated before deploying any payment code — the webhook handler will fail with a constraint violation on every payment attempt until this migration is applied.

**Must have (table stakes):**
- Token pack selection UI — card-based, 3 fixed tiers, highlight middle "most popular" tier (anchoring psychology drives middle-tier selection)
- Apple Pay button — requires domain registration; covers ~70% of US mobile web users on iOS Safari; button silently absent without registration
- Google Pay button — bundled in Express Checkout Element, no domain registration needed; covers Android/Chrome
- Instant token credit after payment — webhook-driven; leverages existing Supabase Realtime so balance auto-updates with zero additional code
- Payment confirmation feedback — success toast ("500 tokens added!") via existing Sonner installation
- Purchase history on profile page — filter `token_purchases` by user; show date, USD amount, tokens received, Stripe payment ID
- Server-side amount enforcement — server maps `pack_id` to authoritative price; client never sends dollar amounts
- Idempotent webhook processing — `stripe_events` table with UNIQUE on `event_id`; atomic RPC prevents double-credits
- Error handling with clear messaging — map Stripe error codes to human-readable messages; handle `payment_intent.payment_failed` webhook event

**Should have (competitive differentiators):**
- "Buy Tokens" CTA in BetSlip on insufficient balance — highest-converting placement; converts a frustration moment into a purchase
- Bonus tokens on larger packs (500/1100/2400 instead of 500/1000/2000) — standard mobile game monetization; incentivizes higher spend
- Payment fallback for users without wallets — Payment Element below Express Checkout for card-entry; avoids blank payment page for ~5% of users
- Real-time balance animation on credit — CSS counter transition on token balance; dopamine hit when tokens arrive
- Persistent low-balance nudge — subtle dismissible banner below threshold (e.g., 50 tokens)

**Defer to v2+:**
- Email receipts — phone-only auth means no email address available; revisit if email auth is added
- Referral bonuses on purchase — abuse vectors outweigh benefit at 10-20 user scale
- Subscription / auto-refill — overkill; Stripe subscription management complexity is unjustified
- Animated pack card micro-interactions — polish, not blocking launch

**Hard anti-features (never build):**
- Token withdrawal / cash-out — triggers money transmitter classification under FinCEN
- Custom card number input fields — increases PCI scope; Stripe Elements handle PCI
- Variable purchase amounts — edge cases with no benefit at fixed-pack scale
- Stripe Checkout hosted page — redirects user away from app; breaks mobile-first context

See `/Users/sammylapp/.gemini/antigravity/Workspaces/Prediction Market/.planning/research/FEATURES.md` for full feature dependency graph and token pack pricing rationale.

### Architecture Approach

The payment system adds a new vertical that integrates at exactly two points with the existing system: the `token_ledger` table (one new INSERT reason via migration) and the `user_balances` view (automatic — already derives from `SUM(token_ledger.amount)`). No existing components require logic changes. The `/buy` route lives inside the `(app)/` route group and is automatically protected by existing middleware. The Stripe webhook at `/api/webhooks/stripe` must not require auth — the middleware matcher already excludes `/api` routes, so the webhook is reachable by Stripe's servers while the Stripe signature verification serves as its own authentication.

**Major components:**
1. `POST /api/payments/create-intent` Route Handler — authenticates user from cookies, validates tier via Zod, creates Stripe PaymentIntent server-side with pack price and user metadata, inserts pending `token_purchases` row, returns `clientSecret`
2. `POST /api/webhooks/stripe` Route Handler — receives raw body via `request.text()` (critical — `request.json()` breaks HMAC verification), verifies signature, calls `credit_token_purchase` RPC for atomic idempotent fulfillment; handles both `payment_intent.succeeded` and `payment_intent.payment_failed`
3. `credit_token_purchase` Supabase RPC — row-locks `token_purchases` for update, checks idempotency (returns early if already `completed`), inserts `token_ledger` entry with reason `token_purchase`, updates purchase status to `completed` and sets `completed_at` — all in one transaction
4. `/buy` page with `<BuyTokensClient>` — server component shell wraps client component with `<Elements>` provider configured for `mode: 'payment'`; `<ExpressCheckoutElement>` handles Apple Pay / Google Pay; `<PaymentElement>` as fallback
5. `token_purchases` table — stores USD amount in cents, tier, Stripe PI ID (UNIQUE constraint as idempotency key), status, and `completed_at` for purchase history display and fulfillment polling
6. `stripe_events` table — stores Stripe event IDs with UNIQUE constraint; webhook handler inserts here before any other processing; unique violation means duplicate event, return 200 and skip

See `/Users/sammylapp/.gemini/antigravity/Workspaces/Prediction Market/.planning/research/ARCHITECTURE.md` for full data flow diagram, component code patterns, and complete SQL migration.

### Critical Pitfalls

1. **Double-crediting tokens on duplicate webhook events** — Stripe retries webhooks for up to 3 days; the append-only ledger makes every accidental INSERT additive with no natural undo. Prevent with a `stripe_events` table (UNIQUE on `event_id`) and a `credit_token_purchase` RPC that row-locks and checks status inside a single transaction. This deduplication must exist before any webhooks arrive.

2. **Webhook signature verification failing due to body parsing** — Using `request.json()` instead of `request.text()` causes HMAC verification to fail on every webhook; users are charged but never credited. Always use `await request.text()` in the webhook route handler. Verify during development with `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

3. **Tokens never arriving despite successful client-side payment** — Client `onComplete` fires before the webhook; fulfillment in the client callback is unreliable (browser close, network failure). Fulfill ONLY via webhook. Leverage the existing `useUserBalance` Supabase Realtime subscription — it auto-updates on any `token_ledger` INSERT regardless of reason, so no polling infrastructure is needed.

4. **Netlify 10-second serverless timeout killing webhook processing** — Cold starts plus Supabase connection latency can push the webhook handler over the limit. Keep the handler minimal: verify signature, insert into `stripe_events` (dedup check), call one atomic RPC, return 200. Total execution must stay under 5 seconds to have safety margin.

5. **`token_ledger` CHECK constraint rejecting `token_purchase` reason** — Existing constraint allows only 5 predefined values. The migration adding `token_purchase` must be applied to the production database BEFORE deploying any payment code, not alongside it. Deploying code before migration means every webhook attempt returns 500 and Stripe retries indefinitely.

6. **Apple Pay silently missing due to domain verification failure** — Apple Pay button simply does not render without domain registration; no error surfaces to the user or in console. Register `frontrun.bet` AND `www.frontrun.bet` in Stripe Dashboard before writing any frontend code. Ensure the `/.well-known/` path is excluded from the auth middleware matcher.

See `/Users/sammylapp/.gemini/antigravity/Workspaces/Prediction Market/.planning/research/PITFALLS.md` for the full "Looks Done But Isn't" checklist, recovery strategies, and all 14 pitfalls.

## Implications for Roadmap

The build order is strictly dependency-driven based on the dependency chain identified across all four research files. Database changes precede backend (the constraint migration must exist before the first webhook fires). Backend Route Handlers are verified before frontend is built (catch signature verification failures in isolation before wiring UI). Apple Pay domain registration runs in parallel with infrastructure setup — it has no code dependency but a time dependency (DNS propagation can take up to 24 hours). Legal/ToS work gates go-live, not initial development.

### Phase 1: Database Foundation

**Rationale:** Every downstream component depends on schema being in place. The `token_ledger` CHECK constraint must be migrated before any payment code can write to it. The `token_purchases` and `stripe_events` tables must exist before the webhook handler can perform idempotency checks. Deploying code before migrations is how Pitfall 7 (constraint rejection) happens and results in users being charged but never credited.

**Delivers:** All schema changes ready; idempotency infrastructure in place; atomic fulfillment RPC deployed; Stripe npm packages installed; environment variables configured.

**Addresses:** Idempotent webhook processing, purchase history storage, server-side amount enforcement (tier constants defined).

**Avoids:** Pitfall 7 (CHECK constraint rejection), Pitfall 1 (double-crediting — `stripe_events` UNIQUE constraint exists before any webhooks arrive).

**Key tasks:**
- `supabase/migrations/00006_token_purchases.sql`: create `token_purchases`, `stripe_events` tables; ALTER `token_ledger` CHECK constraint to add `token_purchase`; create `credit_token_purchase` RPC
- `src/lib/stripe/tiers.ts`: server-authoritative token pack constants
- `npm install stripe @stripe/stripe-js @stripe/react-stripe-js`
- Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `.env.local` and Netlify environment variables

**Research flag:** Standard patterns — follows the existing `place_bet` RPC pattern exactly; no additional research needed.

### Phase 2: Stripe Account Setup + Apple Pay Domain

**Rationale:** Stripe account configuration (API keys, webhook endpoints, Apple Pay domain registration) is prerequisite for all backend and frontend work but has no code dependency. Running this in parallel with Phase 1 minimizes calendar time. Apple Pay domain verification can take up to 24 hours and must not block frontend development.

**Delivers:** Stripe keys configured in all environments; webhook endpoint registered in Stripe Dashboard for both test and live modes; `frontrun.bet` and `www.frontrun.bet` domains registered for Apple Pay; `/.well-known/` verification file accessible via `curl`.

**Avoids:** Pitfall 5 (Apple Pay invisible due to missing domain verification), Pitfall 6 (test vs live webhook secret mismatch).

**Key tasks:**
- Register `frontrun.bet` AND `www.frontrun.bet` in Stripe Dashboard > Settings > Payment Methods > Domains
- Create webhook endpoint in Stripe Dashboard in both test mode and live mode
- Copy separate webhook secrets for each mode into the appropriate environment
- Add `/.well-known` exclusion to `middleware.ts` matcher pattern
- Verify: `curl https://frontrun.bet/.well-known/apple-developer-merchantid-domain-association` returns file

**Research flag:** Standard patterns — documented Stripe dashboard workflow; no code involved.

### Phase 3: Backend Route Handlers

**Rationale:** Frontend components require `clientSecret` from the create-intent endpoint; the webhook handler must be verified working (token crediting confirmed) before any UI is built. This order catches the most common failure mode — signature verification from wrong body parsing — before any user-facing code exists. The backend can be fully tested with the Stripe CLI without any UI.

**Delivers:** Working `POST /api/payments/create-intent` endpoint; working `POST /api/webhooks/stripe` with signature verification and idempotent token crediting via RPC; end-to-end verification with `stripe listen --forward-to` that tokens are credited on payment.

**Uses:** `stripe` server SDK singleton, Supabase admin client, `credit_token_purchase` RPC, Zod v4 for request validation, existing `{ success: true; data } | { success: false; error }` return pattern.

**Avoids:** Pitfall 2 (raw body — use `request.text()` not `request.json()`), Pitfall 4 (lean handler — target < 5 seconds total execution on Netlify), Pitfall 12 (handle `payment_intent.payment_failed` events, not just `succeeded`).

**Key tasks:**
- `src/lib/stripe/server.ts`: Stripe server SDK singleton
- `src/app/api/payments/create-intent/route.ts`: authenticate from cookies, validate tier, create PaymentIntent, insert pending `token_purchases` row, return `{clientSecret}`
- `src/app/api/webhooks/stripe/route.ts`: `request.text()` raw body, `constructEvent()` signature verify, insert `stripe_events` for dedup, call `credit_token_purchase` RPC, return 200
- Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and verify token credited to ledger before proceeding

**Research flag:** Needs careful attention — the `request.text()` raw body pattern and Netlify timeout constraints are the most common failure mode for Stripe + Next.js integrations. Do not proceed to Phase 4 until the webhook round-trip is verified.

### Phase 4: Frontend — Buy Page + Express Checkout UI

**Rationale:** All server-side infrastructure is verified before building the UI. The frontend wraps well-tested Stripe primitives and the existing shadcn/ui component library — this is the lowest-risk phase. The fallback Payment Element must be included from the start, not added later; designing around it from the beginning prevents a blank payment page for users without configured wallets.

**Delivers:** `/buy` route with tier selection; Express Checkout Element rendering Apple Pay / Google Pay buttons; Payment Element fallback for users without wallets; purchase success/processing state; token balance animation on credit via existing Realtime subscription.

**Uses:** `@stripe/stripe-js` `loadStripe()` singleton, `@stripe/react-stripe-js` `<Elements>`, `<ExpressCheckoutElement>`, `<PaymentElement>`, existing shadcn/ui Card/Button/Badge, existing Sonner toast, existing `useUserBalance` hook.

**Avoids:** Pitfall 8 (invisible buttons when no wallet configured — include `<PaymentElement>` fallback), Pitfall 10 (no fallback for users without wallets), Pitfall 3 (do NOT credit tokens in `onConfirm` — fulfill only via webhook; Realtime handles the balance update).

**Key tasks:**
- `src/lib/stripe/client.ts`: `loadStripe()` outside component render
- `src/app/(app)/buy/page.tsx`: server component shell with metadata
- `src/app/(app)/buy/BuyTokensClient.tsx`: client component; `<Elements>` provider with tier-based `amount`, `mode: 'payment'`, `currency: 'usd'`
- `src/components/payments/TierSelector.tsx`: pack cards with pricing, bonus callouts, "Most Popular" badge on $10 tier
- `src/components/payments/ExpressCheckout.tsx`: `<ExpressCheckoutElement onConfirm={...}>` calling create-intent endpoint; `onReady` callback to detect if any buttons rendered and conditionally show fallback
- `src/components/payments/PurchaseSuccess.tsx`: post-payment processing state that resolves via Realtime balance update

**Research flag:** Standard patterns — Express Checkout Element integration follows official Stripe React docs exactly.

### Phase 5: Integration Polish + Entry Points

**Rationale:** Once the buy flow is verified end-to-end, add the high-value entry points that drive actual purchase conversions and complete the feature surface. The BetSlip CTA is the highest-converting placement and should be prioritized. Terms of Service must be updated before go-live — this is non-negotiable given the regulatory risk.

**Delivers:** "Buy Tokens" CTA in BetSlip on insufficient balance; low-balance nudge banner; "Buy" link in BottomNav; purchase history section on profile page; Terms of Service update covering token non-convertibility.

**Uses:** Existing BetSlip component, existing BottomNav, existing profile page, `token_purchases` table (SELECT WHERE `user_id = auth.uid()` AND `status = 'completed'`).

**Avoids:** Pitfall 14 (regulatory exposure — ToS must explicitly state tokens are non-convertible, non-transferable, and prizes are contest winnings not token redemptions).

**Key tasks:**
- BetSlip: intercept insufficient-balance validation error, render "Buy more tokens" link to `/buy` with pre-selected tier
- BottomNav: add "Buy" nav item
- `src/components/payments/PurchaseHistory.tsx`: component for profile page; display date, USD amount, tokens received, payment ID
- ToS update: tokens are a limited, non-transferable license with no cash value; prizes are performance-based contest winnings
- Verify Apple Pay button appears on a real iPhone in Safari on `frontrun.bet`

**Research flag:** Legal gap — Terms of Service language should be reviewed against FinCEN convertible virtual currency guidance before accepting the first real payment. This is not covered by the existing codebase.

### Phase 6: Go Live

**Rationale:** Final switch from test to live Stripe keys, smoke test with real payment, and monitoring confirmation. Must not be rushed — the "Looks Done But Isn't" checklist in PITFALLS.md should be run item by item.

**Delivers:** Live payments accepted on `frontrun.bet`; production webhook endpoint active with live-mode secret; smoke test confirmed with real $5 purchase.

**Avoids:** Pitfall 6 (confirm Netlify environment uses LIVE mode webhook secret, not test mode secret — they look identical in format but are different values).

**Key tasks:**
- Switch `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to live mode values in Netlify environment variables
- Create and register live-mode webhook endpoint in Stripe Dashboard pointing to `https://frontrun.bet/api/webhooks/stripe`
- Run full "Looks Done But Isn't" checklist from PITFALLS.md
- Purchase a $5 pack with a real card; verify tokens credited in ledger; verify purchase appears in history; verify Stripe Dashboard shows successful delivery

### Phase Ordering Rationale

- Database migrations must precede all backend code — the `token_ledger` constraint rejection (Pitfall 7) silently fails every payment until fixed, and fixing it after go-live means manual reconciliation with affected users
- Backend Route Handlers must be verified before frontend is built — signature verification failures and Netlify timeout issues are caught early with the Stripe CLI before any user-facing code exists
- Apple Pay domain registration runs in parallel with infrastructure setup — it has no code dependency but can take 24 hours to propagate, so starting it early avoids blocking go-live
- Entry points and purchase history come last because they depend on the buy flow being stable and tested
- Legal/ToS update is gated to Phase 5 (before go-live), not Phase 1, because the feature is not live and not accepting real payments yet; however it must be complete before Phase 6

### Research Flags

Needs careful attention during implementation:
- **Phase 3 (Backend Route Handlers):** Webhook raw body handling (`request.text()` not `request.json()`) and Netlify's 10-second timeout are the most common failure modes for this integration stack. Do not advance to frontend until the webhook round-trip is verified with `stripe listen`.
- **Phase 5 (Integration):** Terms of Service language and regulatory positioning require legal review before the first real payment is accepted. The FinCEN convertible virtual currency guidance is a real risk, not a hypothetical.

Standard patterns (follow existing codebase, no additional research needed):
- **Phase 1 (Database):** Follows the existing `place_bet` atomic RPC pattern exactly
- **Phase 2 (Stripe Account Setup):** Documented Stripe dashboard workflow; no code
- **Phase 4 (Frontend):** Express Checkout Element follows official Stripe React docs; uses existing shadcn/ui components
- **Phase 6 (Go Live):** Environment variable swap and smoke test; checklist-driven

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All three packages verified on npm with recent publish dates; official Stripe docs confirm React 19 compatibility and Express Checkout Element as the current recommended approach |
| Features | HIGH | Feature set is well-defined with explicit anti-features scoped out; token pack pricing follows verified mobile game monetization patterns; table stakes list directly maps to Stripe's documented capabilities |
| Architecture | HIGH | Route Handler pattern verified for Next.js App Router; Supabase RPC atomic pattern already proven in existing `place_bet`; Realtime integration requires zero new code; integration points with existing system are minimal and well-understood |
| Pitfalls | HIGH (webhook/idempotency), MEDIUM (Netlify-specific) | Webhook raw body and idempotency pitfalls are extensively documented in official Stripe docs and community posts; Netlify timeout behavior has community reports but no official Stripe/Netlify joint documentation |

**Overall confidence:** HIGH

### Gaps to Address

- **Netlify function timeout under real load:** Research confirms the 10-second limit is a risk and provides mitigation (lean handler + single RPC). Validate actual execution time with a simulated load test of the webhook handler before go-live; if it consistently exceeds 7 seconds, consider Netlify Background Functions (paid plan) or routing the webhook through a Supabase Edge Function.
- **Apple Pay `/.well-known/` serving on Netlify:** The domain verification file path is documented to work with Next.js `public/` directory, but there are community reports of Next.js middleware intercepting it. Verify with `curl` after initial deploy before spending time debugging Apple Pay behavior.
- **Legal/regulatory positioning:** The USD-in/prize-out pattern may trigger money transmitter classification under FinCEN. Research documents the risk and the mitigation approach (ToS language, no token transfers, prize-as-contest framing), but this is not legal advice and must be reviewed by a lawyer before accepting the first real payment.
- **Stripe Link behavior:** Express Checkout Element includes Stripe Link (one-tap repeat purchases for returning users) automatically. Its behavior has not been specifically tested in this integration context; it is a nice-to-have that comes free and can be verified during Phase 6 smoke testing.

## Sources

### Primary (HIGH confidence)
- [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) — integration pattern, Apple Pay / Google Pay / Link support, `onConfirm` handler flow
- [Accept a Payment with Express Checkout Element — React](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?client=react) — `elements.submit()` sequence, `<Elements>` provider configuration
- [Stripe Payment Request Button Migration Guide](https://docs.stripe.com/elements/express-checkout-element/migration) — confirms Express Checkout Element is the recommended replacement
- [Stripe Apple Pay Web](https://docs.stripe.com/apple-pay?platform=web) — domain verification requirements, test vs live mode registration
- [Stripe Webhook Handling](https://docs.stripe.com/webhooks/handling-payment-events) — event types, retry behavior, event ordering
- [Stripe Webhook Signature Verification](https://docs.stripe.com/webhooks/signature) — raw body requirement, `constructEvent` pattern, common errors
- [Stripe Idempotent Requests](https://docs.stripe.com/api/idempotent_requests) — official idempotency key documentation
- [Stripe Checkout Sessions vs PaymentIntents](https://docs.stripe.com/payments/checkout-sessions-and-payment-intents-comparison) — decision rationale for PaymentIntents + Express Checkout over hosted Checkout
- [Stripe React.js SDK Reference](https://docs.stripe.com/sdks/stripejs-react) — `<Elements>` provider, hooks API
- [Stripe Test Wallets](https://docs.stripe.com/testing/wallets) — Apple Pay / Google Pay test device setup
- [npm: stripe ^20.3.1](https://www.npmjs.com/package/stripe) — version and active maintenance status
- [npm: @stripe/stripe-js ^8.8.0](https://www.npmjs.com/package/@stripe/stripe-js) — version and React 19 compatibility
- [npm: @stripe/react-stripe-js ^5.6.0](https://www.npmjs.com/package/@stripe/react-stripe-js) — React 19 compatibility confirmed

### Secondary (MEDIUM confidence)
- [Next.js App Router Stripe Webhook](https://medium.com/@gragson.john/stripe-checkout-and-webhook-in-a-next-js-15-2025-925d7529855e) — `request.text()` vs `request.json()` for raw body in App Router route handlers
- [Stripe + Next.js Complete Guide 2025](https://www.pedroalonso.net/blog/stripe-nextjs-complete-guide-2025/) — server actions pattern for PaymentIntent creation
- [Netlify Functions Timeout Documentation](https://answers.netlify.com/t/support-guide-why-is-my-function-taking-long-or-timing-out/71689) — 10-second limit, background functions option
- [Netlify Stripe Webhook Inconsistency Thread](https://answers.netlify.com/t/netlify-functions-not-executing-stripe-webhook-events-consistently/48846) — community evidence of function timeout issues
- [Netlify Apple Pay domain verification forum](https://answers.netlify.com/t/apple-pay-verification-using-well-known/16642) — `/.well-known/` serving on Netlify with Next.js
- [Handling Duplicate Stripe Events](https://www.duncanmackenzie.net/blog/handling-duplicate-stripe-events/) — practical database deduplication implementation
- [Hookdeck Webhook Idempotency Guide](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) — database upsert pattern for deduplication
- [Virtual currency monetization patterns](https://www.revenuecat.com/blog/engineering/how-to-monetize-your-ai-app-with-virtual-currencies/) — tier pricing psychology, bonus token patterns

### Tertiary (MEDIUM-LOW confidence — legal, not technical)
- [Venable — Regulatory Risks of Virtual Currency](https://www.venable.com/insights/publications/2017/05/regulatory-risks-of-ingame-and-inapp-virtual-curre) — money transmitter classification risk for in-app virtual currencies
- [FinCEN Virtual Currency Guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering) — convertible virtual currency definitions and FinCEN registration triggers

---
*Research completed: 2026-02-21*
*Ready for roadmap: yes*
