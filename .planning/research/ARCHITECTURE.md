# Architecture Research

**Domain:** Mobile-first prediction market web app (virtual tokens, AMM-based odds, SMS auth, admin resolution, leaderboard prizes)
**Researched:** 2026-02-19
**Confidence:** MEDIUM-HIGH — Core patterns verified across multiple sources; CPMM math verified via Polkamarkets/Manifold official docs; Supabase realtime verified via official docs; AMM trade-off for virtual tokens is well-understood but not commonly documented for non-blockchain apps.

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer (PWA)                      │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Market Feed │  Market View │   Bet UI     │  Leaderboard   │
│  (list/card) │ (odds/graph) │  (buy YES/NO)│  (rankings)    │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
       │              │              │                │
       │        WebSocket/SSE (Supabase Realtime)     │
       │              │              │                │
┌──────┴───────────────────────────────────────────────────────┐
│                     API Layer (Next.js API Routes)            │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│  Auth API    │  Market API  │  Bet API     │  Admin API      │
│  (SMS OTP)   │  (CRUD)      │  (AMM logic) │  (resolve)      │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬────────┘
       │              │              │                │
┌──────┴───────────────────────────────────────────────────────┐
│                   Service Layer (Business Logic)              │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│  AuthService │ MarketService│  AMMService  │ ResolutionSvc   │
│              │              │  (CPMM math) │ (payout calc)   │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬────────┘
       │              │              │                │
┌──────┴───────────────────────────────────────────────────────┐
│                    Data Layer (Supabase + PostgreSQL)          │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│  users       │  markets     │  positions   │  token_ledger   │
│  profiles    │  outcomes    │  bets        │  leaderboard    │
└──────────────┴──────────────┴──────────────┴─────────────────┘
       │
┌──────┴─────────────────────────────────────────────────────┐
│               External Services                             │
│  Twilio Verify (SMS OTP)   Supabase Auth (session mgmt)    │
└────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| PWA Client | Render market feed, bet UI, odds display, leaderboard | Next.js App Router, React, mobile-first CSS |
| Auth API | Phone OTP request, OTP verification, session issuance | Supabase Auth + Twilio Verify provider |
| Market API | Create markets, list markets, get market detail | Next.js API routes, Supabase client |
| Bet API | Validate bet, run CPMM math, update pools + position atomically | Server-side only — never trust client with AMM |
| AMM Service | CPMM calculation: shares out, new pool state, implied probability | Pure TypeScript functions (deterministic, testable) |
| Resolution Service | Admin marks outcome, calculate winner shares, distribute tokens | PostgreSQL transaction: update market + write ledger entries |
| Token Ledger | Immutable record of every token in/out per user | Ledger table (append-only) — balance derived from sum |
| Supabase Realtime | Push pool state changes to connected clients after each bet | Postgres Changes or Broadcast trigger on markets/outcomes tables |
| Leaderboard | Ranked list of users by current token balance, periodic snapshot | Materialized view or summary table with periodic prizes |

---

## Recommended Project Structure

```
src/
├── app/                        # Next.js App Router pages
│   ├── (auth)/
│   │   ├── login/              # Phone number entry
│   │   └── verify/             # OTP confirmation
│   ├── (app)/
│   │   ├── feed/               # Market list (home)
│   │   ├── markets/[id]/       # Market detail + bet UI
│   │   ├── leaderboard/        # Rankings + prize info
│   │   └── admin/              # Admin: create, resolve
│   └── api/
│       ├── auth/               # OTP request/verify endpoints
│       ├── markets/            # Market CRUD
│       ├── bets/               # Bet placement (server-side AMM)
│       └── admin/              # Resolution, market management
├── lib/
│   ├── amm/
│   │   ├── cpmm.ts             # CPMM math: shares, probabilities
│   │   └── cpmm.test.ts        # Unit tests — math must be exact
│   ├── resolution/
│   │   └── payout.ts           # Winner token distribution calc
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   ├── server.ts           # Server Supabase client (cookies)
│   │   └── admin.ts            # Service-role client (admin ops)
│   └── validators/
│       └── bet.ts              # Input validation (amount, market state)
├── components/
│   ├── market/
│   │   ├── MarketCard.tsx      # Feed list item
│   │   ├── OddsBar.tsx         # Visual probability display
│   │   └── BetForm.tsx         # YES/NO bet input
│   ├── leaderboard/
│   │   └── RankingTable.tsx
│   └── ui/                     # Shared design system components
├── hooks/
│   ├── useMarketRealtime.ts    # Supabase subscription for live odds
│   └── useUserBalance.ts       # Current token balance from ledger
└── types/
    └── db.ts                   # Generated Supabase types
```

