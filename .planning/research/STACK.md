# Stack Research

**Domain:** Prediction market web app (virtual tokens, AMM-based odds, SMS auth, leaderboard)
**Researched:** 2026-02-19
**Confidence:** HIGH

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.x (latest stable) | Full-stack framework, routing, API routes, SSR | Industry standard for React apps in 2025. App Router is mature and stable. Turbopack is now the default bundler (5-10x faster dev). Server Components reduce client bundle size — critical for mobile performance. Built-in PWA guide published fall 2024. |
| TypeScript | 5.x | Type safety across frontend and backend | Prediction markets have complex AMM math and token accounting — type safety catches bugs before they become financial logic errors. Next.js 16 ships with full React 19 + TS support. |
| Tailwind CSS | 4.x | Utility-first styling, mobile-first by default | shadcn/ui now requires Tailwind v4 (`@theme` directive). Fastest path to polished mobile UI. No runtime overhead — purely build-time CSS. |
| shadcn/ui | latest (CLI-based, no version pin) | Accessible component primitives | You own the source code — copy components into your repo, customize freely. Built on Radix UI for accessibility. Updated for Tailwind v4 and React 19. Best choice when you don't want a heavy component library locking you in. |
| Supabase | latest (hosted) | Database (PostgreSQL), Auth, Realtime | Provides phone/SMS OTP auth natively. Realtime subscriptions via PostgreSQL changes — live market odds updates without WebSocket boilerplate. Row Level Security enforced at DB level. Free tier: 500 MB DB, 50K MAU — more than enough for a ~20-person community app. Managed hosting means no infra to run. |
| Twilio Verify (via Supabase) | v2 | SMS OTP delivery for phone auth | Supabase's phone auth integrates with Twilio Verify directly. $0.05 per successful verification + $0.0083/SMS (US). For 20 users signing up once, cost is negligible. Note: Authy API is defunct — Verify v2 is the correct product. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zustand | 5.x | Client-side global state | Use for UI state that doesn't belong in Supabase (active market selection, modal state, pending bet UI). Lightweight, no boilerplate. Better than Jotai for this app because state is interconnected (user tokens affect multiple views). |
| Zod | 3.x | Schema validation and type inference | Validate all API inputs (bet amounts, market creation fields, admin resolution). Use with Next.js Server Actions for type-safe form handling. Critical for preventing invalid AMM state from bad inputs. |
| React Hook Form | 7.x | Form state management | Pair with Zod for bet placement and market creation forms. Minimal re-renders — important for mobile performance. |
| @supabase/ssr | latest | Supabase + Next.js App Router integration | The official Supabase package for App Router. Replaces the older `@supabase/auth-helpers-nextjs`. Handles cookie-based session management correctly in RSC context. |
| decimal.js | 10.x | Arbitrary precision arithmetic for AMM math | CPMM and LMSR calculations involve floating-point operations that compound errors in standard JS numbers. Use decimal.js for all token and share calculations to avoid rounding bugs that shift market outcomes. |
| date-fns | 3.x | Date utilities | Resolution date display, market expiry countdown, leaderboard period tracking. Smaller than moment.js, tree-shakeable. |
| web-push | 9.x | Push notifications via VAPID keys | Optional: notify users when a market they bet on resolves. Next.js official PWA guide uses this exact library. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Turbopack | Dev server bundler (built into Next.js 16) | Default in Next.js 16. Zero config — just `next dev`. 5-10x faster HMR than Webpack. |
| ESLint | Linting | Use `eslint-config-next` (included). Add `eslint-plugin-tailwindcss` for class order linting. |
| Prettier | Code formatting | Add `prettier-plugin-tailwindcss` for automatic class sorting — essential when working with many utility classes. |
| Supabase CLI | Local dev, migrations, type generation | `supabase gen types typescript` generates TypeScript types from your DB schema. Run this after every migration. |
| @serwist/next | 9.2.3 | Offline support / enhanced PWA | Only needed if you want offline caching. Next.js 16 has built-in PWA manifest support — add Serwist only if you need full offline mode. For this project, the built-in approach is sufficient initially. |

---

## AMM Math: The Core Decision

This is the most important technical decision in the stack. Two options:

### CPMM (Constant Product Market Maker) — Recommended

Formula: `x * y = k` where x and y are shares of each outcome.

**Why:** Simpler to implement correctly. Same mechanism as Uniswap (battle-tested). Manifold Markets uses a variant called "Maniswap" (CPMM-based). No liquidity parameter to tune. Price of YES = `y / (x + y)`.

**Implementation:** No dedicated JS library needed — implement in ~50 lines of TypeScript. Keep all calculations in `decimal.js` for precision.

