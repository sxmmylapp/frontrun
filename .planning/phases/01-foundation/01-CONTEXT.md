# Phase 1: Foundation - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

SMS auth (signup + login via phone OTP), free token grant on first signup, persistent token balance display, and append-only token ledger. This phase establishes the identity and token infrastructure that every subsequent phase depends on.

</domain>

<decisions>
## Implementation Decisions

### Signup/Login Flow
- Single screen auth — one phone number input that auto-detects new vs returning user
- OTP input is a single text field (not individual digit boxes)
- After OTP verification, new users land directly on the market feed (no separate welcome/onboarding screen)
- Auto-generate a fun random display name on signup (e.g., "Lucky Llama") — users can change it later in settings

### Token Grant UX
- Brief celebration moment when a new user first signs up — toast or animation: "You got 1,000 tokens! Start betting."
- Quick tooltip near the balance after first login: "Bet tokens on markets. Top earners win prizes."
- Returning users skip both — straight to the feed

### Balance Display
- Token balance lives in the top nav bar, always visible on every page
- Format: small coin/token icon + formatted number (e.g., coin icon + "1,000")
- No animation on balance change — instant number update
- Balance must update in real-time (reflect bets placed without page refresh)

### App Shell / Branding
- App name: Claude's discretion (pick something short, memorable, fitting for a community prediction market)
- Vibe: Clean and minimal — dark mode, sharp edges, financial/trading app feel (Polymarket-inspired, not playful)
- Dark mode by default (not system-adaptive)
- Mobile navigation: bottom tab bar (Feed, Leaderboard, Profile)
- Mobile-first responsive design — works on desktop but optimized for phone

### Claude's Discretion
- Specific app name selection
- Color palette within the dark/minimal constraint
- Typography choices
- Loading states and skeleton screens
- Error state designs
- Exact celebration animation style for token grant

</decisions>

<specifics>
## Specific Ideas

- Auth should feel effortless — enter phone, get code, you're in. No forms, no passwords, no friction.
- The dark + minimal aesthetic should feel like a trading terminal, not a social media app.
- Bottom tab bar is the primary navigation on mobile — keep it to 3-4 tabs max.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-02-19*
