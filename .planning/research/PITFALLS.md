# Domain Pitfalls

**Domain:** Adding USD token purchases (Stripe + Apple Pay / Google Pay) to existing prediction market
**Researched:** 2026-02-21
**Confidence:** HIGH (webhook/idempotency pitfalls well-documented), MEDIUM (Netlify-specific edge cases)

---

## Critical Pitfalls

### Pitfall 1: Double-Crediting Tokens on Duplicate Webhook Events

**What goes wrong:**
Stripe delivers the `payment_intent.succeeded` webhook. Your handler inserts a row into `token_ledger` crediting 500 tokens. Network hiccup causes Stripe not to receive your 200 response. Stripe retries the same event 30 seconds later. Your handler inserts *another* 500 tokens. The user paid $5 once but received 1,000 tokens. With the append-only ledger architecture, there is no mutable balance to check -- every INSERT is additive by design, making double-credits especially dangerous.

**Why it happens:**
Stripe retries failed webhooks for up to 3 days. Your serverless function may time out (Netlify has a 10-second limit on free/starter plans), return an error, or simply not acknowledge fast enough. Stripe treats anything other than a 2xx response as a failure and resends. The append-only `token_ledger` has no natural deduplication -- every INSERT increases the balance.

**Consequences:**
- Users receive free tokens they didn't pay for
- Token economy inflates, distorting leaderboard rankings and prize fairness
- Extremely difficult to detect after the fact because the ledger entries look legitimate
- If discovered, manual correction requires negative `adjustment` entries and awkward user communication

**Prevention:**
1. **Create a `stripe_events` table with a UNIQUE constraint on `event_id`:**
   ```sql
   CREATE TABLE stripe_events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     event_id TEXT UNIQUE NOT NULL,  -- Stripe event ID (evt_xxx)
     event_type TEXT NOT NULL,
     payment_intent_id TEXT,
     processed_at TIMESTAMPTZ DEFAULT NOW(),
     status TEXT DEFAULT 'processed'
   );
   ```
2. **In the webhook handler, INSERT into `stripe_events` first.** If the insert fails with a unique violation, return 200 immediately and skip processing. The database constraint handles race conditions that application-level checks cannot.
3. **Use a Supabase RPC stored procedure** (matching the existing `place_bet` pattern) that atomically: checks for duplicate event ID, inserts the event record, and inserts the `token_ledger` credit -- all in one transaction.
4. **Always return 200 for duplicate events.** Returning an error causes Stripe to keep retrying, creating more duplicate attempts.

**Detection:**
- Monitor for multiple `token_ledger` entries with reason `token_purchase` and the same `reference_id` (payment intent ID)
- Alert if any user's balance spikes by more than the maximum pack size (500 tokens for $20) in a single minute
- Query `stripe_events` for duplicate `event_id` attempts (track even the rejected ones)

**Phase to address:** Webhook handler implementation -- this must be the FIRST thing built, before any payment flow

---

### Pitfall 2: Webhook Signature Verification Fails Due to Body Parsing

**What goes wrong:**
The Stripe webhook arrives. Your Next.js App Router route handler parses the body as JSON (via `request.json()`) and passes it to `stripe.webhooks.constructEvent()`. Signature verification fails every time. All webhooks are rejected. No payments are credited. Users pay money but receive nothing.

**Why it happens:**
Stripe's signature verification requires the **raw request body** as a string, not a parsed JSON object. When you parse JSON and re-stringify it, whitespace, key ordering, and Unicode escaping may differ from the original. The HMAC signature computed over the re-stringified body will not match the signature Stripe computed over the raw body. This is the single most common Stripe webhook integration bug, documented extensively across Next.js issue trackers.

**Consequences:**
- Every webhook fails silently (your handler returns 400)
- Stripe retries for 3 days, all fail
- Users are charged but never receive tokens
- Requires manual reconciliation via Stripe dashboard