### Structure Rationale

- **lib/amm/:** AMM math is pure logic — isolated, independently testable, no DB or HTTP dependencies. This is non-negotiable: bugs here lose users tokens.
- **app/api/bets/:** Bet placement must be server-side. Clients cannot be trusted to compute or report their own AMM outcome.
- **lib/supabase/:** Three distinct clients prevent privilege escalation — browser client (anon key, RLS enforced), server client (user session from cookies), admin client (service role, bypasses RLS for resolution).

---

## Architectural Patterns

### Pattern 1: CPMM for Binary Markets

**What:** Maintain YES and NO share pools where `yes_pool * no_pool = k`. When a user bets X tokens on YES, they receive shares = `yes_pool - k / (no_pool + X)`. Market probability = `no_pool / (yes_pool + no_pool)`.

**When to use:** All binary (Yes/No) markets. The math is elementary, requires no floating-point log approximations (unlike LMSR), and pools are trivially crowdfunded from the market creation deposit.

**Trade-offs:** Simple and battle-tested (Manifold uses this). Liquidity providers lose when markets resolve (impermanent loss), but for this app — where the house seeds initial liquidity and there are no external LPs — this is not a concern.

**Example:**

```typescript
// lib/amm/cpmm.ts

export interface PoolState {
  yesPool: number;  // YES shares in pool
  noPool: number;   // NO shares in pool
}

// Compute shares out and new pool state for a YES bet of `betAmount` tokens
export function buyYesShares(pool: PoolState, betAmount: number): {
  sharesOut: number;
  newPool: PoolState;
} {
  const k = pool.yesPool * pool.noPool;
  const newNoPool = pool.noPool + betAmount;
  const newYesPool = k / newNoPool;
  const sharesOut = pool.yesPool - newYesPool;
  return {
    sharesOut,
    newPool: { yesPool: newYesPool, noPool: newNoPool },
  };
}

// Market-implied probability of YES
export function yesProbability(pool: PoolState): number {
  return pool.noPool / (pool.yesPool + pool.noPool);
}
```

### Pattern 2: Append-Only Token Ledger

**What:** Never store token balance as a mutable column. Use an append-only ledger table where each row records a credit or debit with reason and timestamp. Current balance is `SUM(amount)` for a user.

**When to use:** Every token movement — signup bonus, bet placement, market resolution payout. Always.

**Trade-offs:** Slightly more complex queries, but provides full audit trail, supports time-travel balance reconstruction, and eliminates balance drift from race conditions.

**Example:**

```typescript
// Each token event writes a ledger row inside the same DB transaction
// as whatever else is happening (e.g., creating a position record)

// Schema (simplified):
// token_ledger(id, user_id, amount, reason, reference_id, created_at)
//   amount: positive = credit, negative = debit
//   reason: 'signup_bonus' | 'bet_placed' | 'resolution_payout' | 'adjustment'
//   reference_id: bet_id or market_id for traceability

// Balance query:
// SELECT SUM(amount) FROM token_ledger WHERE user_id = $1
```

### Pattern 3: Server-Side AMM with Optimistic UI

**What:** All AMM calculations happen server-side in the API route. The client sends `{ marketId, outcome: 'YES' | 'NO', betAmount }` and receives back `{ sharesReceived, newProbability }`. The client can show a preview estimate using the same CPMM formula locally (optimistic), then confirm with the server response.

**When to use:** Every bet. Non-negotiable — client-side AMM execution would allow users to manipulate their share count.

**Trade-offs:** One network round-trip before confirming. Acceptable: bets are not high-frequency in a social prediction market.

### Pattern 4: Market State Machine

**What:** Markets transition through explicit states. Illegal transitions are rejected at the API layer.

