# Prediction Market

## What This Is

A mobile-first web app that lets people in a local community create and bet on prediction markets about anything. Users get free virtual tokens on signup and can purchase additional tokens with USD via Apple Pay / Google Pay. Odds shift dynamically based on betting volume (Polymarket-style CPMM AMM), and top performers on a periodic leaderboard win real USD prizes.

## Core Value

Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.

## Current Milestone: v2.0 USD Transactions

**Goal:** Users can purchase token packs with real USD via Apple Pay / Google Pay, powered by Stripe.

**Target features:**
- Token packs at fixed price tiers ($5, $10, $20)
- Apple Pay and Google Pay payment via Stripe
- Purchase history and receipt tracking
- Token credits applied atomically to the append-only ledger

## Requirements

### Validated

- ✓ Phone/SMS authentication for signup and login — v1.0
- ✓ Users receive free tokens (1,000) on account creation — v1.0
- ✓ Users can create binary (Yes/No) markets with a question and resolution date — v1.0
- ✓ Market odds adjust dynamically based on betting volume (CPMM AMM) — v1.0
- ✓ Users can place bets on any open market — v1.0
- ✓ Users can view a feed of active markets — v1.0
- ✓ Admin can resolve markets (declare winning outcome) — v1.0
- ✓ Tokens are distributed to winners proportionally after resolution — v1.0
- ✓ Leaderboard showing top token holders — v1.0
- ✓ Periodic prize system — top leaderboard performers win USD — v1.0
- ✓ User can view bet history with profit/loss — v1.0

### Active

- [x] Users can purchase token packs with USD via Apple Pay / Google Pay
- [x] Token purchases are processed via Stripe
- [x] Purchase history is tracked and viewable

### Out of Scope

- Cash out / withdrawal — users cannot convert tokens back to USD (keeps regulatory burden low)
- Native mobile apps — web app only (mobile-first PWA)
- Automated market resolution — admin resolves manually
- Formal withdrawal system — prizes paid out informally (Venmo/cash)
- Moderation system — small trusted group, admin can remove content directly
- Multiple-choice markets — binary covers 90% of use cases, deferred
- Subscription model — one-time pack purchases only

## Context

- Target audience is a local community (~10-20 friends initially)
- CPMM AMM for odds calculation, implemented with decimal.js for precision
- Mobile-first is critical — users will access on phones
- SMS auth via Twilio
- Supabase for PostgreSQL, Auth, Realtime
- Netlify for deployment
- Free tokens remain on signup — purchasing adds on top
- Stripe Payment Request API supports Apple Pay and Google Pay natively

## Constraints

- **Budget**: Low — this is a side project, minimize recurring costs (Stripe fees are per-transaction, no monthly cost)
- **Users**: Small scale (~10-20 initially), no need for heavy infrastructure
- **Auth**: Phone/SMS based — no email/password
- **Resolution**: Admin-only — keeps it simple and trustworthy
- **Payments**: Deposit only — no withdrawals, no money transmitter issues

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Virtual tokens (not real money) | Avoids regulatory issues, lowers barrier to entry | ✓ Good — worked well for v1 |
| AMM-based odds (CPMM) | Market-driven pricing is more engaging than fixed odds | ✓ Good |
| Admin resolution only | Small trusted group, simplicity over decentralization | ✓ Good |
| Phone/SMS auth | Frictionless for mobile users, no passwords to remember | ✓ Good |
| Periodic leaderboard prizes | Incentivizes engagement without per-market cash stakes | ✓ Good |
| Stripe for payments | Industry standard, supports Apple Pay / Google Pay via Payment Request API, no monthly fees | ✓ Phase 6 — infra in place |
| Token packs (not variable amounts) | Simpler UX, predefined tiers ($5/$10/$20), fewer edge cases | ✓ Phase 6 — tiers defined |
| Deposit only (no withdrawals) | Avoids money transmitter classification, keeps compliance minimal | — Pending |
| Server-authoritative pricing | Client sends tier key only, server looks up amount — prevents price manipulation | ✓ Phase 6 |
| Idempotent token crediting RPC | credit_token_purchase uses row lock + status check to prevent double-credit on webhook replay | ✓ Phase 6 |

---
*Last updated: 2026-02-21 after Phase 6*
