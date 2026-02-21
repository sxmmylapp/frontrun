# Requirements: Prediction Market

**Defined:** 2026-02-21
**Core Value:** Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.

## v1.0 Requirements (Validated)

All v1.0 requirements shipped and validated on 2026-02-20.

### Authentication

- [x] **AUTH-01**: User can sign up with phone number via SMS OTP
- [x] **AUTH-02**: User can log in with phone number via SMS OTP
- [x] **AUTH-03**: User session persists across browser refresh
- [x] **AUTH-04**: Phone number is unique per account (prevents multi-accounting)

### Token Economy

- [x] **TOKN-01**: User receives free tokens (1,000) on account creation
- [x] **TOKN-02**: User can see their current token balance persistently in the UI
- [x] **TOKN-03**: Token balance updates in real-time after placing a bet
- [x] **TOKN-04**: Winning bettors receive tokens proportionally after market resolution
- [x] **TOKN-05**: Token transactions are recorded in an append-only ledger for auditability

### Markets

- [x] **MRKT-01**: User can create a binary (Yes/No) market with a question and resolution date
- [x] **MRKT-02**: Market creation requires clear resolution criteria
- [x] **MRKT-03**: User can browse a feed of all open markets
- [x] **MRKT-04**: User can view a market detail page with current Yes/No odds and bet volumes
- [x] **MRKT-05**: Market detail page shows expiry countdown ("closes in X days")
- [x] **MRKT-06**: Markets transition through states: open → closed → resolved

### Betting

- [x] **BET-01**: User can place a bet (Yes or No) on any open market using tokens
- [x] **BET-02**: Odds adjust dynamically via CPMM AMM after each bet
- [x] **BET-03**: User sees a bet slip with projected payout before confirming
- [x] **BET-04**: Bet placement is atomic (server-side, transactional, no partial state)

### Administration

- [x] **ADMN-01**: Admin can resolve a market by selecting the winning outcome
- [x] **ADMN-02**: Market resolution triggers automatic payout to all winning bettors in a single atomic transaction
- [x] **ADMN-03**: Admin can void/cancel a market (refund all bettors)

### Leaderboard & Prizes

- [x] **LEAD-01**: User can view a leaderboard ranked by current token balance
- [x] **LEAD-02**: Leaderboard shows rank, display name, and token balance
- [x] **LEAD-03**: User can view their bet history (markets bet on, outcome, profit/loss)
- [x] **LEAD-04**: Periodic prize system tracks leaderboard snapshots per period
- [x] **LEAD-05**: Admin can trigger a prize period snapshot and record winners

## v2.0 Requirements

Requirements for milestone v2.0: USD Transactions. Each maps to roadmap phases.

### Payment Processing

- [x] **PAY-01**: Stripe processes token pack payments via PaymentIntents API with server-side price enforcement (client never sends dollar amounts)
- [x] **PAY-02**: Webhook handler idempotently credits tokens on `payment_intent.succeeded` — tokens are never credited from client-side callbacks
- [x] **PAY-03**: Apple Pay domain is verified for `frontrun.bet` and Express Checkout Element renders Apple Pay on iOS Safari
- [x] **PAY-04**: Duplicate webhook events do not double-credit tokens (`stripe_events` table with UNIQUE constraint on event ID)
- [x] **PAY-05**: Token purchase credits are recorded in the append-only ledger with reason `token_purchase`
- [x] **PAY-06**: Purchase records are stored with Stripe PaymentIntent ID, pack tier, USD amount in cents, and fulfillment status

### Token Purchase UX

- [ ] **PURC-01**: User can select from 3 token packs: $5/500 tokens, $10/1,100 tokens (+10% bonus), $20/2,400 tokens (+20% bonus)
- [ ] **PURC-02**: User can pay via Apple Pay or Google Pay through the Express Checkout Element
- [ ] **PURC-03**: User can pay via card entry through the Payment Element fallback when no wallet is available
- [ ] **PURC-04**: User sees a success confirmation and their token balance animates up in real-time after purchase
- [ ] **PURC-05**: User can view their purchase history on the profile page showing date, USD amount, and tokens received
- [ ] **PURC-06**: User sees a "Buy more tokens" CTA in the BetSlip when they have insufficient balance to place a bet

## Future Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Markets

- **MRKT-07**: User can create multiple-choice markets (3-6 outcomes)
- **MRKT-08**: Market detail page supports comments/discussion thread

### Social

- **SOCL-01**: User can share a market via URL with OG meta tag previews
- **SOCL-02**: User profile shows performance stats and calibration score
- **SOCL-03**: Push notifications for market close and resolution events

### Purchase Enhancements

- **PURC-07**: Email receipts sent after purchase (requires email collection)
- **PURC-08**: Low-balance nudge banner when tokens drop below threshold
- **PURC-09**: BottomNav "Buy" link for persistent purchase access

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Token withdrawal / cash-out | Triggers money transmitter classification under FinCEN |
| Variable purchase amounts | Edge cases with no benefit at fixed-pack scale |
| Subscription / auto-refill | Overkill for 10-20 users; recurring billing complexity unjustified |
| Custom card number input | Increases PCI scope; Stripe Elements handle PCI |
| Stripe Checkout hosted page | Redirects user away from app; breaks mobile-first context |
| Referral bonuses on purchase | Abuse vectors outweigh benefit at 10-20 user scale |
| Refund self-service | Opens abuse (buy, bet, lose, refund); admin handles manually via Stripe Dashboard |
| Native iOS/Android apps | PWA sufficient for current scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PAY-01 | Phase 7 | Complete |
| PAY-02 | Phase 7 | Complete |
| PAY-03 | Phase 6 | Complete |
| PAY-04 | Phase 6 | Complete |
| PAY-05 | Phase 6 | Complete |
| PAY-06 | Phase 6 | Complete |
| PURC-01 | Phase 8 | Pending |
| PURC-02 | Phase 8 | Pending |
| PURC-03 | Phase 8 | Pending |
| PURC-04 | Phase 8 | Pending |
| PURC-05 | Phase 9 | Pending |
| PURC-06 | Phase 9 | Pending |

**Coverage:**
- v2.0 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-02-21 after v2.0 roadmap creation*
