# Architecture Research: USD Token Purchase via Stripe

**Domain:** Payment integration for mobile-first prediction market (Stripe + Apple Pay / Google Pay)
**Researched:** 2026-02-21
**Confidence:** HIGH -- Stripe patterns verified via official docs; Next.js App Router integration verified across multiple sources; token ledger integration is a straightforward extension of existing append-only pattern.

---

## System Overview: Payment Integration Layer

The payment system adds a new vertical alongside the existing market/betting system. It introduces Stripe as an external dependency, a new API route layer for payment intents and webhooks, a new database table for purchase records, and a new ledger reason for token credits.

```
                         Existing System
                    ┌─────────────────────────┐
                    │   Next.js App Router     │
                    │   Server Actions         │
                    │   (markets, bets, auth)  │
                    └──────────┬──────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────┐
│                    Payment Integration Layer                  │
│                                                              │
│  ┌──────────────┐    ┌─────────────────┐    ┌────────────┐  │
│  │ Buy Tokens   │    │ API Route       │    │ Webhook    │  │
│  │ Page (client)│───>│ /api/payments/  │    │ /api/      │  │
│  │              │    │ create-intent   │    │ webhooks/  │  │
│  │ Express      │    └────────┬────────┘    │ stripe     │  │
│  │ Checkout     │             │             └─────┬──────┘  │
│  │ Element      │             │                   │         │
│  └──────┬───────┘             │                   │         │
│         │                     │                   │         │
│         │              ┌──────┴──────┐     ┌──────┴──────┐  │
│         └─────────────>│   Stripe    │────>│   Stripe    │  │
│           (client_     │   API       │     │   Webhooks  │  │
│            secret)     └─────────────┘     └─────────────┘  │
│                                                              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                    ┌──────────┴──────────────┐
                    │   Supabase PostgreSQL    │
                    │                          │
                    │  token_purchases (new)   │
                    │  token_ledger (existing) │
                    │  user_balances (view)    │
                    └─────────────────────────┘
```

---

## New Components (What to Build)

### 1. API Route: Create Payment Intent

**Path:** `src/app/api/payments/create-intent/route.ts`

**Why a Route Handler instead of a Server Action:** Stripe's Express Checkout Element calls a fetch endpoint to get the `client_secret`. This is an API request initiated by a client-side event handler (the `onConfirm` callback), not a form submission. Route Handlers are the correct Next.js primitive for this.

**Responsibility:**
- Authenticate the user (via Supabase server client from cookies)
- Validate the requested token pack tier ($5 / $10 / $20)
- Create a Stripe PaymentIntent with the correct amount (in cents)
- Store a pending purchase record in `token_purchases`
- Return `{ clientSecret }` to the client

**Data flow:**

```
Client (onConfirm) ──POST──> /api/payments/create-intent
                              │
                              ├── Authenticate user (Supabase server client)
                              ├── Validate tier (Zod schema)
                              ├── Create PaymentIntent (Stripe server SDK)
                              ├── Insert token_purchases row (status: 'pending')
                              └── Return { clientSecret: pi.client_secret }
```

**Example implementation pattern:**

```typescript
// src/app/api/payments/create-intent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const TIERS = {
  small:  { price_cents: 500,  tokens: 500,  label: '500 Tokens' },
  medium: { price_cents: 1000, tokens: 1200, label: '1,200 Tokens' },
  large:  { price_cents: 2000, tokens: 2800, label: '2,800 Tokens' },
} as const;

const createIntentSchema = z.object({
  tier: z.enum(['small', 'medium', 'large']),
});

export async function POST(request: NextRequest) {
  const ts = new Date().toISOString();

  // 1. Authenticate
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2. Validate input
  const body = await request.json();
  const parsed = createIntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }

  const tier = TIERS[parsed.data.tier];

  // 3. Create PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: tier.price_cents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: {
      user_id: user.id,
      tier: parsed.data.tier,
      tokens: tier.tokens.toString(),
    },
  });

  // 4. Record pending purchase
  const admin = createAdminClient();
  await admin.from('token_purchases').insert({
    user_id: user.id,
    stripe_payment_intent_id: paymentIntent.id,
    tier: parsed.data.tier,
    amount_cents: tier.price_cents,
    tokens_credited: tier.tokens,
    status: 'pending',
  });

  console.info(`[${ts}] create-intent INFO: PI ${paymentIntent.id} for user ${user.id}, tier ${parsed.data.tier}`);

  return NextResponse.json({ clientSecret: paymentIntent.client_secret });
}
```

