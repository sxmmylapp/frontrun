# Roadmap: Prediction Market

## Overview

Starting from nothing, the project builds a mobile-first prediction market in five phases. Phase 1 establishes the secure identity and token foundation — the bedrock every other feature depends on. Phase 2 isolates and proves the CPMM AMM math before it touches real data. Phase 3 assembles the core prediction loop: create a market, bet tokens, watch odds move in real time. Phase 4 closes the loop with admin resolution and leaderboard, making the token economy meaningful. Phase 5 adds the engagement layer — bet history, prize system — that keeps the community coming back.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - SMS auth, free token grant, token balance display, and append-only ledger
- [x] **Phase 2: AMM Core** - CPMM math isolated, unit-tested, and precision-verified before touching the DB
- [x] **Phase 3: Core Loop** - Market creation, market feed, bet placement with live odds, bet slip preview
- [x] **Phase 4: Resolution and Leaderboard** - Admin resolves markets, winners paid out, leaderboard live
- [x] **Phase 5: Engagement Layer** - Bet history, periodic prize system, and admin prize tooling

## Phase Details

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
**Plans**: 3 plans in 2 waves

Plans:
- [ ] 01-01-PLAN.md — Project bootstrap, Supabase setup, database schema (profiles + token_ledger), client utilities (Wave 1)
- [ ] 01-02-PLAN.md — SMS OTP auth flow, middleware, login/verify UI, app shell (Wave 2)
- [ ] 01-03-PLAN.md — Token balance hook with Realtime, nav components, welcome toast (Wave 2)

### Phase 2: AMM Core
**Goal**: The CPMM AMM math is implemented as pure TypeScript, fully unit-tested, and verified to handle all edge cases before touching any live database
**Depends on**: Phase 1
**Requirements**: BET-02, TOKN-03
**Success Criteria** (what must be TRUE):
  1. `buyYesShares` and `buyNoShares` functions produce correct share counts and updated pool values for a representative set of bet sizes (verified by unit tests to 8 decimal places)
  2. `yesProbability` returns a value that always remains between 0 and 1 regardless of bet sequence
  3. A 1,000-trade simulation shows zero floating-point drift — all arithmetic uses decimal.js, not native JS numbers
  4. Edge cases (zero pool, very small bet, bet draining 90%+ of pool) are handled without throwing or returning NaN
**Plans**: TBD

Plans:
- [ ] 02-01: CPMM implementation (lib/amm/cpmm.ts) and full unit test suite

### Phase 3: Core Loop
**Goal**: Any logged-in user can create a binary market, browse open markets, place a bet on any market using tokens, see projected payout before confirming, and watch odds update in real time
**Depends on**: Phase 2
**Requirements**: MRKT-01, MRKT-02, MRKT-03, MRKT-04, MRKT-05, MRKT-06, BET-01, BET-03, BET-04
**Success Criteria** (what must be TRUE):
  1. User can create a binary (Yes/No) market by entering a question, resolution criteria, and resolution date — all three fields are required
  2. User can browse a feed of all open markets sorted by activity and see each market's current Yes/No odds and time remaining
  3. User can open a market detail page and see live Yes/No probabilities and cumulative bet volumes
  4. User can submit a bet, see a bet slip with projected payout before confirming, and have their token balance decrease atomically (no partial state if the server request fails)
  5. After any bet settles, all users viewing that market see updated odds within seconds via Supabase Realtime (no page refresh required)
**Plans**: TBD

Plans:
- [ ] 03-01: Database tables for markets and outcomes, market creation API and form
- [ ] 03-02: Market feed page and market detail page with live Realtime subscription
- [ ] 03-03: Bet API (atomic transaction: pool update + position insert + ledger debit) and bet slip UI

### Phase 4: Resolution and Leaderboard
**Goal**: Admins can resolve or void markets, winners receive tokens in a single atomic payout, and any user can see the leaderboard ranked by token balance
**Depends on**: Phase 3
**Requirements**: ADMN-01, ADMN-02, ADMN-03, TOKN-04, LEAD-01, LEAD-02
**Success Criteria** (what must be TRUE):
  1. Admin can navigate to a closed market's resolution page, see the original resolution criteria prominently displayed, select the winning outcome, and confirm — triggering token payouts to all winning bettors in one transaction
  2. After resolution, each winner's token balance increases by their proportional share of the losing pool (derivable from the ledger)
  3. Admin can void/cancel a market and all bettors receive full token refunds in a single atomic transaction
  4. Any user can view a leaderboard page showing all users ranked by current token balance, with rank, display name, and balance visible
**Plans**: TBD

Plans:
- [ ] 04-01: Admin resolution API (atomic payout transaction) and resolution UI with criteria display
- [ ] 04-02: Market void/cancel flow (full refund transaction) and market state machine (open → locked → resolved/cancelled)
- [ ] 04-03: Leaderboard page (ranked by derived token balance)

### Phase 5: Engagement Layer
**Goal**: Users can review their own betting history, and admins can snapshot leaderboard standings and record prize period winners
**Depends on**: Phase 4
**Requirements**: LEAD-03, LEAD-04, LEAD-05
**Success Criteria** (what must be TRUE):
  1. Any logged-in user can view their personal bet history showing each market bet on, the outcome they chose, and their profit or loss
  2. Admin can trigger a prize period snapshot that records the leaderboard standings at that point in time
  3. Admin can view past snapshots and mark which users won prizes for a given period
**Plans**: TBD

Plans:
- [ ] 05-01: Bet history page (per-user view of positions and profit/loss)
- [ ] 05-02: Prize period snapshot system — admin trigger, leaderboard_snapshots table, and winner recording UI

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete ✓ | 2026-02-20 |
| 2. AMM Core | 1/1 | Complete ✓ | 2026-02-20 |
| 3. Core Loop | 3/3 | Complete ✓ | 2026-02-20 |
| 4. Resolution and Leaderboard | 3/3 | Complete ✓ | 2026-02-20 |
| 5. Engagement Layer | 2/2 | Complete ✓ | 2026-02-20 |
