# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.
**Current focus:** v2.0 USD Transactions — defining requirements

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements for v2.0
Last activity: 2026-02-21 — Milestone v2.0 started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.0]: CPMM AMM chosen over LMSR — no tunable `b` parameter, ~50 lines of TypeScript
- [v1.0]: Token ledger is append-only — balance derived from SUM, never a mutable column
- [v1.0]: Phone uniqueness enforced at DB constraint level
- [v2.0]: Stripe for payments — supports Apple Pay / Google Pay via Payment Request API
- [v2.0]: Token packs at fixed tiers ($5/$10/$20) — simpler than variable amounts
- [v2.0]: Deposit only, no withdrawals — avoids money transmitter classification

### Pending Todos

None yet.

### Blockers/Concerns

- [v2.0 pre-planning]: Verify Stripe Payment Request API support for Apple Pay / Google Pay in Supabase + Next.js context
- [v2.0 pre-planning]: Determine token-to-USD conversion rate for each pack tier

## Session Continuity

Last session: 2026-02-21
Stopped at: Defining v2.0 milestone requirements
Resume file: None
