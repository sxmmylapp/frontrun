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
- Path alias: `@/*` maps to `./src/*`

## Architecture

### Route Groups & Middleware

- `src/app/(auth)/` — Login/verify pages (unauthenticated only)
- `src/app/(app)/` — All protected pages: feed, markets/[id], leaderboard, profile, admin/prizes, buy
- `src/middleware.ts` — Auth routing: unauthed users → `/login`, authed users on auth pages → `/feed`, root `/` redirects based on auth state. Refreshes Supabase session before route checks.

### API Routes

- `POST /api/payments/create-intent` — Creates Stripe PaymentIntent server-side. Validates tier key against server-authoritative `TIERS` constant (client never sends dollar amounts), inserts pending purchase record, returns `clientSecret`.
- `POST /api/webhooks/stripe` — Processes `payment_intent.succeeded` and `payment_intent.payment_failed`. Uses `request.text()` (not `.json()`) for signature verification. Deduplicates via `stripe_events` table (unique constraint on `event_id`). Credits tokens via `credit_token_purchase` RPC.

### Server Actions Pattern

All mutations use Next.js server actions in `src/lib/*/actions.ts` with a consistent pattern:
- Zod schema validation on inputs
- Return type: `{ success: true; data: T } | { success: false; error: string }`
- Structured logging: `[ISO timestamp] LEVEL: message`

### Stripe Payment Flow

Server-authoritative tiers in `src/lib/stripe/tiers.ts` (small=$5/500T, medium=$10/1100T, large=$20/2400T). Flow: user selects tier on `/buy` → `CheckoutForm` calls `/api/payments/create-intent` with tier key → server creates PaymentIntent with `user_id`/`tier`/`tokens` in metadata → client confirms with `stripe.confirmPayment()` → Stripe webhook fires → `credit_token_purchase` RPC atomically credits tokens. PaymentIntent metadata is the secure channel — populated server-side, never client-controlled.

### Token Economy (Append-Only Ledger)

Balances are **never stored as a mutable column**. Balance = `SUM(token_ledger.amount) WHERE user_id = $1`. This prevents race conditions and provides a full audit trail. The `user_balances` view materializes this sum.

### CPMM (Constant Product Market Maker)

Core math in `src/lib/amm/cpmm.ts` — pure functions, no side effects. Formula: `yesPool * noPool = k`. All arithmetic uses `decimal.js`. Tested with 1,000-trade simulations for zero drift.

### Atomic Database Operations

Betting, resolution, cancellation, and token purchases use **Supabase RPC stored procedures** to atomically update multiple tables in a single transaction. All RPCs use `SECURITY DEFINER` and row-level locks (`FOR UPDATE`) to prevent race conditions:
- `place_bet` — Locks market, calculates CPMM shares, updates pools, inserts position, debits ledger
- `resolve_market` — Validates admin + market status, calculates payouts per share, credits winners
- `cancel_market` — Refunds all bettors, sets status to 'cancelled'
- `credit_token_purchase` — Idempotent (returns `already_processed` if double-called), credits ledger, marks purchase complete

### Supabase Clients

Three client variants in `src/lib/supabase/`:
- `client.ts` — Browser client (RLS-enforced, used in client components)
- `server.ts` — Server client (cookie-based auth, used in server actions/components)
- `admin.ts` — Service role client (bypasses RLS, used for RPC calls)

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
