# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Frontrun is a mobile-first prediction market web app where users bet on binary or multiple-choice outcomes using virtual tokens. SMS-based auth, CPMM AMM for dynamic odds, append-only token ledger, admin-managed resolution, AI-generated resolution criteria.

## Commands

```bash
npm run dev          # Dev server at localhost:3000
npm run build        # Production build
npm run lint         # ESLint
npx vitest           # Run all tests
npx vitest run src/lib/amm/cpmm.test.ts  # Run single test file
```

## Tech Stack

- **Next.js 16** (App Router, Server Components) + **React 19** + **TypeScript 5** (strict)
- **Supabase** for PostgreSQL, Auth (SMS OTP via Twilio), Realtime subscriptions
- **Tailwind CSS 4** + **shadcn/ui** (Radix primitives) + dark-only theme (oklch colors)
- **Zod 4** for validation, **React Hook Form** for forms
- **decimal.js** for CPMM math (20-digit precision, no floating-point drift)
- **Anthropic SDK** (`claude-haiku-4-5-20251001`) for AI-generated resolution criteria
- **Recharts** for probability trend charts on market detail pages
- **Netlify** deployment with `@netlify/plugin-nextjs`
- Path alias: `@/*` maps to `./src/*`

## Architecture

### Route Groups & Middleware

- `src/app/(auth)/` — Login/verify pages (unauthenticated only)
- `src/app/(app)/` — All protected pages: feed, markets/[id], leaderboard, profile, admin/{balances,bans,prizes,notifications}
- `src/middleware.ts` — Auth routing: unauthed users → `/login`, authed users on auth pages → `/feed`, root `/` redirects based on auth state. Refreshes Supabase session before route checks. Banned users are signed out and redirected to `/banned`.

### API Routes

- `POST /api/payments/create-intent` — Creates Stripe PaymentIntent server-side. Validates tier key against server-authoritative `TIERS` constant (client never sends dollar amounts), inserts pending purchase record, returns `clientSecret`.
- `POST /api/webhooks/stripe` — Processes `payment_intent.succeeded` and `payment_intent.payment_failed`. Uses `request.text()` (not `.json()`) for signature verification. Deduplicates via `stripe_events` table (unique constraint on `event_id`). Credits tokens via `credit_token_purchase` RPC.

### Server Actions Pattern

All mutations use Next.js server actions in `src/lib/*/actions.ts` with a consistent pattern:
- Zod schema validation on inputs
- Return type: `{ success: true; data: T } | { success: false; error: string }`
- Structured logging: `[ISO timestamp] LEVEL: message`

### Market Types

**Binary markets:** Single YES/NO outcome with `market_pools` table (one row per market).

**Multiple-choice markets:** N outcomes stored in `market_outcomes` table, each with its own liquidity pool in `outcome_pools`. Initial liquidity (5000 tokens) is split equally across outcomes. Dedicated RPCs: `place_bet_mc`, `resolve_market_mc`.

### Market Creation Flow

- Validates question (5+ chars), resolution criteria (10+ chars), close date (3-month max)
- Prevents duplicate open markets with same question (case-insensitive)
- Seeds 5000 tokens of initial liquidity (house-funded): 2500 YES / 2500 NO for binary, split equally for multi-choice
- Fire-and-forget SMS notification to opted-in users
- Admin users CAN bet on their own markets; regular users cannot

### AI Resolution Criteria

`src/lib/ai/actions.ts` — Server action `generateResolutionCriteria()` uses Anthropic SDK to auto-generate 1-3 sentence resolution rules from a market question and outcomes. Used during market creation.

### Stripe Payment Flow

Server-authoritative tiers in `src/lib/stripe/tiers.ts` (small=$5/500T, medium=$10/1100T, large=$20/2400T). Flow: user selects tier on `/buy` → `CheckoutForm` calls `/api/payments/create-intent` with tier key → server creates PaymentIntent with `user_id`/`tier`/`tokens` in metadata → client confirms with `stripe.confirmPayment()` → Stripe webhook fires → `credit_token_purchase` RPC atomically credits tokens. PaymentIntent metadata is the secure channel — populated server-side, never client-controlled.

### Token Economy (Append-Only Ledger)

Balances are **never stored as a mutable column**. Balance = `SUM(token_ledger.amount) WHERE user_id = $1`. This prevents race conditions and provides a full audit trail. The `user_balances` view materializes this sum.

### CPMM (Constant Product Market Maker)

Core math in `src/lib/amm/cpmm.ts` — pure functions, no side effects. Formula: `yesPool * noPool = k`. All arithmetic uses `decimal.js`. Tested with 1,000-trade simulations for zero drift. `ProbabilityTrendChart` replays position history through the CPMM formula to visualize historical probability trends.

### Atomic Database Operations

