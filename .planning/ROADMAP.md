# Roadmap: Prediction Market

## Milestones

- ✅ **v1.0 MVP** - Phases 1-5 (shipped 2026-02-20)
- 🚧 **v2.0 USD Transactions** - Phases 6-9 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>v1.0 MVP (Phases 1-5) - SHIPPED 2026-02-20</summary>

- [x] **Phase 1: Foundation** - SMS auth, free token grant, token balance display, and append-only ledger
- [x] **Phase 2: AMM Core** - CPMM math isolated, unit-tested, and precision-verified before touching the DB
- [x] **Phase 3: Core Loop** - Market creation, market feed, bet placement with live odds, bet slip preview
- [x] **Phase 4: Resolution and Leaderboard** - Admin resolves markets, winners paid out, leaderboard live
- [x] **Phase 5: Engagement Layer** - Bet history, periodic prize system, and admin prize tooling

### Phase 1: Foundation
**Goal**: Users can securely sign up and log in via SMS, receive their starting tokens, and always see their current balance
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, TOKN-01, TOKN-02, TOKN-05
**Success Criteria** (what must be TRUE):
  1. User can sign up with a phone number and receive a one-time SMS code that completes registration
  2. User can log in on a subsequent visit using the same phone number and SMS OTP without creating a duplicate account
  3. User's session survives a browser refresh — they remain logged in without re-entering their phone number
  4. New user's token balance shows 1,000 tokens immediately after signup, visible persistently in the navigation
  5. Every token credit and debit is stored as an immutable row in the ledger — balance is always derivable from the ledger, never a mutable column
**Plans**: 3/3 complete

### Phase 2: AMM Core
**Goal**: The CPMM AMM math is implemented as pure TypeScript, fully unit-tested, and verified to handle all edge cases before touching any live database
**Depends on**: Phase 1
**Requirements**: BET-02, TOKN-03
**Success Criteria** (what must be TRUE):
  1. `buyYesShares` and `buyNoShares` functions produce correct share counts and updated pool values for a representative set of bet sizes
  2. `yesProbability` returns a value that always remains between 0 and 1 regardless of bet sequence
  3. A 1,000-trade simulation shows zero floating-point drift
  4. Edge cases (zero pool, very small bet, bet draining 90%+ of pool) are handled without throwing or returning NaN
**Plans**: 1/1 complete

### Phase 3: Core Loop
**Goal**: Any logged-in user can create a binary market, browse open markets, place a bet on any market using tokens, see projected payout before confirming, and watch odds update in real time
**Depends on**: Phase 2
**Requirements**: MRKT-01, MRKT-02, MRKT-03, MRKT-04, MRKT-05, MRKT-06, BET-01, BET-03, BET-04
**Success Criteria** (what must be TRUE):
  1. User can create a binary (Yes/No) market by entering a question, resolution criteria, and resolution date
  2. User can browse a feed of all open markets sorted by activity and see each market's current Yes/No odds and time remaining
  3. User can open a market detail page and see live Yes/No probabilities and cumulative bet volumes
  4. User can submit a bet, see a bet slip with projected payout before confirming, and have their token balance decrease atomically
  5. After any bet settles, all users viewing that market see updated odds within seconds via Supabase Realtime
**Plans**: 3/3 complete

### Phase 4: Resolution and Leaderboard
**Goal**: Admins can resolve or void markets, winners receive tokens in a single atomic payout, and any user can see the leaderboard ranked by token balance
**Depends on**: Phase 3
**Requirements**: ADMN-01, ADMN-02, ADMN-03, TOKN-04, LEAD-01, LEAD-02
**Success Criteria** (what must be TRUE):
  1. Admin can select the winning outcome and confirm — triggering token payouts to all winning bettors in one transaction
  2. After resolution, each winner's token balance increases by their proportional share of the losing pool
  3. Admin can void/cancel a market and all bettors receive full token refunds in a single atomic transaction
  4. Any user can view a leaderboard page showing all users ranked by current token balance
**Plans**: 3/3 complete

### Phase 5: Engagement Layer
**Goal**: Users can review their own betting history, and admins can snapshot leaderboard standings and record prize period winners
**Depends on**: Phase 4
**Requirements**: LEAD-03, LEAD-04, LEAD-05
**Success Criteria** (what must be TRUE):
  1. Any logged-in user can view their personal bet history showing each market bet on, the outcome they chose, and their profit or loss
  2. Admin can trigger a prize period snapshot that records the leaderboard standings at that point in time
  3. Admin can view past snapshots and mark which users won prizes for a given period
**Plans**: 2/2 complete

</details>

### 🚧 v2.0 USD Transactions (In Progress)

**Milestone Goal:** Users can purchase token packs with real USD via Apple Pay / Google Pay, powered by Stripe.

- [x] **Phase 6: Payment Infrastructure** - Database schema, Stripe config, Apple Pay domain, and atomic fulfillment RPC (completed 2026-02-21)
- [ ] **Phase 7: Payment Backend** - PaymentIntent creation endpoint and webhook handler with idempotent token crediting
- [ ] **Phase 8: Purchase UI** - Token pack selection, Express Checkout Element, Payment Element fallback, and purchase confirmation
- [ ] **Phase 9: Purchase Integration** - Purchase history, BetSlip buy CTA, and go-live verification