### 2. API Route: Stripe Webhook Handler

**Path:** `src/app/api/webhooks/stripe/route.ts`

**Responsibility:**
- Verify Stripe webhook signature (using raw body via `request.text()`)
- Handle `payment_intent.succeeded` event
- Idempotently credit tokens to the user's ledger
- Update `token_purchases` status to `completed`

**Why webhooks instead of trusting the client redirect:** The client-side `confirmPayment` can fail silently, the user can close the browser, or the redirect can break. Webhooks are the only reliable confirmation that money was actually collected. Token credits MUST happen in the webhook handler, never on the client.

**Idempotency pattern:** Use the `stripe_payment_intent_id` as the idempotency key. Before crediting tokens, check if `token_purchases` already has `status = 'completed'` for that PI. If so, return 200 and skip.

**Data flow:**

```
Stripe ──POST──> /api/webhooks/stripe
                  │
                  ├── Verify signature (stripe.webhooks.constructEvent)
                  ├── Extract payment_intent from event
                  ├── Read metadata (user_id, tier, tokens)
                  ├── Check token_purchases for idempotency
                  ├── INSERT token_ledger (reason: 'token_purchase')
                  ├── UPDATE token_purchases SET status = 'completed'
                  └── Return 200
                        │
                        ├── Supabase Realtime fires INSERT on token_ledger
                        └── useUserBalance hook picks up new balance automatically
```

**Critical: raw body for signature verification.**

```typescript
// src/app/api/webhooks/stripe/route.ts
export async function POST(request: NextRequest) {
  const body = await request.text(); // MUST be text(), not json()
  const signature = request.headers.get('stripe-signature')!;

  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
  // ... handle event
}
```

**Netlify compatibility:** `request.text()` works correctly on Netlify with Next.js App Router route handlers. Verified across multiple sources. No special configuration needed.

### 3. Client Page: Buy Tokens

**Path:** `src/app/(app)/buy/page.tsx`

**Responsibility:**
- Display token pack tiers with pricing
- Initialize Stripe Elements with Express Checkout Element
- Handle the payment flow (select tier -> confirm -> redirect)
- Show success/failure state

**Key architectural decisions:**
- This page is inside `(app)/` route group, so it inherits auth protection from middleware
- Uses `'use client'` directive -- Stripe Elements require client-side rendering
- Wraps content in `<Elements>` provider from `@stripe/react-stripe-js`
- Uses `ExpressCheckoutElement` (not the legacy `PaymentRequestButtonElement`)

**Component structure:**

```
src/app/(app)/buy/
  page.tsx            -- Server component: page shell, metadata
  BuyTokensClient.tsx -- Client component: tier selection + Stripe Elements

src/components/payments/
  ExpressCheckout.tsx  -- Wraps ExpressCheckoutElement with onConfirm logic
  TierSelector.tsx     -- Token pack selection UI
  PurchaseSuccess.tsx  -- Post-payment confirmation
```

### 4. Client Component: Express Checkout

**Why Express Checkout Element over Payment Request Button:** Stripe has deprecated the Payment Request Button Element. The Express Checkout Element is the recommended replacement. It supports Apple Pay, Google Pay, Link, and future wallet methods through a single unified component.

**Component pattern:**

```typescript
// src/components/payments/ExpressCheckout.tsx
'use client';

import { useState } from 'react';
import {
  useStripe,
  useElements,
  ExpressCheckoutElement,
} from '@stripe/react-stripe-js';

export function ExpressCheckout({ tier }: { tier: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    if (!stripe || !elements) return;

    // 1. Submit elements (validates payment details)
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Payment failed');
      return;
    }

    // 2. Create PaymentIntent server-side
    const res = await fetch('/api/payments/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    const { clientSecret } = await res.json();

    // 3. Confirm payment with Stripe
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: `${window.location.origin}/buy?success=true`,
      },
    });

    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed');
    }
  };

  return (
    <>
      <ExpressCheckoutElement onConfirm={onConfirm} />
      {error && <p className="text-destructive text-sm mt-2">{error}</p>}
    </>
  );
}
```

**Elements provider wrapping pattern:**

```typescript
// src/app/(app)/buy/BuyTokensClient.tsx
'use client';

import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { ExpressCheckout } from '@/components/payments/ExpressCheckout';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

export function BuyTokensClient({ tier, amountCents }: Props) {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: 'payment',
        amount: amountCents,
        currency: 'usd',
      }}
    >
      <ExpressCheckout tier={tier} />
    </Elements>
  );
}
```