Betting, resolution, cancellation, and token purchases use **Supabase RPC stored procedures** to atomically update multiple tables in a single transaction. All RPCs use `SECURITY DEFINER` and row-level locks (`FOR UPDATE`) to prevent race conditions:
- `place_bet` / `place_bet_mc` — Locks market, calculates CPMM shares, updates pools, inserts position, debits ledger
- `cancel_bet` — Sells shares back into AMM pool at current market prices, credits user
- `resolve_market` / `resolve_market_mc` — Validates admin + market status, calculates payouts per share, credits winners
- `cancel_market` — Refunds all bettors, sets status to 'cancelled'
- `credit_token_purchase` — Idempotent (returns `already_processed` if double-called), credits ledger, marks purchase complete

### Supabase Clients

Three client variants in `src/lib/supabase/`:
- `client.ts` — Browser client (RLS-enforced, used in client components)
- `server.ts` — Server client (cookie-based auth, used in server actions/components)
- `admin.ts` — Service role client (bypasses RLS, used for RPC calls)

### Notification Systems

**In-app broadcast popups** (`src/lib/notifications/admin-actions.ts`): Admins create broadcast messages via `/admin/notifications` with optional title, message, and `max_views` (auto-dismiss after N views). `NotificationPopup` component shows a modal-overlay carousel of unread notifications. Tracked via `notifications` + `notification_dismissals` tables.

**SMS notifications** (`src/lib/notifications/sms.ts`): Fire-and-forget SMS via Twilio on market creation (`notifyNewMarket`) and resolution (`notifyMarketResolved`). Resolution SMS tells winners "You won!" vs just the outcome for losers. Only sends to opted-in, non-banned users. Logged to `sms_log` table. User opt-in preferences: `profiles.notify_new_markets` and `profiles.notify_market_resolved`.

### Real-Time Updates

- `src/hooks/useUserBalance.ts` — Subscribes to `token_ledger` INSERT events, re-fetches derived balance
- `MarketDetail` — Subscribes to `market_pools` UPDATE events for live odds updates

### Component Architecture

Server Components fetch data and pass props to Client Components. Example: `MarketPage` (server) fetches market data → passes to `MarketDetail` (client) which handles interactivity and Realtime subscriptions. Only add `'use client'` when the component needs hooks, event handlers, or browser APIs.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Public anon key (RLS enforced)
SUPABASE_SERVICE_ROLE_KEY       # Admin key (server-only, never exposed to client)
STRIPE_SECRET_KEY               # Stripe secret key (server-only)
STRIPE_WEBHOOK_SECRET           # Stripe webhook signing secret (server-only)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  # Stripe publishable key (client-safe)
ANTHROPIC_API_KEY               # For AI resolution criteria generation (server-only)
```

## Database

Migrations in `supabase/migrations/` (00001–00016). Key tables: `profiles`, `token_ledger`, `markets`, `market_pools`, `market_outcomes`, `outcome_pools`, `positions`, `prize_periods`, `leaderboard_snapshots`, `token_purchases`, `stripe_events`, `bot_trade_log`, `notifications`, `notification_dismissals`, `sms_log`. Views: `user_balances`. RLS enabled on all tables. Generated types in `src/types/db.ts`.

### Trading Bots

10 bot accounts (`profiles.is_bot = true`) provide organic market activity via a Netlify scheduled function (`netlify/functions/bot-trader.mts`) running every 10 minutes. Strategies: `market_maker` (buys underdog when drift >15%), `threshold` (buys cheap side at extremes), `mean_reversion` (combines both with lower thresholds). Bot strategy stored in `auth.users.user_metadata.strategy`. Bots are excluded from leaderboard and prize snapshots. Activity logged to `bot_trade_log` table. Seed script: `scripts/seed-bots.ts`.

## Conventions

- Server actions go in `src/lib/<domain>/actions.ts`; admin-only actions in `src/lib/<domain>/admin-actions.ts`
- Components use `'use client'` directive only when they need interactivity/hooks
- UI primitives live in `src/components/ui/` (shadcn), domain components in `src/components/<domain>/`
- Zod is imported as `import { z } from 'zod/v4'` (v4 subpath export)
- Phone validation: E.164 format (+1, 8-15 digits)
- Token ledger reasons: `signup_bonus`, `bet_placed`, `bet_cancelled`, `resolution_payout`, `market_cancelled_refund`, `adjustment`, `token_purchase`, `bot_seed`, `referral_bonus`
- Admin authorization: check `profiles.is_admin` flag via admin client before privileged operations
- New markets are seeded with 5000 tokens of initial liquidity (2500 YES / 2500 NO), house-funded
- Version bumping is mandatory. Every code change that affects functionality, UI, or behavior must include a version bump (patch for fixes, minor for features). Source of truth: `package.json` version field, injected at build time via `NEXT_PUBLIC_APP_VERSION`, displayed on the profile page via `src/lib/version.ts`