```typescript
// CPMM core — implement this yourself, don't use a library
import Decimal from 'decimal.js'

export function cpmm(yesShares: Decimal, noShares: Decimal) {
  const k = yesShares.mul(noShares)
  return {
    yesPrice: yesShares.div(yesShares.add(noShares)),
    noPrice: noShares.div(yesShares.add(noShares)),
    k,
  }
}

export function buyShares(
  outcome: 'yes' | 'no',
  tokenAmount: Decimal,
  yesShares: Decimal,
  noShares: Decimal
) {
  const k = yesShares.mul(noShares)
  if (outcome === 'yes') {
    const newNoShares = noShares.add(tokenAmount)
    const newYesShares = k.div(newNoShares)
    const sharesReceived = yesShares.sub(newYesShares)
    return { newYesShares, newNoShares, sharesReceived }
  } else {
    const newYesShares = yesShares.add(tokenAmount)
    const newNoShares = k.div(newYesShares)
    const sharesReceived = noShares.sub(newNoShares)
    return { newYesShares, newNoShares, sharesReceived }
  }
}
```

### LMSR (Logarithmic Market Scoring Rule) — Alternative

More theoretically rigorous but requires a liquidity parameter `b` that must be set at market creation. Getting `b` wrong means either tiny price movements (boring) or extreme sensitivity (gambling-like). LMSR is better for combinatorial markets. For binary YES/NO this app, CPMM is simpler and sufficient.

---

## Hosting

| Service | Recommended Plan | Monthly Cost | Rationale |
|---------|-----------------|-------------|-----------|
| Vercel | Hobby (free) | $0 | Next.js is Vercel's own product — zero config deploy, preview deployments per PR, automatic HTTPS. For 20 users, the free tier is unlimited. Start here. |
| Supabase | Free | $0 | 500 MB DB, 50K MAU — massively sufficient for 20 users. Free projects pause after 1 week of inactivity, but daily use prevents this. |
| Twilio Verify | Pay-as-you-go | ~$0.06/verification | At 20 users, total signup cost ~$1.20. Negligible. |

**Total recurring cost at launch: $0/month.**

---

## Installation

```bash
# Bootstrap Next.js 16 with TypeScript and Tailwind
npx create-next-app@latest prediction-market \
  --typescript \
  --tailwind \
  --app \
  --turbopack \
  --src-dir

# Core dependencies
npm install @supabase/supabase-js @supabase/ssr zustand zod react-hook-form date-fns decimal.js

# shadcn/ui (copies components into your codebase — run after project init)
npx shadcn@latest init

# Dev dependencies
npm install -D prettier prettier-plugin-tailwindcss eslint-plugin-tailwindcss

# Supabase CLI (for migrations + type generation)
npm install -D supabase
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Next.js 16 | Remix | If you need multi-server deployment or more granular streaming control. Not worth the ecosystem trade-off for this project. |
| Supabase | Firebase | If you're already deep in GCP ecosystem. Supabase's PostgreSQL RLS and realtime are better fit for this domain. Firebase's NoSQL makes AMM state harder to reason about. |
| Supabase phone auth | Auth.js (NextAuth) | Auth.js doesn't natively support phone/SMS OTP — you'd bolt Twilio on yourself. Supabase ships this as first-class. |
| CPMM (custom) | Gnosis FPMM contracts | If building on-chain (blockchain). We're building a web app with a database — don't use blockchain primitives. |
| Zustand | Redux Toolkit | If the team is large and needs strict action-based state tracing. Overkill for a ~20-user side project. |
| Tailwind v4 + shadcn | Material UI / Chakra | Both add large runtime deps. shadcn components are zero-runtime (just CSS classes). Mobile bundle size matters. |
| decimal.js | Big.js or native floats | Big.js is fine too. Native floats will produce wrong answers in AMM math — don't use them. |
| Vercel | Railway | Use Railway if you add a background worker (e.g., automated market resolution, scheduled leaderboard snapshots). Railway handles long-running processes; Vercel serverless functions timeout at 10-60s. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Native JS `number` for AMM math | IEEE 754 floating-point errors compound in share calculations. `0.1 + 0.2 !== 0.3`. A rounding error in odds shifts a market incorrectly. | `decimal.js` for all AMM arithmetic |
| `next-pwa` (shadowwalker) | Unmaintained since 2023. No updates for Next.js App Router. | Built-in Next.js PWA manifest + `@serwist/next` if offline is needed |
| Authy API / Twilio Authy | Authy API closed to new sign-ups. Twilio itself recommends migrating away. | Twilio Verify v2 (via Supabase phone auth) |
| Pages Router | Next.js 16 App Router is the current standard. Pages Router is in maintenance mode. | App Router |
| WebSockets (raw) | Supabase Realtime already gives you PostgreSQL change subscriptions with auth — no need to manage WebSocket connections yourself. | Supabase Realtime |
| Prisma | Adds an extra ORM layer when Supabase already exposes a typed client and handles migrations. Duplication of schema management. | Supabase JS client + Supabase CLI for migrations |
| Redux / Redux Toolkit | Massive boilerplate for a small app. The store shape this app needs is simple. | Zustand |
| moment.js | Deprecated, large bundle. | `date-fns` |

---

## Stack Patterns by Variant

**If the app stays at ~20 users (initial scope):**
- Free tiers for everything (Vercel Hobby + Supabase Free)
- No caching layer needed
- Single Supabase project is sufficient

**If users grow to ~1,000:**
- Upgrade Supabase to Pro ($25/mo) for more connections and no inactivity pauses
- Stay on Vercel free or upgrade to Pro ($20/mo) for team features
- Add Redis (Upstash, $0 to $10/mo) if leaderboard queries become slow

**If you add background jobs (e.g., auto-close expired markets):**
- Move hosting from Vercel to Railway — Vercel functions can't run cron jobs longer than 60s on free tier
- Railway Hobby plan at $5/mo handles this cleanly

**If multiple-choice markets use complex AMMs:**
- CPMM still works for N-outcome markets with N liquidity pools
- Keep it simple: implement N separate YES pools, one per outcome, normalized

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@supabase/ssr` latest | Next.js 16 App Router | Replaces deprecated `@supabase/auth-helpers-nextjs`. Required for correct SSR cookie handling. |
| shadcn/ui latest | Tailwind v4, React 19 | shadcn recently migrated to Tailwind v4. Run `npx shadcn@latest init` — don't install an old version. |
| `next` 16.x | React 19.2 | Next.js 16 ships with React 19.2. Don't separately install React 18 — it will conflict. |
| `decimal.js` 10.x | Node 18+, browser | Works in both environments. Use the same `Decimal` instance server-side (Server Actions) and client-side. |
| `@serwist/next` 9.2.3 | Next.js 15+ | Requires webpack config. If staying on Turbopack for dev, Serwist only applies to the production build. |