### 5. Database: New Table + Ledger Extension

**New table: `token_purchases`**

```sql
CREATE TABLE token_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES profiles(id),
  stripe_payment_intent_id TEXT UNIQUE NOT NULL,
  tier                     TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  amount_cents             INTEGER NOT NULL,
  tokens_credited          INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'completed', 'failed')),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX idx_token_purchases_user ON token_purchases(user_id);
CREATE UNIQUE INDEX idx_token_purchases_pi ON token_purchases(stripe_payment_intent_id);

ALTER TABLE token_purchases ENABLE ROW LEVEL SECURITY;

-- Users can read their own purchases (for purchase history)
CREATE POLICY "Users can read own purchases"
  ON token_purchases FOR SELECT
  USING (auth.uid() = user_id);

-- Service role manages all mutations
CREATE POLICY "Service role can manage purchases"
  ON token_purchases FOR ALL
  USING (true)
  WITH CHECK (true);
```

**Token ledger extension:** Add `'token_purchase'` to the `reason` CHECK constraint.

```sql
-- Migration: add token_purchase reason to ledger
ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_reason_check;
ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_reason_check
  CHECK (reason IN (
    'signup_bonus',
    'bet_placed',
    'resolution_payout',
    'market_cancelled_refund',
    'adjustment',
    'token_purchase'
  ));
```

### 6. Supabase RPC: Credit Tokens (Atomic)

**New stored procedure: `credit_token_purchase`**

This ensures the token credit and purchase status update happen atomically, preventing double-credits or orphaned state.

```sql
CREATE OR REPLACE FUNCTION credit_token_purchase(
  p_payment_intent_id TEXT,
  p_user_id UUID,
  p_tokens INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase RECORD;
  v_ledger_id UUID;
BEGIN
  -- Lock the purchase row
  SELECT * INTO v_purchase
    FROM token_purchases
    WHERE stripe_payment_intent_id = p_payment_intent_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Purchase not found');
  END IF;

  -- Idempotency: already completed
  IF v_purchase.status = 'completed' THEN
    RETURN json_build_object('already_processed', true);
  END IF;

  -- Verify user matches
  IF v_purchase.user_id != p_user_id THEN
    RETURN json_build_object('error', 'User mismatch');
  END IF;

  -- Credit tokens to ledger
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, p_tokens, 'token_purchase', v_purchase.id)
    RETURNING id INTO v_ledger_id;

  -- Mark purchase completed
  UPDATE token_purchases
    SET status = 'completed', completed_at = NOW()
    WHERE id = v_purchase.id;

  RETURN json_build_object(
    'success', true,
    'ledger_id', v_ledger_id,
    'tokens_credited', p_tokens
  );
END;
$$;
```

---

## Data Flow: Complete Payment-to-Token-Credit Journey

```
User opens /buy
    |
    v
BuyTokensClient renders tier options ($5/$10/$20)
    |
User selects tier, taps Apple Pay / Google Pay button
    |
    v
ExpressCheckoutElement shows native wallet sheet
    |
User authenticates (Face ID / fingerprint / device PIN)
    |
    v
onConfirm fires:
    |
    ├── elements.submit() -- validates payment details
    |
    ├── POST /api/payments/create-intent { tier: 'medium' }
    |   |
    |   ├── Authenticate user from cookies
    |   ├── stripe.paymentIntents.create({ amount: 1000, currency: 'usd' })
    |   ├── INSERT token_purchases (status: 'pending', PI: pi_xxx)
    |   └── Return { clientSecret: 'pi_xxx_secret_yyy' }
    |
    ├── stripe.confirmPayment({ elements, clientSecret })
    |   |
    |   └── Stripe processes payment, charges card
    |
    └── Browser redirects to /buy?success=true
        |
        v
    (Meanwhile, asynchronously...)
        |
    Stripe sends webhook POST to /api/webhooks/stripe
        |
        ├── Verify signature with raw body
        ├── Extract: payment_intent.id, metadata.user_id, metadata.tokens
        ├── Call RPC credit_token_purchase(pi_id, user_id, tokens)
        |   |
        |   ├── Check idempotency (already completed? skip)
        |   ├── INSERT token_ledger (+1200 tokens, reason: 'token_purchase')
        |   └── UPDATE token_purchases SET status = 'completed'
        |
        └── Return 200 to Stripe
                |
                v
        Supabase Realtime fires INSERT event on token_ledger
                |
                v
        useUserBalance hook re-fetches balance
                |
                v
        User sees updated balance in the header (no refresh needed)
```

