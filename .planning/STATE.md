# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-19)

**Core value:** Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.
**Current focus:** Phase 2 — AMM Core

## Current Position

Phase: 2 of 5 (AMM Core)
Plan: 0 of 1 in current phase
Status: Ready to plan
Last activity: 2026-02-20 — Phase 1 executed (3/3 plans complete)

Progress: [██░░░░░░░░] 20%

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

- [Roadmap]: CPMM AMM chosen over LMSR — no tunable `b` parameter, ~50 lines of TypeScript, used by Manifold and Polymarket
- [Roadmap]: Token ledger is append-only from day one — balance derived from SUM, never a mutable column (prevents race condition retrofit)
- [Roadmap]: Phase 2 isolates AMM math before DB wiring — precision bugs caught in tests, not in production with real balances
- [Roadmap]: Phone uniqueness enforced at DB constraint level (not app layer) to prevent multi-account leaderboard gaming

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1 pre-work]: Verify Twilio Lookup VoIP blocking config (`line_type_intelligence` add-on) before Phase 1 goes to production
- [Phase 3 pre-planning]: Supabase JS client does not expose raw BEGIN...COMMIT — confirm atomic transaction pattern (RPC/stored procedure vs pg client) before Phase 3 planning
- [Phase 5 pre-planning]: Multiple-choice AMM normalization (probabilities summing to 1.0 across N pools) is unresolved — design spike needed (this is v2 per REQUIREMENTS.md, tracked for awareness only)

## Session Continuity

Last session: 2026-02-20
Stopped at: Phase 1 complete — advancing to Phase 2
Resume file: None