---

## Sources

- Next.js 16 official blog — [https://nextjs.org/blog/next-16](https://nextjs.org/blog/next-16) — Turbopack stability, React 19.2, caching APIs (HIGH confidence)
- Next.js PWA official guide — [https://nextjs.org/docs/app/guides/progressive-web-apps](https://nextjs.org/docs/app/guides/progressive-web-apps) — Built-in manifest, service worker, web-push (HIGH confidence, updated 2026-02-16)
- Supabase phone login docs — [https://supabase.com/docs/guides/auth/phone-login](https://supabase.com/docs/guides/auth/phone-login) — Supported providers: Twilio, MessageBird, Vonage, TextLocal (HIGH confidence)
- Supabase pricing — [https://supabase.com/pricing](https://supabase.com/pricing) — Free tier: 500 MB DB, 50K MAU (HIGH confidence)
- Twilio Verify pricing — [https://www.twilio.com/en-us/verify/pricing](https://www.twilio.com/en-us/verify/pricing) — $0.05/verification + $0.0083/SMS (HIGH confidence)
- Paradigm pm-AMM paper — [https://www.paradigm.xyz/2024/11/pm-amm](https://www.paradigm.xyz/2024/11/pm-amm) — CPMM vs LMSR comparison (MEDIUM confidence)
- Manifold Markets Wikipedia — [https://en.wikipedia.org/wiki/Manifold_(prediction_market)](https://en.wikipedia.org/wiki/Manifold_(prediction_market)) — Maniswap (CPMM variant) as their AMM (MEDIUM confidence)
- Serwist npm — [https://www.npmjs.com/package/@serwist/next](https://www.npmjs.com/package/@serwist/next) — v9.2.3, updated 20 days ago (HIGH confidence)
- shadcn/ui Tailwind v4 — [https://ui.shadcn.com/docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4) — Tailwind v4 migration complete (HIGH confidence)
- Railway vs Vercel comparison — [https://docs.railway.com/platform/compare-to-vercel](https://docs.railway.com/platform/compare-to-vercel) — Hosting decision rationale (MEDIUM confidence)
- Play Money open source — [https://github.com/casesandberg/play-money](https://github.com/casesandberg/play-money) — Real prediction market stack: TypeScript, Prisma, PostgreSQL, Turborepo (MEDIUM confidence)

---

*Stack research for: Prediction Market — virtual token AMM web app*
*Researched: 2026-02-19*