---

## Integration Points with Existing Architecture

### Minimal Disruption Points

| Existing Component | Change Required | Impact |
|---|---|---|
| `token_ledger` table | Add `'token_purchase'` to reason CHECK constraint | Migration only, no code changes |
| `user_balances` view | None -- already derives from `SUM(token_ledger.amount)` | Automatic |
| `useUserBalance` hook | None -- already subscribes to `token_ledger` INSERTs | Automatic |
| `middleware.ts` | None -- `/buy` falls under `(app)/` route group, auto-protected | Automatic |
| `BottomNav` component | Add "Buy" nav item linking to `/buy` | Trivial UI change |
| `TopNav` component | Optional: add token balance + buy CTA | Small UI change |
| `CLAUDE.md` conventions | Add `token_purchase` to ledger reasons list | Documentation |
| `package.json` | Add `stripe`, `@stripe/stripe-js`, `@stripe/react-stripe-js` | Dependencies |

### No Changes Required

These components work automatically because the payment system writes to the same `token_ledger` table:

- **Balance display** (`useUserBalance`) -- subscribes to ALL `token_ledger` inserts, regardless of reason
- **Leaderboard** -- queries `user_balances` view, which sums all ledger entries
- **Bet placement** -- checks balance from ledger sum, purchased tokens are indistinguishable from signup tokens
- **Prize system** -- based on leaderboard ranking, unaffected by token source

### New Components Summary

| Component | Type | Path |
|---|---|---|
| Create PaymentIntent | Route Handler (POST) | `src/app/api/payments/create-intent/route.ts` |
| Stripe Webhook | Route Handler (POST) | `src/app/api/webhooks/stripe/route.ts` |
| Buy Tokens page | Server Component | `src/app/(app)/buy/page.tsx` |
| Buy Tokens client | Client Component | `src/app/(app)/buy/BuyTokensClient.tsx` |
| Express Checkout | Client Component | `src/components/payments/ExpressCheckout.tsx` |
| Tier Selector | Client Component | `src/components/payments/TierSelector.tsx` |
| Purchase Success | Client Component | `src/components/payments/PurchaseSuccess.tsx` |
| Purchase History | Server/Client Component | `src/components/payments/PurchaseHistory.tsx` |
| Stripe server SDK | Utility | `src/lib/stripe/server.ts` |
| Stripe client loader | Utility | `src/lib/stripe/client.ts` |
| Token pack config | Constants | `src/lib/stripe/tiers.ts` |
| DB migration | SQL | `supabase/migrations/00006_token_purchases.sql` |
| RPC function | SQL | Part of migration 00006 |

---

## Architectural Patterns

### Pattern 1: Deferred Fulfillment via Webhook

**What:** Never credit tokens when the client reports success. Always wait for the `payment_intent.succeeded` webhook from Stripe. The client redirect to `?success=true` shows a "processing" state, and the balance updates via Realtime once the webhook fires.

**Why:** The client can lie, the redirect can fail, 3D Secure can timeout. Only Stripe's webhook is authoritative confirmation that money was collected. This is the single most important architectural decision.

**Timing:** In practice, the webhook fires within 1-3 seconds of payment confirmation. Users will see their balance update almost immediately via the existing Realtime subscription.

### Pattern 2: Idempotent Webhook Processing

**What:** Use `stripe_payment_intent_id` as the idempotency key. The `credit_token_purchase` RPC checks if the purchase is already `completed` before crediting tokens. Stripe may send the same webhook multiple times.

**Why:** Stripe explicitly documents that webhooks can be delivered more than once. Double-crediting tokens is a critical bug -- users get free money.

**Implementation:** The `FOR UPDATE` row lock on `token_purchases` plus the status check in the RPC function handles concurrent webhook deliveries safely.

### Pattern 3: Server-Determined Pricing

**What:** The server defines token pack tiers and prices. The client selects a tier name (`small`, `medium`, `large`), and the server maps it to the authoritative price. The client never sends a dollar amount.

**Why:** If the client sends `{ amount: 100, tokens: 10000 }`, users can manipulate the request to get tokens at a fraction of the price. The same principle as server-side AMM math.

### Pattern 4: Stripe Metadata for Webhook Context

**What:** Store `user_id`, `tier`, and `tokens` in the PaymentIntent `metadata` field. The webhook handler reads these from the event payload, so it has everything needed to credit the right user without extra database lookups.

