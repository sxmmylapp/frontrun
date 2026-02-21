# Requirements: Prediction Market

**Defined:** 2026-02-19
**Core Value:** Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [ ] **AUTH-01**: User can sign up with phone number via SMS OTP
- [ ] **AUTH-02**: User can log in with phone number via SMS OTP
- [ ] **AUTH-03**: User session persists across browser refresh
- [ ] **AUTH-04**: Phone number is unique per account (prevents multi-accounting)

### Token Economy

- [ ] **TOKN-01**: User receives free tokens (1,000) on account creation
- [ ] **TOKN-02**: User can see their current token balance persistently in the UI
- [ ] **TOKN-03**: Token balance updates in real-time after placing a bet
- [ ] **TOKN-04**: Winning bettors receive tokens proportionally after market resolution
- [ ] **TOKN-05**: Token transactions are recorded in an append-only ledger for auditability

### Markets

- [ ] **MRKT-01**: User can create a binary (Yes/No) market with a question and resolution date
- [ ] **MRKT-02**: Market creation requires clear resolution criteria
- [ ] **MRKT-03**: User can browse a feed of all open markets
- [ ] **MRKT-04**: User can view a market detail page with current Yes/No odds and bet volumes
- [ ] **MRKT-05**: Market detail page shows expiry countdown ("closes in X days")
- [ ] **MRKT-06**: Markets transition through states: open → closed → resolved

### Betting

- [ ] **BET-01**: User can place a bet (Yes or No) on any open market using tokens
- [ ] **BET-02**: Odds adjust dynamically via CPMM AMM after each bet
- [ ] **BET-03**: User sees a bet slip with projected payout before confirming
- [ ] **BET-04**: Bet placement is atomic (server-side, transactional, no partial state)

### Administration

- [ ] **ADMN-01**: Admin can resolve a market by selecting the winning outcome
- [ ] **ADMN-02**: Market resolution triggers automatic payout to all winning bettors in a single atomic transaction
- [ ] **ADMN-03**: Admin can void/cancel a market (refund all bettors)

### Leaderboard & Prizes

- [ ] **LEAD-01**: User can view a leaderboard ranked by current token balance
- [ ] **LEAD-02**: Leaderboard shows rank, display name, and token balance
- [ ] **LEAD-03**: User can view their bet history (markets bet on, outcome, profit/loss)
- [ ] **LEAD-04**: Periodic prize system tracks leaderboard snapshots per period
- [ ] **LEAD-05**: Admin can trigger a prize period snapshot and record winners

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Markets

- **MRKT-07**: User can create multiple-choice markets (3-6 outcomes)
- **MRKT-08**: Market detail page supports comments/discussion thread

### Social

- **SOCL-01**: User can share a market via URL with OG meta tag previews
- **SOCL-02**: User profile shows performance stats and calibration score
- **SOCL-03**: Push notifications for market close and resolution events

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real money deposits/withdrawals | Triggers gambling regulation; virtual tokens keep it casual and legal |
| Native iOS/Android apps | PWA sufficient for 10-20 users; revisit at 500+ |
| Automated market resolution | Ambiguous questions can't be auto-resolved; admin resolution takes seconds at this scale |
| User-to-user token transfers | Enables gaming/manipulation; undermines leaderboard integrity |
| Order book / limit orders | Requires order matching engine; AMM handles all trades instantly |
| Full moderation system | Admin can delete content directly at this scale; no formal queue needed |
| Complex market types (numeric range, weighted) | Binary covers 90% of community use cases |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| TOKN-01 | Phase 1 | Pending |
| TOKN-02 | Phase 1 | Pending |
| TOKN-05 | Phase 1 | Pending |
| BET-02 | Phase 2 | Pending |
| TOKN-03 | Phase 2 | Pending |
| MRKT-01 | Phase 3 | Pending |
| MRKT-02 | Phase 3 | Pending |
| MRKT-03 | Phase 3 | Pending |
| MRKT-04 | Phase 3 | Pending |
| MRKT-05 | Phase 3 | Pending |
| MRKT-06 | Phase 3 | Pending |
| BET-01 | Phase 3 | Pending |
| BET-03 | Phase 3 | Pending |
| BET-04 | Phase 3 | Pending |
| ADMN-01 | Phase 4 | Pending |
| ADMN-02 | Phase 4 | Pending |
| ADMN-03 | Phase 4 | Pending |
| TOKN-04 | Phase 4 | Pending |
| LEAD-01 | Phase 4 | Pending |
| LEAD-02 | Phase 4 | Pending |
| LEAD-03 | Phase 5 | Pending |
| LEAD-04 | Phase 5 | Pending |
| LEAD-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-02-19*
*Last updated: 2026-02-19 — traceability populated after roadmap creation*
