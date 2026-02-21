# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Frontrun is a mobile-first prediction market web app where users bet on binary outcomes using virtual tokens. SMS-based auth, CPMM AMM for dynamic odds, append-only token ledger, admin-managed resolution.

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
- **Zod 4** for validation, **React Hook Form** for forms, **Zustand** for client state
- **decimal.js** for CPMM math (20-digit precision, no floating-point drift)
- **Netlify** deployment with `@netlify/plugin-nextjs`

## Architecture

### Route Groups

- `src/app/(auth)/` — Login/verify pages (unauthenticated only)
- `src/app/(app)/` — All protected pages: feed, markets/[id], leaderboard, profile, admin/prizes
- `src/middleware.ts` — Auth routing: unauthed users → `/login`, authed users on auth pages → `/feed`

### Server Actions Pattern

All mutations use Next.js server actions in `src/lib/*/actions.ts` with a consistent pattern:
- Zod schema validation on inputs
- Return type: `{ success: true; data: T } | { success: false; error: string }`
- Structured logging: `[ISO timestamp] LEVEL: message`

### Token Economy (Append-Only Ledger)

Balances are **never stored as a mutable column**. Balance = `SUM(token_ledger.amount) WHERE user_id = $1`. This prevents race conditions and provides a full audit trail. The `user_balances` view materializes this sum.

### CPMM (Constant Product Market Maker)

Core math in `src/lib/amm/cpmm.ts` — pure functions, no side effects. Formula: `yesPool * noPool = k`. All arithmetic uses `decimal.js`. Tested with 1,000-trade simulations for zero drift.

### Atomic Database Operations

Betting, resolution, and cancellation use **Supabase RPC stored procedures** (`place_bet`, `resolve_market`, `cancel_market`) to atomically update multiple tables (market_pools, positions, token_ledger) in a single transaction.

### Supabase Clients

Three client variants in `src/lib/supabase/`:
- `client.ts` — Browser client (RLS-enforced, used in client components)
- `server.ts` — Server client (cookie-based auth, used in server actions/components)
- `admin.ts` — Service role client (bypasses RLS, used for RPC calls)

### Real-Time Updates

`src/hooks/useUserBalance.ts` subscribes to Postgres INSERT events on `token_ledger` via Supabase Realtime, re-fetching the derived balance on each change.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Public anon key (RLS enforced)
SUPABASE_SERVICE_ROLE_KEY       # Admin key (server-only, never exposed to client)
STRIPE_SECRET_KEY               # Stripe secret key (server-only)
STRIPE_WEBHOOK_SECRET           # Stripe webhook signing secret (server-only)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  # Stripe publishable key (client-safe)
```

## Database

Migrations in `supabase/migrations/` (00001–00006). Key tables: `profiles`, `token_ledger`, `markets`, `market_pools`, `positions`, `prize_periods`, `leaderboard_snapshots`, `token_purchases`, `stripe_events`. Views: `user_balances`. RLS enabled on all tables. Generated types in `src/types/db.ts`. Atomic RPC: `place_bet`, `resolve_market`, `cancel_market`, `credit_token_purchase`.

## Conventions

- Server actions go in `src/lib/<domain>/actions.ts`; admin-only actions in `src/lib/<domain>/admin-actions.ts`
- Components use `'use client'` directive only when they need interactivity/hooks
- UI primitives live in `src/components/ui/` (shadcn), domain components in `src/components/<domain>/`
- Zod is imported as `import { z } from 'zod/v4'` (v4 subpath export)
- Phone validation: E.164 format (+1, 8-15 digits)
- Token ledger reasons: `signup_bonus`, `bet_placed`, `resolution_payout`, `market_cancelled_refund`, `adjustment`, `token_purchase`
- Admin authorization: check `profiles.is_admin` flag via admin client before privileged operations
- New markets are seeded with 1000 tokens of initial liquidity (500 YES / 500 NO), house-funded
- Version injected at build time via `NEXT_PUBLIC_APP_VERSION` from `package.json`
