# Feature Landscape: USD Token Purchase

**Domain:** In-app virtual currency purchase via Apple Pay / Google Pay (Stripe)
**Researched:** 2026-02-21
**Overall confidence:** HIGH (Stripe Express Checkout Element is well-documented, virtual currency purchase patterns are mature, and the existing append-only ledger integrates cleanly)

---

## Table Stakes

Features users expect from any in-app token purchase flow. Missing any of these makes the feature feel broken or untrustworthy.

| Feature | Why Expected | Complexity | Dependencies | Notes |
|---------|--------------|------------|--------------|-------|
| Token pack selection UI | Users need to see what they can buy with clear pricing before committing | LOW | None | 3 fixed tiers: $5 / $10 / $20. Use card-based layout, not a dropdown. Highlight the "best value" middle tier. Mobile-first bottom sheet or dedicated page. |
| Apple Pay button | ~70% of US mobile web users are on iOS Safari. If Apple Pay is missing, most users see no wallet option at all. | MEDIUM | Stripe account, Apple Pay domain verification, HTTPS | Stripe Express Checkout Element handles rendering. Button only shows if user's device/browser supports it. Must register `frontrun.bet` domain with Apple via Stripe Dashboard. |
| Google Pay button | Covers Android/Chrome users. Together with Apple Pay, captures ~95% of mobile users. | LOW (bundled with Apple Pay) | Stripe account, Google Pay enabled in Stripe Dashboard | Express Checkout Element renders both buttons automatically. No separate domain verification needed for Google Pay. |
| Instant token credit after payment | Users expect tokens in their balance immediately after the payment sheet dismisses. Delay kills trust. | MEDIUM | Token ledger, Stripe webhook handler | Credit tokens via webhook handler on `payment_intent.succeeded` or `checkout.session.completed`. New ledger reason: `token_purchase`. The append-only ledger already supports real-time updates via Supabase Realtime, so balance will update live. |
| Payment confirmation feedback | Users need visual confirmation that purchase succeeded and tokens were added. | LOW | Toast/notification system (Sonner already installed) | Show success toast with token amount: "500 tokens added!" Briefly animate the TokenBalance component in the nav. |
| Purchase history | Users want to see what they've bought and when, both for their own records and in case of disputes. | LOW | Token ledger (already exists) | Filter `token_ledger` WHERE `reason = 'token_purchase'`. Display on profile page as a "Purchase History" section. Show date, amount paid (USD), tokens received, and Stripe payment ID. |
| Secure server-side amount enforcement | Amount must be determined server-side. If client dictates the charge amount, attackers can pay $0.01 for 10,000 tokens. | LOW | Server action / API route | Map pack_id to price server-side. Never trust client-sent amounts. Use a `TOKEN_PACKS` constant defined in server code. |
| Idempotent webhook processing | Stripe may send the same webhook event multiple times. Double-crediting tokens is a critical bug. | MEDIUM | Purchases table with `stripe_payment_intent_id` unique constraint | Store Stripe `payment_intent_id` or `checkout_session_id` in a `purchases` table. Check for existence before crediting. If already processed, return 200 OK and skip. |
| Error handling with clear messaging | Payment failures (declined card, network issues, cancelled by user) must show actionable messages, not cryptic errors. | LOW | Stripe error codes | Map Stripe error codes to human-readable messages. "Payment declined -- try a different card" not "Error: card_declined". |
| HTTPS in production | Apple Pay flat-out refuses to work without HTTPS. Google Pay strongly requires it. | ALREADY DONE | Netlify provides HTTPS automatically | `frontrun.bet` is already HTTPS via Netlify. No action needed for production. Local dev requires ngrok or similar tunnel for Apple Pay testing. |

---

## Differentiators

Features that elevate the purchase experience beyond the bare minimum. Not expected, but they increase conversion and satisfaction.

