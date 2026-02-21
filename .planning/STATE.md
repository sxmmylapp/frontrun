# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Users can create a market on any topic and bet tokens on the outcome — the core prediction loop must be fast, intuitive, and fun.
**Current focus:** Phase 8 — Purchase UI

## Current Position

Phase: 8 of 9 (Purchase UI)
Plan: 0 of 1 in current phase
Status: Ready to plan
Last activity: 2026-02-21 — Phase 7 complete, transitioning to Phase 8

Progress: [███████████████░░░░░] 63% (15/24 plans across all milestones; v2.0: 2/4)

## Performance Metrics

**Velocity:**
- Total plans completed: 15 (v1.0: 12, v2.0: 3)
- Average duration: ~8 min (v2.0 only)
- Total execution time: ~23 min (v2.0)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1-5 (v1.0) | 12/12 | — | — |
| 6 (v2.0) | 1/1 | 7 min | 7 min |
| 7 (v2.0) | 1/1 | 8 min | 8 min |
| 8-9 (v2.0) | 0/2 | — | — |

**Recent Trend:**
- Last 5 plans: 7 min (06-01), 8 min (07-01)
- Trend: Steady velocity

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
- [Phase 6]: Server-authoritative pricing — client sends tier key, server looks up amount
- [Phase 6]: Idempotent credit_token_purchase RPC — row lock prevents double-credit
- [Phase 7]: PaymentIntent metadata carries user_id, tier, tokens — webhook reads from metadata, not DB
- [Phase 7]: Dedup via stripe_events insert before RPC call — primary defense against double-credit

### Pending Todos

None yet.

### Blockers/Concerns

- [v2.0 research]: Netlify 10-second serverless timeout — webhook handler must stay lean (< 5s)
- [v2.0 research]: ToS must cover token non-convertibility before accepting real payments
- [Phase 6]: Apple Pay live-mode domain registration deferred — needs Dashboard setup before go-live (Phase 9)

## Session Continuity

Last session: 2026-02-21
Stopped at: Phase 7 complete, ready to plan Phase 8
Resume file: None
