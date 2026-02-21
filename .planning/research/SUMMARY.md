# Project Research Summary

**Project:** Prediction Market
**Domain:** Mobile-first community prediction market — virtual tokens, AMM odds, leaderboard prizes
**Researched:** 2026-02-19
**Confidence:** HIGH (stack, architecture, pitfalls) / MEDIUM (features — small-community niche underrepresented in literature)

## Executive Summary

This is a mobile-first social prediction market for a small trusted community (~10-20 people). The app lets users create binary and multiple-choice markets on any topic, bet free virtual tokens on outcomes, watch odds shift dynamically via an AMM, and compete on a leaderboard for periodic USD prizes. Research confirms this exact niche has one close analog — Manifold Markets — and its architecture is well-documented, open source, and directly applicable. The recommended stack is Next.js 16 + Supabase + CPMM AMM, deployable at $0/month on Vercel Hobby and Supabase Free tiers, with Twilio Verify for SMS auth at roughly $1.20 total signup cost for 20 users.

The single most important technical decision is the AMM mechanism. Research conclusively recommends CPMM (Constant Product Market Maker, x*y=k) over LMSR. CPMM is simpler to implement correctly, requires no tunable liquidity parameter, is used by both Manifold Markets and Polymarket, and has no floating-point precision risks when implemented with decimal.js. LMSR's `b` parameter is a documented "black art" that consistently causes either unresponsive odds or wild price swings in small-liquidity communities — exactly this use case. The CPMM core is ~50 lines of TypeScript.

The top risks are not technical complexity — they are financial integrity and social trust. Three pitfalls can destroy the product before it gains traction: race conditions on concurrent bets (corrupts token balances), ambiguous market resolution criteria (destroys community trust), and multi-account gaming tied to the prize system (undermines leaderboard integrity). All three are preventable with known patterns: atomic database transactions for bet placement, a required resolution criteria field at market creation, and phone-number uniqueness enforced at the database level. These must be correct from day one — they are not features that can be retrofitted.

## Key Findings

### Recommended Stack

The recommended stack is Next.js 16 (App Router, Turbopack) with TypeScript and Tailwind CSS v4 + shadcn/ui for the frontend, Supabase as the all-in-one backend (PostgreSQL, Auth, Realtime), and Twilio Verify via Supabase for SMS OTP. All at $0/month for the initial 10-20 user scale. The stack was selected because Supabase natively provides phone/SMS OTP auth, Realtime subscriptions for live odds updates, and Row Level Security for token isolation — features that would each require a separate service if using a different backend.

**Core technologies:**
- **Next.js 16 (App Router):** Full-stack framework — Server Components reduce mobile bundle size, API routes handle server-side AMM logic, built-in PWA manifest support
- **TypeScript 5.x:** AMM math and token accounting have financial correctness requirements — type safety is not optional
- **Tailwind CSS v4 + shadcn/ui:** Mobile-first utility CSS with accessible component primitives; shadcn requires Tailwind v4 now
- **Supabase:** PostgreSQL database + phone/SMS OTP auth + Realtime subscriptions — three requirements in one service
- **decimal.js 10.x:** All CPMM math must use arbitrary-precision arithmetic; native JS floats produce wrong answers in share calculations
- **Zustand 5.x:** Lightweight client state for UI (active market, modal state, optimistic bet preview)
- **Zod 3.x + React Hook Form 7.x:** Input validation on all API routes (bet amounts, market fields, admin resolution)
- **Vercel Hobby:** Zero-config Next.js deployment, free tier handles 20 users indefinitely

**Version-critical notes:**
- Use `@supabase/ssr` (not the deprecated `@supabase/auth-helpers-nextjs`) for Next.js App Router
- Do not use `next-pwa` (unmaintained) — Next.js 16 has built-in PWA manifest support
- Do not use native JS `number` for any AMM arithmetic — use `decimal.js` for all share calculations

### Expected Features

**Must have (table stakes) — v1 launch:**
- Phone/SMS auth with free token grant on signup (1,000 tokens per verified phone)
- Binary (Yes/No) market creation with question + resolution criteria + resolution date
- Market feed showing open markets, sorted by activity/close date
- Market detail page with live YES/NO probability display and volume
- Bet placement with CPMM AMM (dynamic odds update on every bet)
- Bet slip confirmation with projected payout preview before confirming
- Token balance display persistent in navigation
- Admin resolution UI: select outcome, trigger proportional payout to winners
- Leaderboard by current token balance

**Should have (engagement drivers) — v1.x after validation:**
- Multiple-choice markets (per-option AMM pools; adds meaningful complexity — defer until binary is proven)
- Market comments/discussion thread
- User profile with bet history and win/loss record
- Periodic prize system UI (admin manually handles first prize without formal UI)
- Share market link with OG meta tags for viral growth

