---
phase: 07-payment-backend
plan: 01
status: complete
started: 2026-02-21
completed: 2026-02-21
duration: ~8 min
commits:
  - hash: 0efb4fb
    message: "feat(07-01): PaymentIntent endpoint, webhook handler, and regenerated types"
---

# 07-01 Summary: Payment Backend

## What Was Built

### Task 1: Supabase Types + PaymentIntent Endpoint
- Regenerated `src/types/db.ts` via `supabase gen types` to include `token_purchases`, `stripe_events`, and `credit_token_purchase` RPC
- Created `POST /api/payments/create-intent` route handler:
  - Cookie-based authentication via `createClient()` from `@/lib/supabase/server`
  - Zod tier validation via `tierSchema` from `@/lib/stripe/tiers`
  - Server-determined pricing from `TIERS` constant (client never sends dollar amount)
  - Creates Stripe PaymentIntent with `user_id`, `tier`, `tokens` in metadata
  - Inserts pending purchase record into `token_purchases` via admin client
  - Returns `{ clientSecret }` for Stripe Elements on client
  - Structured error handling and logging

### Task 2: Stripe Webhook Handler
- Created `POST /api/webhooks/stripe` route handler:
  - Uses `request.text()` (NOT `request.json()`) for raw body — critical for signature verification
  - Stripe webhook signature verification via `stripe.webhooks.constructEvent()`
  - Deduplication via `stripe_events` table insert (UNIQUE constraint on `event_id`, code `23505` check)
  - Token crediting via `credit_token_purchase` atomic RPC
  - Handles `payment_intent.succeeded` (credit tokens) and `payment_intent.payment_failed` (mark failed)
  - Returns 200 for all unhandled event types
  - No auth middleware — Stripe signature is the authentication mechanism
  - Validates metadata before crediting (user_id, tokens must be present and valid)

### Task 3: Verification
- `npm run build` passes with no errors
- Both routes appear as dynamic routes in build output
- Unauthenticated `POST /api/payments/create-intent` returns 401
- Invalid/missing `stripe-signature` on webhook returns 400
- Fixed pre-existing `is_winner: boolean | null` type mismatch in prizes page exposed by type regeneration

## Deviations

- **Type fix in prizes page**: Regenerating `db.ts` exposed a latent type mismatch where `is_winner` was `boolean | null` in the DB but typed as `boolean` in the component. Fixed with `?? false` coercion. This is a minor collateral fix, not a plan deviation.

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src/types/db.ts` | Regenerated | Include token_purchases, stripe_events, credit_token_purchase |
| `src/app/api/payments/create-intent/route.ts` | Created | PaymentIntent creation with server-enforced pricing |
| `src/app/api/webhooks/stripe/route.ts` | Created | Webhook handler with dedup and atomic token crediting |
| `src/app/(app)/admin/prizes/page.tsx` | Fixed | is_winner nullability coercion |

## Requirements Addressed

- **PAY-01**: Stripe processes token pack payments via PaymentIntents API with server-side price enforcement
- **PAY-02**: Webhook handler idempotently credits tokens on `payment_intent.succeeded`