| Feature | Value Proposition | Complexity | Dependencies | Notes |
|---------|-------------------|------------|--------------|-------|
| "Buy Tokens" CTA on insufficient balance | When a user tries to bet more than they have, show a contextual "Buy more tokens" prompt instead of just "Insufficient balance". Converts a frustration moment into a purchase moment. | LOW | BetSlip component, balance check logic | Intercept the insufficient-balance error in the BetSlip and render a link/button to the token purchase flow. This is the highest-converting placement for a purchase CTA. |
| Animated token pack cards with value callouts | Show tokens-per-dollar value on each tier card. "Best value" badge on $20 pack. Slight scale animation on tap. | LOW | UI only | e.g., "$5 = 500 tokens", "$10 = 1,100 tokens (10% bonus)", "$20 = 2,400 tokens (20% bonus)". Bonus tiers incentivize higher spend. |
| Bonus tokens on larger packs | Give more tokens per dollar on bigger packs (e.g., 500 / 1,100 / 2,400 instead of 500 / 1,000 / 2,000). Standard mobile game monetization pattern. | LOW | Token pack config | Increases average order value. The bonus amount is just a config constant -- no additional Stripe complexity. |
| Purchase receipt via email | After purchase, send a confirmation email with receipt details. Professional touch that builds trust. | MEDIUM | Email service (Resend, or skip for v2.0) | Stripe can send receipts automatically if `receipt_email` is set on the PaymentIntent. Zero custom code needed -- just pass the user's email (if collected) or skip for now since auth is phone-only. |
| Real-time balance animation on credit | When tokens are credited, animate the balance counter rolling up from old value to new value. Satisfying dopamine hit. | LOW | TokenBalance component, Supabase Realtime (already in place) | The `useUserBalance` hook already re-fetches on Realtime INSERT events. Add a CSS transition or counter animation. |
| Persistent "low balance" nudge | If balance drops below a threshold (e.g., 50 tokens), show a subtle banner: "Running low? Get more tokens." | LOW | Balance state (Zustand or hook) | Non-intrusive nudge. Dismissible. Only show after user has made at least one bet. |
| Link payment method (Stripe Link) | Stripe's Express Checkout Element supports Link, which saves payment info for one-tap repeat purchases. | FREE (included) | Express Checkout Element | Comes bundled with Express Checkout Element at no extra effort. Returning users can purchase with a single tap. |

---

## Anti-Features

Features to explicitly NOT build for this milestone. Each has a clear reason.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Cash out / token withdrawal | Converts the app into a money transmitter, triggering FinCEN registration, state-by-state money transmitter licenses, and potentially CFTC oversight as a derivatives exchange. This is explicitly out of scope per PROJECT.md. | Tokens are one-way: USD in, tokens out. Prizes are paid informally (Venmo/cash) based on leaderboard, completely separate from the token purchase system. |
| Custom payment form (card number fields) | Building your own card form increases PCI compliance scope dramatically. Stripe Elements handle PCI for you. | Use Stripe Express Checkout Element exclusively. It handles Apple Pay, Google Pay, and Link with zero PCI scope on your server. |
| Variable/custom purchase amounts | Letting users type any dollar amount adds edge cases (minimum amounts, Stripe fees eating small purchases, fractional tokens). Fixed tiers are simpler and more predictable. | Offer exactly 3 fixed packs: $5, $10, $20. If demand exists for higher amounts, add a $50 tier later. |
| Subscription / auto-refill | Adds recurring billing complexity, cancellation flows, proration logic, and Stripe subscription management. Overkill for 10-20 users. | One-time purchases only. Users buy when they want more tokens. |
| Referral bonuses on purchase | "Invite a friend, get 100 free tokens" sounds good but creates abuse vectors (fake accounts for bonus farming). Not worth it at 10-20 user scale. | Rely on organic word-of-mouth. The leaderboard + prize system already drives social sharing. |
| Stripe Checkout hosted page (redirect) | Redirecting to stripe.com/checkout breaks the mobile-first in-app feel. Users leave the app context and may not return. | Use embedded Express Checkout Element within the app. Payment stays in-app with Apple Pay / Google Pay native sheets. |
| In-app receipt PDF generation | Over-engineering. Users don't need downloadable PDFs for $5-$20 virtual token purchases. | Show purchase history in the profile page. Stripe Dashboard has receipts if anyone ever asks for one. |
| Refund self-service | Allowing users to refund token purchases opens abuse (buy tokens, bet, lose, refund). Refunds should be rare and manual. | Admin handles refund requests manually via Stripe Dashboard. Add a `token_refund` ledger reason for when it happens. |

---

## Feature Dependencies

```
Apple Pay Domain Verification
  |
  v
Stripe Account Setup (API keys, webhook endpoint)
  |
  v
Token Pack Configuration (server-side pack definitions)
  |
  v
PaymentIntent / Checkout Session Creation (server action)
  |
  v
Express Checkout Element (client-side UI)
  |
  v
Stripe Webhook Handler (/api/stripe/webhook)
  |
  v
Purchases Table (idempotency + history) + Token Ledger INSERT (new reason: token_purchase)
  |
  v
Real-time Balance Update (already works via Supabase Realtime on token_ledger INSERT)
  |
  v
Purchase History UI (profile page section)
```

**Critical dependency on existing system:** The `token_ledger.reason` column has a CHECK constraint limiting values to: `signup_bonus`, `bet_placed`, `resolution_payout`, `market_cancelled_refund`, `adjustment`. A new migration must ALTER this constraint to add `token_purchase` (and optionally `token_refund` for admin refunds).

**Webhook must be atomic:** The webhook handler that credits tokens must use a Supabase RPC or transaction that atomically: (1) inserts into `purchases` table, (2) inserts into `token_ledger`. This matches the existing pattern where `place_bet` atomically updates multiple tables.