**Defer to v2+:**
- Push notifications / SMS reminders (community uses group chat for v1)
- Performance stats and calibration scores (requires multiple resolved markets to be meaningful)
- Market search and filtering (defer until >50 markets exist)
- PWA installability optimization (revisit at 500+ active users)

**Anti-features (never build for v1):**
- Automated market resolution — ambiguous community questions cannot be auto-resolved
- Real money deposits — triggers gambling regulation immediately
- User-to-user token transfers — creates farming/manipulation incentives
- Order book / limit orders — requires matching engine, overkill for AMM with low liquidity

### Architecture Approach

The architecture is a standard Next.js monolith with Supabase as the data and realtime layer. All AMM logic runs server-side only — the client sends a bet intent and receives back the result, never computing or reporting its own share count. The token ledger is append-only (every credit and debit is a ledger row; balance is derived from SUM) which eliminates race condition risks from mutable balance columns and provides a full audit trail essential for the prize system. Supabase Realtime pushes pool state changes to all connected clients after each bet settles, eliminating polling entirely.

**Major components:**
1. **CPMM AMM Service** (`lib/amm/cpmm.ts`) — pure TypeScript functions, no DB dependencies, independently testable; must be unit-tested before wiring to any API route
2. **Bet API** (`app/api/bets/`) — server-side only; validates session, runs CPMM math, executes atomic DB transaction (pool update + position insert + ledger debit) in a single `BEGIN...COMMIT`
3. **Token Ledger** (`token_ledger` table) — append-only, source of truth for all balances; balance queries are `SELECT SUM(amount) WHERE user_id = $1`
4. **Resolution Service** — admin API that fetches all winning positions, calculates proportional payouts, and writes all ledger credits in a single transaction; partial resolution is not allowed
5. **Supabase Realtime** — subscribes to `outcomes` table changes; pushes updated pool state to all clients viewing a market after each bet
6. **Market State Machine** — markets transition `open → locked → resolved` (or `cancelled`); illegal transitions rejected at API layer; locked markets accept no new bets

**Database schema (key tables):** `profiles`, `markets`, `outcomes` (yes_pool/no_pool columns), `positions`, `token_ledger` (append-only), `leaderboard_snapshots`

**Build order the architecture mandates:**
DB schema → Auth → Token ledger → Market CRUD → AMM service (unit tested) → Bet API → Realtime → Admin resolution → Leaderboard → Prize system

### Critical Pitfalls

1. **Race conditions on concurrent bets** — Multiple simultaneous bets on the same market corrupt pool state and can produce negative balances. Prevention: every bet is a single `BEGIN...COMMIT` transaction with `SELECT FOR UPDATE` on the market row. This must be correct from day one; retrofitting is painful.

2. **Ambiguous market resolution criteria** — Vague questions ("will it go well?") cause trust-destroying disputes in a 20-person community where everyone knows each other. Prevention: market creation form requires a separate mandatory "Resolution criteria" field; admin resolution UI prominently displays the original criteria before confirming.

3. **Multi-account leaderboard gaming** — When real USD prizes are attached to the leaderboard, even friends will create secondary accounts and bet against themselves to farm tokens. Prevention: unique database constraint on phone number (not just application-level), VoIP number blocking via Twilio Lookup, and account age/activity minimums for prize eligibility.

4. **LMSR b parameter trap** — LMSR's liquidity parameter is nearly impossible to tune correctly for a small community token supply. With 20 users × 1,000 tokens each, default `b` values from examples produce odds that never move. Prevention: use CPMM instead — no parameter to tune, correct behavior emerges naturally from bet volume.

5. **Token inflation / rich-get-richer** — Early users who get lucky in early markets accumulate tokens; leaderboard becomes fixed within a week; new users churn. Prevention: design periodic leaderboard resets (e.g., monthly competitions with fresh starting balances) from the start — this is a structural decision, not a feature to add later.

## Implications for Roadmap

Based on combined research, the component dependency graph and pitfall risk profile suggest this phase structure:

### Phase 1: Foundation — DB Schema, Auth, and Token Ledger
**Rationale:** Auth gates every user-facing feature. The token ledger's append-only design must be established before any token movement; retrofitting this later from a mutable balance column is destructive. Schema must come before any other code.
**Delivers:** Working SMS OTP login/signup, 1,000-token grant on first login, persistent token balance in navigation
**Features addressed:** Phone/SMS auth, free token grant, token balance display
**Pitfalls avoided:** Race condition pitfall (ledger design eliminates mutable balance risks from day one); multi-account pitfall (phone uniqueness DB constraint established here)
**Stack:** Supabase Auth + Twilio Verify, `@supabase/ssr`, Next.js App Router auth routes, `token_ledger` table