**Why:** The webhook handler receives the PaymentIntent object from Stripe. Metadata is the official mechanism for attaching application-specific data to Stripe objects. Alternative: look up `token_purchases` by PI ID. We do both (metadata for quick access, DB record as source of truth).

### Pattern 5: Express Checkout Element (Not Payment Request Button)

**What:** Use `<ExpressCheckoutElement>` from `@stripe/react-stripe-js`, not the legacy `<PaymentRequestButtonElement>`.

**Why:** Payment Request Button is a legacy element. Stripe recommends migrating to Express Checkout Element, which supports Apple Pay, Google Pay, Link, PayPal, and future payment methods through a single component. The API is simpler (declarative `onConfirm` prop vs imperative event listeners).

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Client-Side Token Crediting

**What people do:** After `stripe.confirmPayment()` succeeds on the client, immediately call a server action to credit tokens.

**Why it's wrong:** The client can spoof this call. The payment might be declined after initial authorization (fraud checks, insufficient funds on settlement). The user closes the browser before the call fires.

**Do this instead:** Credit tokens ONLY in the webhook handler. Show "processing" state on the client, and let Realtime update the balance.

### Anti-Pattern 2: Using `request.json()` for Webhook Body

**What people do:** Parse the webhook body with `await request.json()`.

**Why it's wrong:** Stripe's signature verification requires the raw string body. `request.json()` parses it, and re-stringifying produces a different byte sequence, causing signature verification to fail every time.

**Do this instead:** Use `await request.text()` to get the raw body string.

### Anti-Pattern 3: Skipping Webhook Signature Verification

**What people do:** Skip `stripe.webhooks.constructEvent()` for "simplicity" during development.

**Why it's wrong:** Anyone can POST to your webhook URL and credit themselves unlimited tokens. This is a real attack vector, not a theoretical concern.

**Do this instead:** Always verify. Use `stripe listen --forward-to localhost:3000/api/webhooks/stripe` for local development, which provides a test webhook secret.

### Anti-Pattern 4: Storing Stripe Secret Key in `NEXT_PUBLIC_` Env Var

**What people do:** Prefix the Stripe secret key with `NEXT_PUBLIC_` so it's accessible everywhere.

**Why it's wrong:** Exposes the secret key to the browser. Anyone can create arbitrary PaymentIntents, issue refunds, or access customer data.

**Do this instead:** `STRIPE_SECRET_KEY` (no `NEXT_PUBLIC_` prefix) for server-only code. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for the client.

### Anti-Pattern 5: Creating PaymentIntent on Page Load

**What people do:** Create a PaymentIntent when the buy page loads, before the user has selected a tier or initiated payment.

**Why it's wrong:** Creates abandoned PaymentIntents that clutter the Stripe dashboard. Costs nothing financially, but creates noise and complicates analytics.

**Do this instead:** Create the PaymentIntent in the `onConfirm` handler, right before `confirmPayment`. This is the "deferred intent creation" pattern recommended for Express Checkout Element.

---

## Environment Variables (New)

```
# Server-only (never NEXT_PUBLIC_)
STRIPE_SECRET_KEY=sk_live_...           # Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...         # Webhook signing secret

# Client-safe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...  # Stripe publishable key
```

These need to be set in:
1. `.env.local` for development
2. Netlify environment variables for production
3. Stripe CLI provides a test webhook secret for local development

---

## Apple Pay Domain Verification

Apple Pay requires domain registration through Stripe:

1. Register `frontrun.bet` in the Stripe Dashboard under Payment Methods > Domains
2. Stripe handles the Apple merchant ID and certificate automatically -- no `.well-known` file hosting required
3. Must register separately for sandbox and live modes
4. Must register `www.frontrun.bet` separately if used
5. HTTPS is required (already satisfied -- Netlify provides TLS)

Google Pay has no domain registration requirement.

---

## Middleware Considerations

The existing `middleware.ts` protects all `(app)/` routes. The `/buy` page lives inside `(app)/`, so it's automatically protected. No middleware changes needed.

However, the webhook route at `/api/webhooks/stripe` must NOT require authentication. The middleware matcher currently excludes API routes that don't match the protected prefixes, so this works by default:

```typescript
// Existing protectedPrefixes - /api is NOT in this list
const protectedPrefixes = ['/feed', '/leaderboard', '/profile', '/admin', '/markets'];
```

The webhook route is accessible without auth. The Stripe signature verification serves as the authentication mechanism.

---

## Scaling Considerations

