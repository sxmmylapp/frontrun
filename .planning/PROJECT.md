# Prediction Market

## What This Is

A mobile-first web app that lets people in a local community create and bet on prediction markets about anything. Users get free virtual tokens on signup, odds shift dynamically based on betting volume (Polymarket-style AMM), and top performers on a periodic leaderboard win real USD prizes.

## Core Value

Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Phone/SMS authentication for signup and login
- [ ] Users receive free tokens on account creation
- [ ] Users can create binary (Yes/No) markets with a question and resolution date
- [ ] Users can create multiple-choice markets
- [ ] Market odds adjust dynamically based on betting volume (AMM)
- [ ] Users can place bets on any open market
- [ ] Users can view a feed of active markets
- [ ] Admin can resolve markets (declare winning outcome)
- [ ] Tokens are distributed to winners proportionally after resolution
- [ ] Leaderboard showing top token holders
- [ ] Periodic prize system — top leaderboard performers win USD

### Out of Scope

- Real money deposits — tokens are free, no payment processing for buying tokens
- Native mobile apps — web app only (mobile-first PWA)
- Automated market resolution — admin resolves manually for v1
- Formal withdrawal system — prizes paid out informally (Venmo/cash)
- Moderation system — small trusted group for v1, admin can remove content directly

## Context

- Target audience is a local community (~10-20 friends initially)
- Polymarket-style AMM for odds calculation (likely LMSR or CPMM)
- No regulatory compliance needed — virtual tokens with informal prizes
- Mobile-first is critical — users will access on phones
- SMS auth via a service like Twilio or similar

## Constraints

- **Budget**: Low — this is a side project, minimize recurring costs
- **Users**: Small scale (~10-20 initially), no need for heavy infrastructure
- **Auth**: Phone/SMS based — no email/password
- **Resolution**: Admin-only for v1 — keeps it simple and trustworthy

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Virtual tokens (not real money) | Avoids regulatory issues, lowers barrier to entry | — Pending |
| AMM-based odds | Market-driven pricing is more engaging than fixed odds | — Pending |
| Admin resolution only | Small trusted group, simplicity over decentralization | — Pending |
| Phone/SMS auth | Frictionless for mobile users, no passwords to remember | — Pending |
| Periodic leaderboard prizes | Incentivizes engagement without per-market cash stakes | — Pending |

---
*Last updated: 2026-02-19 after initialization*