**When to use:** All market lifecycle operations.

```
OPEN → LOCKED (resolution date reached, no more bets)
LOCKED → RESOLVED (admin declares winner)
OPEN → CANCELLED (admin cancels before resolution)
RESOLVED → [terminal] (no further transitions)
```

**Example schema constraint:**

```sql
-- Only allow valid state transitions via a CHECK or trigger
ALTER TABLE markets ADD CONSTRAINT valid_status
  CHECK (status IN ('open', 'locked', 'resolved', 'cancelled'));
```

---

## Data Flow

### Bet Placement Flow

```
User taps "Bet 50 tokens on YES"
    ↓
BetForm (client) → POST /api/bets { marketId, outcome: 'YES', amount: 50 }
    ↓
API Route (server):
  1. Verify user session (Supabase Auth)
  2. Validate: market is OPEN, amount > 0, user balance >= amount
  3. Run CPMM math: sharesOut, newPoolState = buyYesShares(currentPool, 50)
  4. BEGIN TRANSACTION:
       - UPDATE markets SET yes_pool=newYesPool, no_pool=newNoPool
       - INSERT INTO positions (user_id, market_id, outcome, shares)
       - INSERT INTO token_ledger (user_id, amount=-50, reason='bet_placed', reference_id=bet_id)
     COMMIT
  5. Supabase Realtime broadcasts pool change to subscribed clients
    ↓
Response: { sharesReceived: 47.3, newProbability: 0.65 }
    ↓
OddsBar updates live for all viewers via Realtime subscription
```

### Market Resolution Flow

```
Admin opens /admin → views market → selects winning outcome → clicks "Resolve"
    ↓
POST /api/admin/markets/[id]/resolve { winningOutcome: 'YES' }
    ↓
API Route (server, service-role client):
  1. Verify admin role (RLS or middleware check)
  2. Validate: market is OPEN or LOCKED, not already resolved
  3. Fetch all positions for this market where outcome = 'YES'
  4. Calculate each winner's payout:
       payout_i = (user_i_shares / total_winning_shares) * total_pool_value
  5. BEGIN TRANSACTION:
       - UPDATE markets SET status='resolved', winning_outcome='YES', resolved_at=NOW()
       - For each winner: INSERT INTO token_ledger (credit payout)
     COMMIT
  6. Realtime broadcasts market resolved event
```

### Realtime Odds Update Flow

```
Client mounts MarketView page
    ↓
useMarketRealtime(marketId) hook subscribes to Supabase channel
    ↓
Another user places a bet → server updates yes_pool / no_pool
    ↓
Supabase Realtime pushes UPDATE event on markets row
    ↓
OddsBar re-renders with new probability instantly (no polling)
```

### Key Data Flows Summary

1. **Auth flow:** Phone number → Twilio SMS OTP → Supabase session token → cookie → all subsequent requests authenticated via cookie
2. **Token grant:** Account creation triggers signup bonus ledger credit (via Supabase DB hook or post-auth server action)
3. **Bet flow:** Client → server API → CPMM math → atomic DB transaction (pool update + position insert + ledger debit) → realtime broadcast
4. **Resolution flow:** Admin API → fetch positions → calculate payouts → atomic DB transaction (market resolved + ledger credits for all winners)
5. **Leaderboard flow:** Materialized view or aggregated query over token_ledger grouped by user, ordered by balance

---

## Database Schema (Core Tables)