---

## Integration with Existing Token Ledger

The append-only ledger pattern is a perfect fit for token purchases. Here is how purchased tokens integrate:

**New ledger entry format:**
```
{
  user_id: <user_uuid>,
  amount: 500,           // positive = credit (tokens added)
  reason: 'token_purchase',
  reference_id: <purchase_uuid>  // FK to purchases table
}
```

**New `purchases` table (needed for idempotency and history):**
```sql
CREATE TABLE purchases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES profiles(id),
  stripe_payment_intent_id TEXT UNIQUE NOT NULL,  -- idempotency key
  pack_id                 TEXT NOT NULL,           -- e.g., 'pack_500', 'pack_1100', 'pack_2400'
  tokens_credited         INTEGER NOT NULL,
  amount_usd_cents        INTEGER NOT NULL,        -- store in cents to avoid float issues
  status                  TEXT NOT NULL DEFAULT 'completed',
  created_at              TIMESTAMPTZ DEFAULT NOW()
);
```

**Why `amount_usd_cents` as INTEGER:** Same philosophy as using `decimal.js` for CPMM math -- avoid floating point. $5.00 = 500 cents. No rounding errors, clean math.

**Existing real-time balance updates just work:** The `useUserBalance` hook subscribes to INSERT events on `token_ledger`. When the webhook credits tokens, the user's balance updates live in the UI with zero additional code.

---

## Token Pack Pricing Recommendation

| Pack | Price | Tokens | Tokens/Dollar | Bonus | CTA |
|------|-------|--------|---------------|-------|-----|
| Starter | $5 | 500 | 100/$ | -- | "Get started" |
| Popular | $10 | 1,100 | 110/$ | +10% | "Most popular" (highlighted) |
| Best Value | $20 | 2,400 | 120/$ | +20% | "Best value" |

**Rationale:** Base rate is 100 tokens per dollar (matching the free 1,000 token signup bonus at roughly $10 equivalent). Bonus tiers incentivize higher spend. The $10 tier should be visually highlighted as "most popular" -- anchoring psychology makes middle options the default choice.

**Stripe fee impact:** Stripe charges 2.9% + $0.30 per transaction. On a $5 purchase, that is $0.45 (9% effective fee). On $20, that is $0.88 (4.4%). Higher packs have better fee economics, which the bonus tokens offset for users.

---

## MVP Recommendation

**Build in this order:**

1. **Stripe account setup + Apple Pay domain verification** -- prerequisite for everything
2. **Token pack config + PaymentIntent server action** -- server-side amount enforcement
3. **Purchases table migration + webhook handler** -- idempotent token crediting
4. **Express Checkout Element on purchase page** -- the actual buy UI
5. **"Insufficient balance" CTA in BetSlip** -- highest-converting purchase entry point
6. **Purchase history on profile page** -- users can verify their purchases

**Defer:**
- Bonus tokens on larger packs: Can start with flat 100 tokens/dollar and add bonuses later based on demand
- Balance animation: Nice polish but not blocking launch
- Low balance nudge: Measure organic purchase behavior first
- Email receipts: Skip for phone-only auth; revisit if email is ever collected

---

## Sources

- [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) -- HIGH confidence (official docs, verified current)
- [Stripe Payment Request Button (Legacy)](https://docs.stripe.com/stripe-js/elements/payment-request-button) -- HIGH confidence (confirmed deprecated in favor of Express Checkout Element)
- [Accept a payment with Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment) -- HIGH confidence (official integration guide)
- [Stripe Apple Pay domain verification](https://docs.stripe.com/apple-pay?platform=web) -- HIGH confidence (official docs)
- [Stripe webhook best practices](https://docs.stripe.com/webhooks/handling-payment-events) -- HIGH confidence (official docs)
- [Checkout Sessions vs PaymentIntents comparison](https://docs.stripe.com/payments/checkout-sessions-and-payment-intents-comparison) -- HIGH confidence (official docs)
- [React Stripe.js reference](https://docs.stripe.com/sdks/stripejs-react) -- HIGH confidence (official docs)
- [Virtual currency monetization patterns](https://www.revenuecat.com/blog/engineering/how-to-monetize-your-ai-app-with-virtual-currencies/) -- MEDIUM confidence (industry blog, patterns verified across multiple sources)
- [Bottom sheet UX patterns](https://mobbin.com/glossary/bottom-sheet) -- MEDIUM confidence (UX design resource)
- [Stripe testing wallets](https://docs.stripe.com/testing/wallets) -- HIGH confidence (official docs)
- [Netlify Apple Pay domain verification forum](https://answers.netlify.com/t/apple-pay-verification-using-well-known/16642) -- MEDIUM confidence (community forum, confirmed approach)
