---
phase: 06-payment-infrastructure
plan: 01
subsystem: payments
tags: [stripe, apple-pay, supabase, rpc, migration]

# Dependency graph
requires:
  - phase: 05-engagement-layer
    provides: "Complete v1.0 with token ledger, profiles, and RLS patterns"
provides:
  - "token_purchases table with UNIQUE stripe PI constraint and RLS"
  - "stripe_events idempotency table with UNIQUE event_id"
  - "token_ledger CHECK constraint accepting token_purchase reason"
  - "credit_token_purchase atomic RPC (idempotent)"
  - "Stripe server/client SDK singletons"
  - "Server-authoritative tier constants ($5/500, $10/1100, $20/2400)"
  - "Apple Pay domain registration (frontrun.bet, www.frontrun.bet)"
  - "Middleware: /buy auth-protected, .well-known excluded"
  - "Stripe env vars on Netlify production"
affects: [07-payment-backend, 08-purchase-ui, 09-purchase-integration]

# Tech tracking
tech-stack:
  added: [stripe@20.3.1, "@stripe/stripe-js@8.8.0", "@stripe/react-stripe-js@5.6.0"]
  patterns: [server-authoritative-pricing, idempotent-rpc, stripe-singleton]

key-files:
  created:
    - supabase/migrations/00006_token_purchases.sql
    - src/lib/stripe/tiers.ts
    - src/lib/stripe/server.ts
    - src/lib/stripe/client.ts
  modified:
    - src/middleware.ts
    - package.json
    - CLAUDE.md
    - .env.local

key-decisions:
  - "Stripe test-mode keys for development; live-mode switch deferred to Phase 9"
  - "Webhook secret placeholder set — actual secret configured when stripe listen runs in Phase 7"
  - "Apple Pay live-mode domain registration deferred (restricted API key permissions)"

patterns-established:
  - "Server-authoritative pricing: client sends tier key, server looks up amount from TIERS constant"
  - "Idempotent RPC: credit_token_purchase uses row lock + status check to prevent double-credit"
  - "Stripe singleton: server.ts for server SDK, client.ts with 'use client' for loadStripe"

requirements-completed: [PAY-03, PAY-04, PAY-05, PAY-06]

# Metrics
duration: 7min
completed: 2026-02-21
---

# Phase 6 Plan 01: Payment Infrastructure Summary

**Supabase migration with token_purchases + stripe_events tables, idempotent credit_token_purchase RPC, Stripe SDK packages, tier constants, Apple Pay domain registration, and middleware auth/well-known updates**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-21T16:18:15Z
- **Completed:** 2026-02-21T16:25:28Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Database migration applied: token_purchases table, stripe_events table, token_ledger CHECK constraint migration, credit_token_purchase idempotent RPC
- Stripe packages installed (stripe, @stripe/stripe-js, @stripe/react-stripe-js) with server/client singletons
- Server-authoritative tier pricing constants defined ($5/500, $10/1100 +10% bonus, $20/2400 +20% bonus)
- Apple Pay domains registered in Stripe (test mode) for frontrun.bet and www.frontrun.bet
- Middleware updated: /buy protected, .well-known excluded from matching
- Stripe env vars configured on Netlify production

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration, Stripe packages, tier constants, and SDK singletons** - `2994bfe` (feat)
2. **Task 2: Apple Pay domain registration, middleware update, and Netlify env vars** - `dff337b` (feat)

## Files Created/Modified
- `supabase/migrations/00006_token_purchases.sql` - token_purchases, stripe_events, CHECK constraint, credit_token_purchase RPC
- `src/lib/stripe/tiers.ts` - Server-authoritative tier constants with Zod validation
- `src/lib/stripe/server.ts` - Stripe server SDK singleton
- `src/lib/stripe/client.ts` - Stripe client loadStripe singleton
- `src/middleware.ts` - Added /buy to protected routes, excluded .well-known from matcher
- `package.json` - Added stripe, @stripe/stripe-js, @stripe/react-stripe-js
- `CLAUDE.md` - Updated with new tables, env vars, token_purchase reason, RPC
- `.env.local` - Added Stripe test-mode keys

## Decisions Made
- Used test-mode Stripe keys for development; live-mode switch planned for Phase 9 go-live
- Set webhook secret as placeholder — will be configured with actual secret when `stripe listen` runs in Phase 7
- Apple Pay live-mode domain registration deferred due to restricted API key permissions (will register via Dashboard before go-live)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stripe CLI command syntax**
- **Found during:** Task 2 (Apple Pay domain registration)
- **Issue:** Plan specified `stripe apple_pay domains create` but CLI expects `stripe apple_pay_domains create`
- **Fix:** Used correct CLI command with underscores
- **Verification:** Both domains listed in `stripe apple_pay_domains list`
- **Committed in:** dff337b (Task 2 commit)

**2. [Rule 3 - Blocking] Live-mode domain registration permissions**
- **Found during:** Task 2 (Apple Pay domain registration)
- **Issue:** Live-mode restricted API key lacks permissions for apple_pay_domains endpoint
- **Fix:** Registered in test mode only; live-mode registration deferred to pre-go-live (Phase 9) via Dashboard
- **Verification:** Test-mode domains confirmed registered
- **Committed in:** dff337b (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Minor — test-mode registration is sufficient for development. Live-mode will be handled via Dashboard before go-live.

## Issues Encountered
None — migration applied cleanly, all verifications passed.

## User Setup Required
None - no external service configuration required. Stripe keys obtained from CLI, env vars set automatically.

## Next Phase Readiness
- All database schema ready for Phase 7 webhook handler and create-intent endpoint
- Stripe SDK singletons importable from `src/lib/stripe/server.ts` and `src/lib/stripe/client.ts`
- Tier constants available at `src/lib/stripe/tiers.ts` for server-authoritative pricing
- Middleware ready: /buy route protected, .well-known paths accessible for Apple Pay verification
- Netlify has Stripe env vars for production deploys

---
*Phase: 06-payment-infrastructure*
*Completed: 2026-02-21*