**Prevention:**
```typescript
// src/app/api/webhooks/stripe/route.ts
export async function POST(request: Request) {
  const body = await request.text();  // RAW body, not request.json()
  const signature = request.headers.get('stripe-signature')!;

  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
  // ...handle event
}
```
- **Never** use `request.json()` in a webhook handler
- **Never** use middleware that parses request bodies before the webhook route
- Test signature verification with `stripe listen --forward-to localhost:3000/api/webhooks/stripe` during development

**Detection:**
- Stripe Dashboard > Webhooks shows all deliveries failing with signature mismatch
- Server logs show `stripe.webhooks.constructEvent` throwing `WebhookSignatureVerificationError`

**Phase to address:** Webhook endpoint setup -- verify this works before building any payment flow

---

### Pitfall 3: Payment Succeeds Client-Side But Tokens Never Arrive (Fulfillment Race)

**What goes wrong:**
User taps Apple Pay, sees the checkmark animation, the Express Checkout Element's `onComplete` fires on the client. Your frontend shows "Purchase complete!" and navigates the user to the feed. But the webhook hasn't arrived yet (or failed silently). The user's balance hasn't changed. They refresh, still no tokens. They paid real money and got nothing.

**Why it happens:**
The client-side payment confirmation and the server-side webhook are **completely independent, asynchronous events**. The webhook may arrive before, during, or after the client-side callback. On Netlify's serverless functions, cold starts can add 1-3 seconds of latency. If the webhook handler errors, the user has no idea.

Developers commonly make one of two mistakes:
1. **Fulfillment in the client callback only** -- credit tokens when `onComplete` fires. Works in testing, but the user can close the browser, lose connectivity, or the request can fail. Tokens are never credited.
2. **Fulfillment in both client callback AND webhook** -- leads to double-crediting (Pitfall 1).

**Consequences:**
- Users pay real money and receive nothing
- Support burden: "I paid but didn't get my tokens"
- Trust destruction -- this is the worst possible user experience for a paid feature

**Prevention:**
1. **Fulfill ONLY via webhook.** The webhook is the single source of truth for payment completion. Never credit tokens from client-side code.
2. **Client-side: poll for fulfillment.** After payment confirmation, poll the user's balance or a `purchases` table for the specific payment intent ID. Show a spinner: "Confirming your purchase..." until the webhook has processed.
3. **Implement a fulfillment status endpoint:**
   ```typescript
   // GET /api/purchases/[payment_intent_id]/status
   // Returns: { status: 'pending' | 'completed' | 'failed' }
   ```
4. **Timeout with helpful message:** If polling exceeds 15 seconds, show: "Your payment was received. Tokens may take up to a minute to appear. Contact support if they don't arrive within 5 minutes."
5. **The existing Supabase Realtime subscription on `token_ledger`** (`useUserBalance` hook) will automatically update the balance when the webhook inserts the ledger entry. Leverage this instead of building a separate polling mechanism.

**Detection:**
- Stripe shows successful payments that have no corresponding `token_ledger` entry
- Users reporting zero-balance after purchase

**Phase to address:** Payment flow integration -- build the polling/realtime approach alongside the Express Checkout Element

---

### Pitfall 4: Webhook Endpoint Times Out on Netlify (10-Second Limit)

**What goes wrong:**
Your webhook handler receives the Stripe event, verifies the signature, checks for duplicates, inserts into `stripe_events`, inserts into `token_ledger` via RPC, and tries to return 200. But the Supabase RPC call takes 3 seconds due to a cold connection, and combined with signature verification and the initial Netlify cold start, the total execution exceeds Netlify's 10-second function timeout. Netlify kills the function. Stripe gets no response. Stripe retries. The retry hits the same timeout. After 3 days and dozens of retries, Stripe marks the webhook as permanently failed.

**Why it happens:**
Netlify serverless functions (which Next.js API routes compile to on Netlify) have a hard 10-second timeout on free/starter plans (26 seconds on Pro). Supabase connections from serverless functions suffer cold start latency. Multiple developers have reported Netlify functions being "completely unresponsive" for webhook events -- not timing out in the expected way but simply never executing.