```sql
-- Users managed by Supabase Auth (auth.users)
-- Extend with a public profile:
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id),
  phone       TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Markets (binary or multiple-choice)
CREATE TABLE markets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      UUID REFERENCES profiles(id),
  question        TEXT NOT NULL,
  description     TEXT,
  market_type     TEXT NOT NULL CHECK (market_type IN ('binary', 'multiple')),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'locked', 'resolved', 'cancelled')),
  resolution_date TIMESTAMPTZ NOT NULL,
  winning_outcome_id UUID,         -- set on resolution
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Outcomes (YES/NO for binary; multiple rows for multi-choice)
CREATE TABLE outcomes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID NOT NULL REFERENCES markets(id),
  label       TEXT NOT NULL,       -- 'Yes', 'No', or custom
  yes_pool    NUMERIC NOT NULL DEFAULT 50,  -- initial seeded liquidity
  no_pool     NUMERIC NOT NULL DEFAULT 50,  -- (binary only; multi uses separate pools)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- User positions (shares held)
CREATE TABLE positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  market_id   UUID NOT NULL REFERENCES markets(id),
  outcome_id  UUID NOT NULL REFERENCES outcomes(id),
  shares      NUMERIC NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only token ledger (source of truth for balances)
CREATE TABLE token_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id),
  amount        NUMERIC NOT NULL,   -- positive = credit, negative = debit
  reason        TEXT NOT NULL,      -- 'signup_bonus' | 'bet_placed' | 'resolution_payout'
  reference_id  UUID,               -- bet/market id for traceability
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Leaderboard snapshot (periodic, for prize tracking)
CREATE TABLE leaderboard_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ,
  user_id     UUID NOT NULL REFERENCES profiles(id),
  token_balance NUMERIC NOT NULL,
  rank        INT,
  prize_awarded NUMERIC DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Component Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Client ↔ API Routes | HTTPS REST + Supabase Realtime (WebSocket) | Never expose service-role key to client |
| API Routes ↔ AMM Service | Direct function call (same process) | AMM is pure TS functions, no network hop |
| API Routes ↔ Supabase | Supabase server client (cookie-based session) | Use server client in API routes, not browser client |
| Admin API ↔ Supabase | Service-role client (bypasses RLS) | Only for admin resolution operations |
| Supabase Auth ↔ Twilio | Configured in Supabase dashboard; Supabase calls Twilio | No direct app-to-Twilio calls needed |
| Resolution Service ↔ Token Ledger | Single PostgreSQL transaction | Must be atomic — partial resolution corrupts balances |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Twilio Verify | Configured as Supabase SMS provider; Supabase handles the call | No custom Twilio SDK needed in app code |
| Supabase Auth | `supabase.auth.signInWithOtp({ phone })` | Built-in OTP flow, sessions managed automatically |
| Supabase Realtime | `supabase.channel('market:id').on('postgres_changes', ...)` | Subscribe to outcomes table UPDATE for live odds |

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 users | Monolith is fine. Single Supabase project, free tier. No caching needed. Direct Postgres queries for leaderboard. |
| 100-1K users | Add materialized view for leaderboard refreshed every N minutes. Consider Supabase Pro for higher realtime connections. |
| 1K-10K users | Cache leaderboard in Redis (Upstash). Add Postgres indexes on token_ledger(user_id) and positions(market_id). Consider edge middleware for auth verification. |
| 10K+ users | Split AMM bet processing into queue (BullMQ) to serialize concurrent bets on same market. Read replicas for feed queries. |

### Scaling Priorities

1. **First bottleneck — Concurrent bets on hot markets:** Multiple users betting on the same market simultaneously can cause read-write conflicts on the pool state. Fix: optimistic locking with retry, or a queue per market. For 10-20 initial users this is irrelevant.
2. **Second bottleneck — Leaderboard query cost:** `SELECT user_id, SUM(amount) FROM token_ledger GROUP BY user_id ORDER BY SUM(amount) DESC` gets expensive as ledger grows. Fix: maintain a `user_balances` materialized view refreshed on each ledger write, or a cached summary table.

---

## Anti-Patterns

### Anti-Pattern 1: Mutable Balance Column

**What people do:** Store `users.token_balance NUMERIC` and `UPDATE users SET token_balance = token_balance - 50 WHERE id = $1`.

**Why it's wrong:** No audit trail. Race conditions between concurrent transactions produce incorrect balances. Cannot reconstruct history or debug discrepancies.

**Do this instead:** Append-only token_ledger table. Current balance = `SELECT SUM(amount) FROM token_ledger WHERE user_id = $1`. Wrap balance reads and writes in the same Postgres transaction as bet/resolution logic.

### Anti-Pattern 2: Client-Side AMM Execution

**What people do:** Send CPMM math to the browser, have the client compute its own share count, and POST the result to the server.

**Why it's wrong:** Trivially exploitable. Any user can manipulate the POST body to claim more shares than they should receive.

**Do this instead:** Server calculates all AMM math. Client may compute a preview estimate for UX, but the server result is authoritative and what gets written to DB.

### Anti-Pattern 3: Resolving Outside a Transaction

**What people do:** Loop through winners and credit each user in separate UPDATE calls.

**Why it's wrong:** If the process crashes mid-loop, some users get credited and others don't. Market is left in a corrupt half-resolved state.

**Do this instead:** Build the entire resolution — market status update + all ledger credit inserts — in a single `BEGIN ... COMMIT` block. Use Supabase's `rpc()` for a stored procedure, or a server-side transaction with the Postgres client.

### Anti-Pattern 4: Using LMSR for a Simple Social App

**What people do:** Implement the Logarithmic Market Scoring Rule because it's academically cited for prediction markets.

**Why it's wrong:** LMSR requires computing logarithms and exponentials on every bet, needs a manually tuned liquidity parameter `b`, and is harder to explain to users. The complexity is justified for financial platforms; it is overkill for a social prediction game.

**Do this instead:** CPMM (Constant Product Market Maker). Simpler math (multiply/divide only), no free parameters to tune, and used successfully by Manifold Markets for the same social-prediction-game use case.

### Anti-Pattern 5: Polling for Odds Updates

**What people do:** `setInterval(() => fetchMarket(id), 5000)` to refresh odds.

**Why it's wrong:** Wasteful, introduces latency, and creates thundering herd on popular markets. Battery drain on mobile.

**Do this instead:** Supabase Realtime subscription on the outcomes table. Server pushes updates to all connected clients instantly after each bet settles.

---

## Build Order Implications

The component dependency graph dictates this build sequence:

1. **Database schema + Supabase setup** — everything else depends on it
2. **Auth (SMS OTP)** — gating for all user-facing features
3. **Token ledger + signup bonus** — users need tokens before they can bet
4. **Market creation (CRUD)** — markets must exist before bets
5. **AMM service (CPMM math)** — pure functions, no dependencies, testable in isolation early
6. **Bet placement API** — depends on AMM service, token ledger, markets
7. **Realtime odds subscriptions** — depends on bet placement being live
8. **Admin resolution** — depends on markets and token ledger
9. **Leaderboard** — depends on token ledger having data
10. **Prize system** — depends on leaderboard being correct

Do not build the bet UI before the bet API is working. Do not build resolution before the token ledger is correct. Test AMM math in unit tests before wiring it to the database.

---

## Sources

- [Polkamarkets AMM Documentation — CPMM/FPMM for prediction markets](https://help.polkamarkets.com/how-polkamarkets-works/automated-market-maker-(amm)) — MEDIUM confidence (official Polkamarkets docs, verified CPMM math)
- [Manifold Markets — Market Mechanics (CPMM/Maniswap)](https://news.manifold.markets/p/above-the-fold-market-mechanics) — MEDIUM confidence (official Manifold blog, verified CPMM application)
- [Polymarket Architecture — Rock'n'Block](https://rocknblock.io/blog/how-polymarket-works-the-tech-behind-prediction-markets) — LOW-MEDIUM confidence (third-party analysis of Polymarket, not official Polymarket docs)
- [Supabase Phone Login — Official Docs](https://supabase.com/docs/guides/auth/phone-login) — HIGH confidence (official Supabase documentation)
- [Supabase Realtime — Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) — HIGH confidence (official Supabase documentation)
- [Ledger Implementation in PostgreSQL — pgrs.net](https://www.pgrs.net/2025/03/24/pgledger-ledger-implementation-in-postgresql/) — MEDIUM confidence (well-regarded engineering blog, pattern widely corroborated)
- [pm-AMM: Paradigm Research on Prediction Market AMMs](https://www.paradigm.xyz/2024/11/pm-amm) — HIGH confidence (Paradigm official research, confirms CPMM tradeoffs)
- [Gnosis Conditional Tokens — AMM Documentation](https://conditionaltokens-docs.dev.gnosisdev.com/conditionaltokens/docs/introduction3/) — HIGH confidence (official Gnosis docs, confirms LMSR vs CPMM tradeoffs)

---

*Architecture research for: Mobile-first prediction market web app*
*Researched: 2026-02-19*