| Scale | Notes |
|---|---|
| 10-20 users | No concerns. Stripe handles all payment processing. Webhook handler is simple INSERT. |
| 100 users | Still no concerns. Stripe has no rate limits that matter at this scale. |
| 1K+ users | Consider adding a `token_purchases` index on `created_at` for purchase history pagination. |
| 10K+ users | If webhook volume gets high, consider a queue (but at $5-20 per purchase, 10K users is unlikely to generate problematic webhook volume). |

The payment system is inherently low-throughput compared to betting. Users buy tokens occasionally; they bet frequently. The existing architecture handles the high-frequency path (bets). Payments are the easy part.

---

## Build Order (Dependency-Driven)

This ordering respects the dependency chain:

```
Phase 1: Foundation
  1. DB migration (token_purchases table + ledger reason + RPC function)
  2. Stripe server SDK utility (src/lib/stripe/server.ts)
  3. Stripe client loader (src/lib/stripe/client.ts)
  4. Token tier constants (src/lib/stripe/tiers.ts)
  5. Environment variables configured (local + Netlify)

Phase 2: Backend
  6. Create PaymentIntent route handler
  7. Stripe webhook handler (with signature verification + idempotent crediting)
  8. Stripe CLI local testing (stripe listen --forward-to)

Phase 3: Frontend
  9. Tier selector component
  10. Express Checkout component
  11. Buy page (wires tier selector + checkout together)
  12. Purchase success/processing state

Phase 4: Integration
  13. BottomNav update (add Buy link)
  14. Purchase history component + display on profile
  15. Apple Pay domain registration in Stripe Dashboard
  16. End-to-end test with real card in test mode

Phase 5: Go Live
  17. Switch to live Stripe keys
  18. Register production domain for Apple Pay
  19. Configure production webhook endpoint in Stripe Dashboard
  20. Smoke test with real $5 purchase
```

**Rationale:** Database and backend first because the frontend depends on the create-intent endpoint existing. Webhook handler before frontend because you need to verify token crediting works before building the UI that triggers it. Apple Pay domain registration is decoupled from code -- do it alongside frontend work.

---

## Testing Strategy

### Local Development

```bash
# Terminal 1: Dev server
npm run dev

# Terminal 2: Stripe CLI webhook forwarding
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
# Copy the webhook signing secret to .env.local as STRIPE_WEBHOOK_SECRET
```

### Test Cards

Stripe test mode provides test card numbers:
- `4242 4242 4242 4242` -- Visa, succeeds
- `4000 0025 0000 3155` -- Requires 3D Secure authentication
- `4000 0000 0000 9995` -- Declined (insufficient funds)

Apple Pay test: Cannot use test cards in Apple Wallet. Must use real cards with Stripe test mode keys (no actual charges).

Google Pay test: Can be tested in Chrome with saved test cards when Stripe is in test mode.

---

## Sources

- [Stripe Express Checkout Element -- Official Docs](https://docs.stripe.com/elements/express-checkout-element) -- HIGH confidence
- [Stripe Express Checkout Element Accept a Payment -- React](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?client=react) -- HIGH confidence
- [Stripe Payment Request Button (Legacy) -- Migration Guide](https://docs.stripe.com/elements/express-checkout-element/migration) -- HIGH confidence
- [Stripe Apple Pay Web Setup](https://docs.stripe.com/apple-pay?platform=web) -- HIGH confidence
- [Stripe Webhook Handling](https://docs.stripe.com/webhooks/handling-payment-events) -- HIGH confidence
- [Stripe React.js SDK Reference](https://docs.stripe.com/sdks/stripejs-react) -- HIGH confidence
- [Next.js App Router Stripe Webhook -- request.text() pattern](https://medium.com/@gragson.john/stripe-checkout-and-webhook-in-a-next-js-15-2025-925d7529855e) -- MEDIUM confidence
- [Stripe + Next.js Complete Guide](https://www.pedroalonso.net/blog/stripe-nextjs-complete-guide-2025/) -- MEDIUM confidence
- [Netlify Stripe Webhook Compatibility](https://answers.netlify.com/t/stripe-webhook-not-working-after-deploy-on-netlify/90970) -- MEDIUM confidence
- [Stripe Idempotency Best Practices](https://medium.com/@sohail_saifii/handling-payment-webhooks-reliably-idempotency-retries-validation-69b762720bf5) -- MEDIUM confidence

---

*Architecture research for: USD token purchase via Stripe + Apple Pay / Google Pay*
*Researched: 2026-02-21*