### Phase 2: AMM Core — CPMM Math (Isolated, Tested)
**Rationale:** The AMM service is the highest-risk component and has no external dependencies — it's pure math. Build and unit-test it in complete isolation before wiring it to the database or API. This is the right time to verify the CPMM implementation handles edge cases (zero pools, dust bets, large bets draining a pool).
**Delivers:** Verified CPMM functions for `buyYesShares`, `buyNoShares`, `yesProbability`, with unit tests asserting precision to 8 decimal places across 1,000-trade simulations
**Features addressed:** Dynamic odds via AMM (foundational)
**Pitfalls avoided:** LMSR b parameter trap (CPMM is chosen, no parameter exists); floating-point drift (decimal.js enforced in tests)
**Stack:** `decimal.js`, Vitest or Jest for unit tests, `lib/amm/cpmm.ts`

### Phase 3: Markets and Betting — Core Loop
**Rationale:** With auth, tokens, and AMM proven, the core product loop can be assembled. This phase delivers the minimum working product: create a market, bet on it, watch odds move, see your balance decrease. The bet API must use atomic transactions from day one.
**Delivers:** Market creation (binary, with resolution criteria field), market feed, market detail with live YES/NO odds, bet placement with CPMM (atomic DB transaction), bet slip payout preview, Supabase Realtime live odds
**Features addressed:** Binary market creation, market feed, market detail + odds, place bet, bet slip/payout preview, real-time odds
**Pitfalls avoided:** Race condition pitfall (atomic transaction enforced); ambiguous resolution pitfall (resolution criteria required at creation); polling anti-pattern (Realtime subscription from day one)
**Stack:** Next.js API routes, Supabase Realtime, Zod validation, React Hook Form, `decimal.js`

### Phase 4: Resolution and Leaderboard
**Rationale:** The betting loop is only complete once markets can resolve and winners get paid. The leaderboard becomes meaningful only after resolution redistributes tokens. Admin tooling is simple but must be bulletproof — a botched resolution in a 20-person community is a social catastrophe.
**Delivers:** Admin resolution UI (with resolution criteria displayed prominently + resolution note required), atomic payout to all winners proportional to shares, market status transitions (open → locked → resolved), leaderboard by token balance
**Features addressed:** Admin resolution, post-resolution payout, leaderboard
**Pitfalls avoided:** Resolving outside a transaction (all winner credits in one `BEGIN...COMMIT`); admin conflict of interest (UI warns if admin has a position in the market being resolved)
**Stack:** Supabase service-role client, PostgreSQL transactions, admin middleware role check

### Phase 5: Social Layer and Engagement
**Rationale:** Once the core loop is working and users are actually betting and resolving markets, add the engagement features that keep them coming back and pull in new participants.
**Delivers:** Multiple-choice markets (per-option pools), market comments, user profile with bet history, share market link with OG meta tags, periodic prize system UI
**Features addressed:** Multiple-choice markets, comments, bet history/profile, share link, prize system
**Pitfalls avoided:** Token inflation (periodic reset and prize eligibility rules enforced here); empty feed (admin seeds markets before this phase goes live)
**Stack:** OG meta tags (Next.js metadata API), same Supabase stack

### Phase Ordering Rationale

- **Auth before everything:** User identity gates token grants, bets, and market creation. No flexibility here.
- **AMM isolated before integrated:** Testing CPMM math in pure isolation catches precision bugs before they touch real data. Once wired to a live DB with real users, a math bug in production corrupts balances.
- **Atomic transactions from day one:** Race condition fixes cannot be applied retroactively without a full balance audit. The correct pattern (server-side AMM + atomic DB transaction) must be established in Phase 3.
- **Resolution before leaderboard:** A leaderboard of starting balances is meaningless. The leaderboard only becomes a product feature after several markets resolve and tokens redistribute.
- **Multiple-choice after binary is proven:** Each option in a multiple-choice market gets its own AMM pool. This adds non-trivial complexity. Don't tackle it until binary CPMM is production-proven.
- **Comments are decoupled:** Can be added in Phase 5 without touching betting or AMM logic at all — no reason to include earlier.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Betting):** Supabase-specific patterns for `SELECT FOR UPDATE` + `BEGIN...COMMIT` from Next.js Server Actions vs. API routes need verification; the exact transaction API in the Supabase JS client vs. raw Postgres client matters
- **Phase 5 (Multiple-choice markets):** Per-option AMM pool normalization (probabilities must sum to 100%) is underdocumented for non-blockchain apps; needs a dedicated spike

