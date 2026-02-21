# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.
**Current focus:** Phase 6 — Payment Infrastructure

## Current Position

Phase: 6 of 9 (Payment Infrastructure)
Plan: 0 of 1 in current phase
Status: Ready to plan
Last activity: 2026-02-21 — Roadmap created for v2.0 USD Transactions

Progress: [██████████░░░░░░░░░░] 50% (12/24 plans across all milestones; v2.0: 0/4)

## Performance Metrics

**Velocity:**
- Total plans completed: 12 (v1.0)
- Average duration: —
- Total execution time: — hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1-5 (v1.0) | 12/12 | — | — |
| 6-9 (v2.0) | 0/4 | — | — |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.0]: Token ledger is append-only — balance derived from SUM, never a mutable column
- [v2.0]: Stripe for payments — supports Apple Pay / Google Pay via Express Checkout Element
- [v2.0]: Token packs at fixed tiers ($5/$10/$20) — simpler than variable amounts
- [v2.0]: Deposit only, no withdrawals — avoids money transmitter classification
- [v2.0]: Webhook-only fulfillment — tokens credited exclusively via webhook, never client-side

### Pending Todos

None yet.

### Blockers/Concerns

- [v2.0 research]: Apple Pay domain verification can take 24h — register early in Phase 6
- [v2.0 research]: Netlify 10-second serverless timeout — webhook handler must stay lean (< 5s)
- [v2.0 research]: `token_ledger` CHECK constraint must be migrated BEFORE any payment code deploys
- [v2.0 research]: ToS must cover token non-convertibility before accepting real payments

## Session Continuity

Last session: 2026-02-21
Stopped at: Roadmap created for v2.0 milestone
Resume file: None