## Phase Details

### Phase 6: Payment Infrastructure
**Goal**: All database schema, Stripe configuration, and Apple Pay domain verification are in place so that backend and frontend payment code has a foundation to build on
**Depends on**: Phase 5 (v1.0 complete)
**Requirements**: PAY-03, PAY-04, PAY-05, PAY-06
**Success Criteria** (what must be TRUE):
  1. The `token_purchases` table exists with columns for Stripe PaymentIntent ID (UNIQUE), pack tier, USD amount in cents, fulfillment status, and timestamps — and a row can be inserted and queried
  2. The `stripe_events` table exists with a UNIQUE constraint on event ID — inserting a duplicate event ID is rejected by the database
  3. The `token_ledger` CHECK constraint accepts `token_purchase` as a valid reason — an INSERT with that reason succeeds
  4. The `credit_token_purchase` RPC exists and atomically credits tokens to the ledger, updates purchase status, and respects idempotency (calling it twice with the same purchase does not double-credit)
  5. Apple Pay domain verification file is accessible at `https://frontrun.bet/.well-known/apple-developer-merchantid-domain-association` and the domain is registered in Stripe Dashboard
**Plans**: 1 plan

Plans:
- [x] 06-01-PLAN.md — Database migration, Stripe packages, tier constants, SDK singletons, Apple Pay domain registration, and middleware update

### Phase 7: Payment Backend
**Goal**: Server-side payment endpoints are working and verified — a PaymentIntent can be created for any tier with server-enforced pricing, and the webhook handler idempotently credits tokens on successful payment
**Depends on**: Phase 6
**Requirements**: PAY-01, PAY-02
**Success Criteria** (what must be TRUE):
  1. Calling `POST /api/payments/create-intent` with a valid tier and authenticated session returns a Stripe `clientSecret` — the server determines the dollar amount from the tier (client never sends a price)
  2. When Stripe sends a `payment_intent.succeeded` webhook, the handler verifies the signature, credits tokens to the user's ledger via the atomic RPC, and returns 200
  3. Sending the same webhook event twice does not double-credit tokens — the second call returns 200 but skips fulfillment
  4. The full round-trip is verified with `stripe listen --forward-to` in dev: trigger a test payment, confirm tokens appear in the ledger, confirm the purchase record shows `completed` status
**Plans**: TBD

Plans:
- [ ] 07-01: Stripe server SDK, create-intent route handler, webhook route handler, and CLI verification

### Phase 8: Purchase UI
**Goal**: Users can browse token packs, pay with Apple Pay / Google Pay or a card, and see their balance update in real time after purchase
**Depends on**: Phase 7
**Requirements**: PURC-01, PURC-02, PURC-03, PURC-04
**Success Criteria** (what must be TRUE):
  1. User sees three token pack cards on the `/buy` page with prices ($5, $10, $20), token amounts (500, 1,100, 2,400), and bonus callouts on the higher tiers
  2. On iOS Safari, the Apple Pay button renders via Express Checkout Element — tapping it opens the Apple Pay sheet and completes payment without leaving the app
  3. When no wallet is available (desktop browser, unsupported device), a card entry form (Payment Element) renders as fallback and accepts a test card successfully
  4. After successful payment, the user sees a confirmation state and their token balance in the nav animates up within seconds (driven by existing Realtime subscription, not polling)
**Plans**: TBD

Plans:
- [ ] 08-01: Stripe client setup, /buy page, tier selector, Express Checkout Element, Payment Element fallback, and purchase confirmation flow

### Phase 9: Purchase Integration
**Goal**: Token purchasing is woven into the app experience with contextual entry points and purchase history, and the system is verified working with real payments on production
**Depends on**: Phase 8
**Requirements**: PURC-05, PURC-06
**Success Criteria** (what must be TRUE):
  1. User can view their purchase history on the profile page showing date, USD amount, and tokens received for each completed purchase
  2. When a user tries to place a bet but has insufficient tokens, the BetSlip shows a "Buy more tokens" CTA that links to the `/buy` page
  3. A real $5 purchase on `frontrun.bet` with a live Stripe key completes end-to-end: payment succeeds, tokens are credited to the ledger, purchase appears in history, and the Stripe Dashboard shows successful delivery
**Plans**: TBD

Plans:
- [ ] 09-01: Purchase history component, BetSlip insufficient-balance CTA, and go-live verification

## Progress

**Execution Order:**
Phases execute in numeric order: 6 → 7 → 8 → 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-02-20 |
| 2. AMM Core | v1.0 | 1/1 | Complete | 2026-02-20 |
| 3. Core Loop | v1.0 | 3/3 | Complete | 2026-02-20 |
| 4. Resolution and Leaderboard | v1.0 | 3/3 | Complete | 2026-02-20 |
| 5. Engagement Layer | v1.0 | 2/2 | Complete | 2026-02-20 |
| 6. Payment Infrastructure | v2.0 | 1/1 | Complete | 2026-02-21 |
| 7. Payment Backend | v2.0 | 0/1 | Not started | - |
| 8. Purchase UI | v2.0 | 0/1 | Not started | - |
| 9. Purchase Integration | v2.0 | 0/1 | Not started | - |