**Consequences:**
- Intermittent fulfillment failures -- some payments go through, others don't
- Extremely hard to debug because it's timing-dependent
- Users lose trust when payment reliability is unpredictable

**Prevention:**
1. **Keep the webhook handler minimal.** Verify signature, check duplicate, INSERT into a `pending_purchases` table, return 200 immediately. Process the actual token credit asynchronously.
2. **Use a Supabase database trigger** instead of application-level processing: when a row is inserted into `pending_purchases`, a trigger function handles the `token_ledger` insert. This moves the heavy work out of the serverless function.
3. **Alternatively, use the atomic RPC approach** but ensure the RPC is fast (< 2 seconds). Pre-warm the Supabase connection by making a lightweight query first. The existing `place_bet` RPC pattern shows this works.
4. **Monitor webhook delivery in Stripe Dashboard** -- set up email alerts for webhook failure rates above 0%.
5. **If timeouts persist, consider Netlify Background Functions** (available on paid plans) which allow 15-minute execution, or use a Supabase Edge Function as the webhook endpoint instead of a Next.js route.

**Detection:**
- Stripe Dashboard shows webhook deliveries with timeout errors
- Netlify function logs show truncated execution
- Inconsistent token crediting (some payments work, some don't)

**Phase to address:** Infrastructure/deployment setup -- test webhook round-trip latency before going live

---

## Moderate Pitfalls

### Pitfall 5: Apple Pay Domain Verification Missing or Incomplete

**What goes wrong:**
You deploy the payment page. The Express Checkout Element renders. Google Pay button appears. Apple Pay button is invisible. You test on your iPhone in Safari -- nothing. Users on iPhones (likely a large portion of a friend group in the US) cannot pay.

**Why it happens:**
Apple Pay on the web requires explicit domain verification with Apple, handled through Stripe's dashboard or API. You must register:
- Your production domain (`frontrun.bet`)
- The `www` subdomain (`www.frontrun.bet`)
- Any preview/staging domains

Stripe hosts a verification file at `/.well-known/apple-developer-merchantid-domain-association` that Apple checks. If your Netlify deployment doesn't serve this file correctly (e.g., the path is rewritten by Next.js routing or blocked by middleware), verification silently fails.

**Consequences:**
- Apple Pay unavailable to all iOS/Safari users
- No error message shown to the user -- the button simply doesn't appear
- Difficult to debug because it works in Chrome/Google Pay but not Safari/Apple Pay

**Prevention:**
1. **Register domains in Stripe Dashboard** at Settings > Payment Method Domains before deploying the payment page
2. **Register BOTH `frontrun.bet` AND `www.frontrun.bet`** -- Apple requires both
3. **Verify the well-known file is accessible:** `curl https://frontrun.bet/.well-known/apple-developer-merchantid-domain-association` should return the Stripe-provided file
4. **Ensure Next.js middleware doesn't intercept** the `/.well-known/` path -- add an exclusion to the auth middleware matcher:
   ```typescript
   export const config = {
     matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.well-known).*)'],
   };
   ```
5. **Test on a real iPhone with Safari** -- emulators and desktop Chrome do not surface Apple Pay issues

**Detection:**
- Express Checkout Element shows Google Pay but not Apple Pay on Safari/iOS
- Stripe Dashboard shows domain verification status as "pending" or "failed"

**Phase to address:** Deployment/domain setup -- do this BEFORE building the payment UI, since it requires DNS/hosting changes

---

### Pitfall 6: Using Wrong Webhook Secret (Test vs Live Mode Mismatch)

**What goes wrong:**
You develop with Stripe test mode, using `whsec_test_xxx`. You deploy to production and set the environment variable `STRIPE_WEBHOOK_SECRET` to... the same test mode secret. Or you create a new webhook endpoint in Stripe's dashboard but forget to switch from test mode to live mode before copying the secret. Every webhook in production fails signature verification.

**Why it happens:**
Stripe has **separate webhook secrets for test and live modes**, even for the same endpoint URL. The Stripe CLI's `stripe listen` generates yet another temporary secret (`whsec_xxx`) that is different from both. Developers who develop locally with `stripe listen`, then deploy, often hardcode the CLI's temporary secret.

**Consequences:**
- All production payments are charged but tokens never credited
- Test mode works perfectly, creating false confidence
- The error ("Webhook signature verification failed") looks identical to Pitfall 2, making diagnosis harder

**Prevention:**
1. **Use separate environment variables:** `STRIPE_WEBHOOK_SECRET_TEST` and `STRIPE_WEBHOOK_SECRET_LIVE`
2. **Create webhook endpoints separately** in both test and live modes in the Stripe Dashboard
3. **Set Netlify environment variables per context:** test secret for deploy previews, live secret for production
4. **Never use the `stripe listen` CLI secret in deployed environments** -- it expires and is per-session
5. **Smoke test after every deploy:** trigger a test payment and verify the webhook was received successfully in Stripe Dashboard > Webhooks > Recent Deliveries

**Detection:**
- Stripe Dashboard shows webhook deliveries failing with 400 status
- Server logs show signature verification errors
- Works locally with `stripe listen` but fails in production

**Phase to address:** Environment configuration -- set up webhook secrets for both modes during initial Stripe setup

---

### Pitfall 7: Token Ledger `reason` CHECK Constraint Rejects Purchase Credits

**What goes wrong:**
The webhook handler fires, signature verifies, duplicate check passes, and then the `token_ledger` INSERT fails with: `ERROR: new row for relation "token_ledger" violates check constraint "token_ledger_reason_check"`. The existing `reason` column has a CHECK constraint allowing only: `signup_bonus`, `bet_placed`, `resolution_payout`, `market_cancelled_refund`, `adjustment`. There is no `token_purchase` reason.

**Why it happens:**
The migration from v1 (00001_initial_schema.sql) defines a strict CHECK constraint on `token_ledger.reason`. Adding a new payment flow requires a database migration to add the new reason value. Developers who test with a fresh database that includes the new migration don't catch this because the constraint is already updated. But if the migration isn't applied to the production database first, the webhook handler will fail on every payment.

**Consequences:**
- Every token credit fails silently (or with an error that gets swallowed)
- The webhook returns a 500, Stripe retries, all retries fail
- Users are charged but never credited

**Prevention:**
1. **Write and apply the migration FIRST, before deploying any payment code:**
   ```sql
   -- 00006_add_token_purchase_reason.sql
   ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_reason_check;
   ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_reason_check
     CHECK (reason IN (
       'signup_bonus', 'bet_placed', 'resolution_payout',
       'market_cancelled_refund', 'adjustment', 'token_purchase'
     ));
   ```
2. **Deploy migrations before code.** Always. The new code must hit a database that already accepts the new reason value.
3. **Add an integration test** that inserts a `token_ledger` row with reason `token_purchase` and verifies it succeeds.

**Detection:**
- Webhook handler returns 500 errors
- Supabase logs show CHECK constraint violations
- `token_ledger` has no entries with reason `token_purchase` despite successful Stripe payments

**Phase to address:** Database migration -- deploy this migration as the very first step of the payments milestone

---

### Pitfall 8: Express Checkout Element Invisible Because No Wallet Configured

**What goes wrong:**
You implement the Express Checkout Element, deploy it, test in your desktop Chrome browser. Nothing renders. No Apple Pay button, no Google Pay button, no error. Just an empty div. You think the code is broken and spend hours debugging.

**Why it happens:**
The Express Checkout Element **only renders buttons for wallets the user actually has configured.** If your Chrome browser has no card saved in Google Pay (check `chrome://settings/payments`), and you're not on Safari with Apple Pay set up, the element renders nothing. This is by design -- Stripe won't show a payment method the user can't use.

During development, this creates a chicken-and-egg problem: you can't test the flow until you configure a wallet, but you don't know to configure a wallet because there's no error telling you to.

**Consequences:**
- Wasted debugging time thinking the integration is broken
- Developers add hacky workarounds or switch to a different payment approach unnecessarily
- Risk of shipping an untested payment flow

**Prevention:**
1. **Set up test wallets before developing:**
   - Google Pay: Go to `chrome://settings/payments`, add test card `4242 4242 4242 4242`, any future expiry, any CVC
   - Apple Pay: On macOS, add a card in Wallet & Apple Pay settings (real card works in Stripe test mode -- it generates test tokens without charging)
2. **Add a fallback payment method.** The Express Checkout Element should be paired with a standard Payment Element or a "Pay with Card" button for users without configured wallets
3. **Display a helpful message** when the Express Checkout Element renders empty: "To use Apple Pay or Google Pay, add a card to your device wallet. Or tap 'Pay with Card' below."
4. **Use the `onReady` callback** to detect if any buttons rendered and conditionally show fallback UI

**Detection:**
- Express Checkout Element div is present in DOM but visually empty
- No JavaScript errors in console
- Works on one device but not another

**Phase to address:** Payment UI implementation -- set up test wallets on day one of development

---

### Pitfall 9: HTTPS Not Enforced / Mixed Content Blocks Apple Pay

**What goes wrong:**
Your Netlify deployment serves over HTTPS, but somewhere in your app -- an image URL, a CDN link, an API call -- uses plain HTTP. Safari blocks Apple Pay on pages with mixed content. The Express Checkout Element either doesn't render or throws a silent error.

Additionally, local development on `http://localhost:3000` means Apple Pay simply cannot be tested locally without HTTPS tunneling.

**Consequences:**
- Apple Pay silently fails on production if any mixed content exists
- Local development with Apple Pay requires extra tooling setup

**Prevention:**
1. **Audit all resource URLs** for `http://` references. Use CSP header `upgrade-insecure-requests` as a safety net
2. **For local Apple Pay testing,** use `ngrok` or `lcl.host` to get an HTTPS tunnel:
   ```bash
   ngrok http 3000
   # Register the ngrok domain in Stripe Dashboard for Apple Pay
   ```
3. **Google Pay is more forgiving** -- it works on `localhost` in Chrome with test cards, so use it for primary development testing
4. **Netlify forces HTTPS by default** (good), but verify that any custom domain DNS has proper HTTPS redirect rules

**Detection:**
- Browser console shows mixed content warnings
- Apple Pay button missing only on specific pages (the ones with mixed content)

**Phase to address:** Development environment setup -- configure HTTPS tunneling before starting Apple Pay integration

---

### Pitfall 10: No Fallback for Users Without Mobile Wallets

**What goes wrong:**
You build the payment page with only the Express Checkout Element (Apple Pay / Google Pay). A user on an Android phone without Google Pay set up, or on a desktop without any wallet, sees an empty payment page with no way to buy tokens. They can't purchase anything.

**Why it happens:**
The project spec says "Apple Pay / Google Pay via Stripe" which developers interpret as "only these two methods." But not all users will have wallets configured, especially in a friend group with mixed device/wallet adoption.

**Consequences:**
- Subset of users completely unable to purchase tokens
- Frustration and support requests: "How do I buy tokens?"
- Lost revenue from users who would have paid via card entry

**Prevention:**
1. **Use the Express Checkout Element for wallet payments AND the Payment Element as a fallback** for manual card entry:
   ```tsx
   <ExpressCheckoutElement onConfirm={handlePayment} />
   {!walletAvailable && <PaymentElement />}
   ```
2. **Or use Stripe Checkout (hosted)** which automatically shows all available payment methods including card entry -- simplest approach but redirects away from your app
3. **At minimum, provide a standard card form** via the Payment Element below the wallet buttons

**Detection:**
- Users reporting they can't find a way to pay
- Analytics showing the payment page has high bounce rate

**Phase to address:** Payment UI implementation -- design the payment page with fallback from the start

---

## Minor Pitfalls

### Pitfall 11: Stripe Publishable Key Exposed in Client Bundle (Expected but Misunderstood)

**What goes wrong:**
Nothing, actually. But developers panic when they see `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in the client bundle and think they have a security vulnerability. They try to hide it server-side, breaking the Stripe Elements integration.

**Prevention:**
- The publishable key is **designed to be public**. It can only create tokens and confirm payments -- it cannot charge cards, issue refunds, or access account data.
- **The secret key (`STRIPE_SECRET_KEY`) must NEVER be in client code or `NEXT_PUBLIC_` variables.**
- Name it clearly: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (publishable) vs `STRIPE_SECRET_KEY` (server-only).

**Phase to address:** Initial Stripe setup -- document this in the project README so no one "fixes" it later

---

### Pitfall 12: Not Handling `payment_intent.payment_failed` Events

**What goes wrong:**
You handle `payment_intent.succeeded` to credit tokens. A user's card is declined. Stripe fires `payment_intent.payment_failed`. Your webhook ignores it. The user sees an error in the Apple Pay sheet but your app shows "Processing..." forever (from the polling/spinner in Pitfall 3's prevention).

**Prevention:**
- Handle `payment_intent.payment_failed` in your webhook to update the purchase status to `failed`
- Client-side polling should detect the `failed` status and show a clear error: "Payment declined. Please try again or use a different card."
- Log failed payments for monitoring (high failure rates may indicate card testing fraud)

**Phase to address:** Webhook handler implementation -- handle both success and failure events

---

### Pitfall 13: Not Storing Purchase Records for Receipt/History Display

**What goes wrong:**
You credit tokens via `token_ledger` with reason `token_purchase` and `reference_id` pointing to the Stripe payment intent. But the `token_ledger` doesn't store the dollar amount, pack tier, or any receipt-friendly information. Users go to "Purchase History" and see: "+500 tokens, token_purchase" with no indication of how much they paid.

**Prevention:**
- Create a `purchases` table that stores: `user_id`, `stripe_payment_intent_id`, `amount_cents`, `token_amount`, `pack_tier`, `status`, `created_at`
- The `token_ledger` entry's `reference_id` points to the `purchases` row ID
- This table also enables the fulfillment status polling from Pitfall 3

**Phase to address:** Database schema -- design the `purchases` table alongside the `stripe_events` table

---

## Regulatory / Legal Pitfalls

### Pitfall 14: Virtual Currency + Real Money = Potential Money Transmitter Classification

**What goes wrong:**
Users buy tokens with real USD. Tokens are used to bet on prediction markets. Top performers win real USD prizes. A regulator looks at this and sees: USD in -> virtual currency -> USD out. This pattern can trigger money transmitter classification under FinCEN guidelines, requiring registration, BSA/AML programs, and state-level licensing.

**Why it happens:**
The project is explicitly designed as "deposit only, no withdrawals" to avoid this. But the prize system creates an indirect USD-out path. The key regulatory question is whether the virtual currency is "convertible" -- if users can extract USD value from it (even indirectly via prizes).

**Consequences:**
- If classified as a money transmitter: federal registration with FinCEN, BSA/AML program, state licensing (47+ states), annual audits
- Non-compliance penalties are severe (fines, criminal liability)

**Prevention:**
1. **Terms of Service must explicitly state:**
   - Tokens are a "limited, non-transferable, non-exclusive license" with no cash value
   - Tokens cannot be sold, exchanged, transferred between users, or redeemed for cash
   - Prizes are awarded based on leaderboard performance, not token redemption
2. **Prize structure should be framed as contest winnings**, not token cashout. The prize is for "best predictor" performance, not for holding the most tokens.
3. **No token-to-token transfers between users.** This is a bright line -- if users can send tokens to each other, the token becomes more currency-like.
4. **Consult a lawyer** before going live with real money. This pitfall research is not legal advice.

**Detection:**
- N/A -- this is a design-time decision, not a runtime error

**Phase to address:** Before accepting the first dollar -- terms of service and prize structure must be finalized

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Database migration | CHECK constraint rejects `token_purchase` (Pitfall 7) | Deploy migration before any payment code |
| Stripe account setup | Domain verification missing (Pitfall 5), wrong webhook secret (Pitfall 6) | Register domains and create webhook endpoints in both test and live mode upfront |
| Webhook endpoint | Signature verification fails (Pitfall 2), timeout on Netlify (Pitfall 4) | Use `request.text()` for raw body; keep handler minimal |
| Idempotency layer | Double-crediting tokens (Pitfall 1) | `stripe_events` table with UNIQUE on `event_id`; atomic RPC |
| Payment UI | Invisible buttons (Pitfall 8), no fallback (Pitfall 10) | Set up test wallets; include Payment Element fallback |
| Fulfillment flow | Tokens never arrive despite payment (Pitfall 3) | Fulfill only via webhook; leverage existing Realtime subscription for balance updates |
| Going live | Test vs live key mismatch (Pitfall 6) | Separate env vars per mode; smoke test after deploy |
| Legal/regulatory | Money transmitter risk (Pitfall 14) | Terms of service, prize framing, legal review |

---

## Integration Gotchas Specific to This Stack

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| Next.js App Router + Stripe webhook | Using `request.json()` instead of `request.text()` | Always use `request.text()` for raw body in webhook route handler |
| Netlify + Stripe webhook | Function timeout kills webhook processing | Keep handler under 5 seconds; use Supabase RPC for atomic operations |
| Supabase + Stripe | No idempotency layer between webhook and ledger | `stripe_events` table with UNIQUE constraint on Stripe event ID |
| token_ledger + payments | Existing CHECK constraint on `reason` column | Add `token_purchase` to allowed values via migration before deploying payment code |
| Express Checkout Element | Not registering domain for Apple Pay | Register `frontrun.bet` AND `www.frontrun.bet` in Stripe Dashboard |
| Express Checkout Element | No fallback for users without wallets | Pair with Payment Element or standard card form |
| Middleware + Apple Pay | Auth middleware blocks `/.well-known/` verification file | Exclude `/.well-known` from middleware matcher pattern |
| Supabase Realtime + purchases | Building separate polling when Realtime already watches `token_ledger` | Reuse existing `useUserBalance` hook -- it auto-updates on any `token_ledger` INSERT |
| Stripe test mode | Using real cards in test mode (rejected) or test cards in live mode (rejected) | Use `4242 4242 4242 4242` in test; real cards in live only |
| Local development | Trying to test Apple Pay on localhost | Use `ngrok` for HTTPS tunnel; test Google Pay on localhost instead |

---

## "Looks Done But Isn't" Checklist

- [ ] **Idempotency:** Same Stripe event processed twice results in exactly one `token_ledger` entry -- verify with a test that sends duplicate events
- [ ] **Webhook signature:** Handler uses `request.text()` not `request.json()` -- verify with `stripe listen --forward-to`
- [ ] **Domain verification:** Apple Pay button appears on a real iPhone in Safari on `frontrun.bet` -- not just Chrome on desktop
- [ ] **Fulfillment path:** Tokens are credited ONLY from webhook, never from client-side callback -- verify by disabling webhook and confirming zero credit
- [ ] **Fallback payment:** Users without Apple Pay or Google Pay can still purchase via card entry
- [ ] **CHECK constraint:** `token_purchase` reason accepted by `token_ledger` in production database
- [ ] **Webhook secret:** Production environment uses the LIVE mode webhook secret, not test mode
- [ ] **Timeout safety:** Webhook handler completes in < 5 seconds on Netlify -- load test the endpoint
- [ ] **Purchase records:** User can see purchase history with dollar amounts, not just ledger entries
- [ ] **Error handling:** `payment_intent.payment_failed` events are handled and surface user-visible errors
- [ ] **Mixed content:** No HTTP resources on the payment page (blocks Apple Pay in Safari)
- [ ] **Terms of service:** Updated to cover token purchases, no-refund policy, and non-convertibility of tokens

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double-credited tokens (Pitfall 1) | MEDIUM | Query `token_ledger` for duplicate `reference_id` values with reason `token_purchase`; insert negative `adjustment` entries to correct; add `stripe_events` dedup table retroactively |
| Webhook silently failing (Pitfall 2, 4, 6) | HIGH | Cross-reference Stripe Dashboard payments with `token_ledger` entries; manually credit missing tokens via admin `adjustment`; fix the webhook and reprocess failed events via Stripe's event replay |
| Users charged but no tokens (Pitfall 3) | HIGH (trust damage) | Immediate communication to affected users; manual token credit; consider bonus tokens as goodwill; issue Stripe refunds if tokens can't be credited |
| Apple Pay not working (Pitfall 5) | LOW | Register domains, wait for propagation (up to 24 hours), redeploy |
| CHECK constraint blocking credits (Pitfall 7) | LOW | Apply migration immediately; reprocess failed webhook events from Stripe |

---

## Sources

- [Stripe Webhook Best Practices -- Stigg](https://www.stigg.io/blog-posts/best-practices-i-wish-we-knew-when-integrating-stripe-webhooks) -- Webhook retry behavior, idempotency patterns, event ordering
- [Stripe Idempotent Requests API Reference](https://docs.stripe.com/api/idempotent_requests) -- Official idempotency key documentation
- [Stripe Apple Pay Web Documentation](https://docs.stripe.com/apple-pay?platform=web) -- Domain verification requirements, test vs live mode
- [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) -- Supported wallets, migration from Payment Request Button
- [Stripe Test Wallets Documentation](https://docs.stripe.com/testing/wallets) -- How to test Apple Pay and Google Pay, device requirements
- [Stripe Webhook Signature Verification](https://docs.stripe.com/webhooks/signature) -- Raw body requirement, common errors
- [Stripe Payment Intents API](https://docs.stripe.com/payments/payment-intents) -- Lifecycle, status transitions, reuse patterns
- [Next.js App Router Stripe Webhook Issue #60002](https://github.com/vercel/next.js/issues/60002) -- `request.text()` vs `request.json()` for raw body
- [Netlify Functions Timeout Documentation](https://answers.netlify.com/t/support-guide-why-is-my-function-taking-long-or-timing-out/71689) -- 10-second limit, background functions
- [Netlify Stripe Webhook Inconsistency Thread](https://answers.netlify.com/t/netlify-functions-not-executing-stripe-webhook-events-consistently/48846) -- Functions not executing reliably
- [Supabase Stripe Webhook Handling](https://supabase.com/docs/guides/functions/examples/stripe-webhooks) -- Edge Function webhook pattern
- [Stripe Checkout vs Payment Intents Comparison](https://docs.stripe.com/payments/checkout-sessions-and-payment-intents-comparison) -- When to use which API
- [Stripe Payment Events Webhook Documentation](https://docs.stripe.com/webhooks/handling-payment-events) -- Which events to handle for fulfillment
- [Hookdeck Webhook Idempotency Guide](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency) -- Database upsert pattern for deduplication
- [Handling Duplicate Stripe Events -- Duncan Mackenzie](https://www.duncanmackenzie.net/blog/handling-duplicate-stripe-events/) -- Practical deduplication implementation
- [Venable -- Regulatory Risks of Virtual Currency](https://www.venable.com/insights/publications/2017/05/regulatory-risks-of-ingame-and-inapp-virtual-curre) -- Money transmitter classification for virtual currencies
- [FinCEN Virtual Currency Guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering) -- Convertible virtual currency definitions
- [lcl.host Apple Pay Testing Guide](https://anchor.dev/blog/stripe-nextjs-lclhost) -- Local HTTPS for Apple Pay development
- [Webhook Security Fundamentals -- Hooklistener](https://www.hooklistener.com/learn/webhook-security-fundamentals) -- CSRF exemption, rate limiting, IP validation

---

*Pitfalls research for: Adding USD token purchases (Stripe + Apple Pay / Google Pay) to Frontrun prediction market*
*Researched: 2026-02-21*