Phases with standard patterns (skip research-phase):
- **Phase 1 (Auth):** Supabase phone OTP is official, well-documented, and straightforward
- **Phase 2 (AMM math):** CPMM math is deterministic and fully documented; implementation is ~50 lines
- **Phase 4 (Resolution):** Standard PostgreSQL transaction pattern, no novel integration required

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All choices verified against official docs (Next.js, Supabase, Twilio Verify). Version compatibility confirmed. |
| Features | MEDIUM | Table stakes features verified against Manifold/Polymarket/Gnosis docs. Small-community-niche features (informal prizes, tight social group) inferred from first principles — no direct published analogs. |
| Architecture | MEDIUM-HIGH | CPMM math and ledger patterns verified across multiple authoritative sources. Supabase Realtime and transaction patterns verified via official docs. Polymarket internal architecture is inferred (no official architectural docs). |
| Pitfalls | HIGH | Critical pitfalls (race conditions, resolution disputes, multi-account gaming) are well-documented across prediction market literature and Twilio fraud documentation. |

**Overall confidence:** HIGH for what to build and how to build it. MEDIUM for exact feature scope of v1.x (the engagement layer after core loop).

### Gaps to Address

- **Supabase transaction API in Next.js context:** The Supabase JS client does not expose a raw `BEGIN...COMMIT` API directly. The correct pattern for atomic multi-step writes in Next.js Server Actions needs a brief spike — options are Supabase RPC (stored procedure), `pg` client via Supabase connection string, or Supabase Edge Functions. Resolve before Phase 3 planning.
- **Multiple-choice AMM normalization:** How to enforce that per-option pool probabilities sum to 1.0 across N independent CPMM pools is unresolved. This may require a market-level normalization step after each bet. Needs a dedicated design spike before Phase 5 planning.
- **VoIP blocking via Twilio Lookup:** Confirmed in Twilio docs that VoIP rejection requires enabling `line_type_intelligence` add-on. Pricing and configuration steps not yet verified. Validate before Phase 1 goes to production.
- **Supabase Realtime connection limits on free tier:** Free tier has a limit on simultaneous Realtime connections. At 20 users all viewing a hot market simultaneously, this should be fine — but the exact limit needs confirmation before any scaling discussion.

## Sources

### Primary (HIGH confidence)
- [Next.js 16 official blog](https://nextjs.org/blog/next-16) — Turbopack default, React 19.2, caching APIs
- [Next.js PWA official guide](https://nextjs.org/docs/app/guides/progressive-web-apps) — Built-in manifest, service worker, web-push (updated 2026-02-16)
- [Supabase phone login docs](https://supabase.com/docs/guides/auth/phone-login) — Twilio Verify integration, OTP flow
- [Supabase Realtime docs](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) — Postgres changes subscription
- [Gnosis Conditional Tokens AMM docs](https://conditionaltokens-docs.dev.gnosisdev.com/conditionaltokens/docs/introduction3/) — CPMM vs LMSR comparison
- [Paradigm pm-AMM research](https://www.paradigm.xyz/2024/11/pm-amm) — CPMM tradeoffs, LP loss mechanics
- [Twilio Verify pricing](https://www.twilio.com/en-us/verify/pricing) — $0.05/verification + $0.0083/SMS
- [Twilio fraud prevention docs](https://www.twilio.com/docs/verify/preventing-toll-fraud) — VoIP blocking, rate limiting
- [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) — Migration complete

### Secondary (MEDIUM confidence)
- [Manifold Markets — Market Mechanics](https://news.manifold.markets/p/above-the-fold-market-mechanics) — CPMM/Maniswap as production AMM
- [Manifold Markets FAQ](https://docs.manifold.markets/faq) — Token system, market types, creator resolution model
- [Polymarket documentation](https://docs.polymarket.com/) — CPMM usage, market structure
- [Polkamarkets AMM documentation](https://help.polkamarkets.com/how-polkamarkets-works/automated-market-maker-(amm)) — CPMM math verification
- [pgledger — Ledger implementation in PostgreSQL](https://www.pgrs.net/2025/03/24/pgledger-ledger-implementation-in-postgresql/) — Append-only ledger pattern

### Tertiary (LOW confidence)
- [BettorEdge — Social prediction markets](https://www.bettoredge.com/post/social-prediction-markets-the-next-evolution-in-sports-betting) — Social feature patterns
- [EA Forum — Manifold Markets critique](https://forum.effectivealtruism.org/posts/EaR9xFxspmYRkm3eo/manifold-markets-isn-t-very-good) — Incentive misalignment, puppet accounts
- [InGame — Cheating in prediction markets](https://www.ingame.com/everyone-cheating-prediction-markets/) — Gaming patterns and prevalence
- [Decrypt — Prediction market wash trading](https://decrypt.co/357583/prediction-markets-grew-4x-to-63-5b-in-2025-but-risk-structural-strain-certik) — Wash trading volume statistics

---
*Research completed: 2026-02-19*
*Ready for roadmap: yes*
