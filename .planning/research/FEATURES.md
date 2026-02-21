# Feature Research

**Domain:** Community prediction market — virtual tokens, AMM odds, social leaderboard
**Researched:** 2026-02-19
**Confidence:** MEDIUM (features grounded in analysis of Polymarket, Manifold Markets, Kalshi, OG, BettorEdge; confidence docked because the "small trusted community with informal prizes" niche is underrepresented in published product teardowns)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that every prediction market user assumes will exist. Missing any of these makes the product feel broken, not minimal.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Phone/SMS auth + account creation | Mobile-first, no-password standard; users hate passwords on phones | LOW | Twilio Verify or similar; tie token grant to verified account to prevent abuse |
| Free token grant on signup | Play-money markets only work if everyone can participate immediately; friction-free entry is the point | LOW | One-time grant per verified phone number; store balance in DB |
| Market feed / browse screen | Core discovery surface — users need to see what's open to bet on | LOW | Chronological or sorted by close date; filter by status (open/closed/resolved) |
| Market detail page with current odds | Every prediction market shows the live probability before you bet | LOW | YES % and NO % prominently displayed; price history chart optional but expected |
| Binary (Yes/No) market creation | The simplest and most understood format; users default to thinking in binary | MEDIUM | Requires question text, resolution date, initial odds seed |
| Place bet on a market | Core action — without this there is no product | MEDIUM | Buy YES or NO shares with token amount; show projected payout |
| Dynamic odds via AMM | Users expect prices to shift with volume; static odds feel fake | HIGH | CPMM (Constant Product Market Maker) is the right choice — simpler than LMSR, well-understood, used by Manifold and Polymarket; see AMM note below |
| Token balance display | Users need to know how many tokens they have before every bet | LOW | Persistent in header/nav; update in real-time after each bet |
| Admin market resolution | Markets must eventually resolve; winners need payouts | MEDIUM | Admin UI: select outcome, trigger payout distribution to winning bettors proportionally |
| Post-resolution payout to winners | Winning bettors get tokens after resolution; this closes the loop | MEDIUM | Proportional to share count; handle edge cases (no bettors, tie) |
| User profile / bet history | Users want to review past bets, see their record, track performance | LOW | List of markets bet on, outcome, profit/loss per market |
| Leaderboard | The social engagement hook — ranking by token balance drives competition | LOW | Sorted by current token balance or profit; show rank, username, balance |

**AMM note:** CPMM uses x*y=k (constant product), identical to Uniswap. For binary YES/NO markets it means holding YES tokens * NO tokens = constant. Price of YES = NO_pool / (YES_pool + NO_pool). This is simpler to implement than LMSR and has no unbounded loss risk. Manifold uses CPMM. Confidence: HIGH (verified against Gnosis conditional tokens documentation and Manifold docs).

---

### Differentiators (Competitive Advantage)

Features not expected by default, but that create engagement, retention, and the fun factor — especially for a tight social community.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Multiple-choice markets | Opens up questions like "Who wins the group chat fantasy league?" — binary can't capture this | MEDIUM | 3-6 options; AMM per-option gets complex; simplest approach: each option is a separate pool, total must sum to 100% |
| Periodic prize system (USD payouts to top leaderboard) | Real stakes without real money gambling; transforms token leaderboard from vanity to genuine competition | LOW-MEDIUM | Admin manually triggers per period (week/month); informal Venmo/cash payout; track which leaderboard snapshot triggered which prize |
| Market comments / discussion | Prediction markets are more fun when people argue about outcomes; commentary drives engagement | LOW | Simple threaded comments per market; no moderation system needed at this scale |
| Market creation by any user | Community-driven content; creator-led markets feel personal and relevant | MEDIUM | Users create markets about things they care about in their community — this is what makes it local and social |
| Bet slip confirmation / projected payout preview | Reduces bet anxiety; shows "if YES wins you get X tokens" before confirming | LOW | Pure frontend math using current pool state; high polish impact, low effort |
| Market expiry countdown | Visual urgency — "closes in 3 days" drives action | LOW | Simple date diff display; push notifications are bonus |
| Performance stats per user | "I'm 73% accurate" is a status symbol in prediction communities | MEDIUM | Requires tracking resolved bets, wins, losses, calibration score |
| Share market to external | Viral growth: share a market link via iMessage/WhatsApp to pull friends in | LOW | Standard URL share + OG meta tags for link previews |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but add disproportionate complexity or undermine the product's simplicity.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Automated market resolution (oracle/AI) | Seems like it removes admin toil | Ambiguous questions (the norm in community markets) cannot be auto-resolved reliably; disputes blow up trust; for 10-20 friends admin resolution in minutes takes 10 seconds | Admin resolves manually; the social contract of "the creator resolves their own market" works at this scale |
| Real money deposits / withdrawal system | Users may want to convert winnings | Instantly triggers gambling regulation in most jurisdictions; creates payment processing overhead; undermines the casual fun premise | Keep tokens virtual; prize system via Venmo/cash stays informal and below regulatory thresholds |
| Native iOS / Android apps | Better push notifications, home screen presence | Months of extra build time; App Store approval delays; for 10-20 initial users a PWA with add-to-homescreen is indistinguishable | Mobile-first PWA with installability; revisit at 500+ active users |
| Complex market types (numeric range, weighted multi-outcome) | "What if I want to bet what exact score the game ends at?" | LMSR/multi-pool AMM complexity is significant; hard to explain to casual users; binary and simple multiple-choice cover 90% of community use cases | Binary + simple multiple-choice only for v1 |
| Full moderation system | Keeps content clean | At 10-20 users, full moderation is over-engineered; admin can delete content directly; trust is maintained socially | Admin has direct delete capability; no formal report/review queue needed for v1 |
| User-to-user token transfers / gifting | Seems fun and social | Creates token farming/manipulation incentives; undermines leaderboard integrity; "send tokens to my alt account" problem | Tokens only flow through market mechanics — betting and winning |
| Order book / limit orders | Power users want precise entry prices | Requires order matching engine, far more complex than AMM; at small community scale there isn't enough liquidity to make limit orders useful | AMM handles all trades instantly; no counterparty needed |
| Automated email/push notification pipeline | Keep users informed | Significant infra (push service, email provider, notification logic); for v1 community already communicates via group chat | Add sharing links and rely on social layer; revisit push notifications at v1.x |
| Dark/light theme toggle | UX polish expectation | Nice-to-have, builds after the core loop works; mobile browsers handle system theme via prefers-color-scheme | System-default theme via CSS media query is free and good enough |

---

## Feature Dependencies

```
Phone/SMS Auth
    └──required by──> Account Creation
                          └──required by──> Token Grant on Signup
                                               └──required by──> Token Balance Display
                                               └──required by──> Place Bet

AMM (CPMM) Implementation
    └──required by──> Dynamic Odds Display
    └──required by──> Place Bet
    └──required by──> Bet Slip / Payout Preview

Market Creation
    └──required by──> Market Feed
    └──required by──> Market Detail Page
    └──required by──> Place Bet
    └──required by──> Admin Resolution

Place Bet
    └──required by──> Bet History (per user)
    └──required by──> Token Balance Updates
    └──required by──> Post-Resolution Payout

Admin Resolution
    └──required by──> Post-Resolution Payout
    └──required by──> Leaderboard (meaningful once markets resolve)

Leaderboard (by token balance)
    └──enhances──> Periodic Prize System

Multiple-Choice Markets
    └──extends──> Market Creation (requires additional market type logic)
    └──extends──> AMM (requires per-option pool management)

User Profile / Bet History
    └──enhances──> Performance Stats
    └──enhances──> Leaderboard

Market Comments
    └──requires──> Market Detail Page (needs a surface to exist on)
    └──independent of──> Betting mechanics (can be added any time)
```

### Dependency Notes

- **AMM before Betting:** The AMM math must be implemented and tested before any bet can be placed. This is the single most complex dependency in the system.
- **Auth before everything:** User identity gates token grants, betting, market creation — auth is Phase 1 blocker.
- **Resolution before Leaderboard is meaningful:** A leaderboard of starting balances is pointless; the leaderboard becomes interesting after several markets resolve and tokens redistribute.
- **Multiple-choice extends AMM complexity:** Don't tackle multiple-choice markets until binary AMM is proven; the per-option pool management adds meaningful complexity.
- **Comments are decoupled:** Can be added in any phase without touching betting or AMM logic.

---

## MVP Definition

### Launch With (v1)

Minimum to validate the core loop: "create a market, bet on it, see odds move, resolve it, win tokens."

- [ ] Phone/SMS auth and account creation
- [ ] Free token grant on signup (1000 tokens)
- [ ] Binary (Yes/No) market creation with question + resolution date
- [ ] Market feed showing all open markets
- [ ] Market detail page with current YES/NO odds and bet volumes
- [ ] Place bet with CPMM AMM (dynamic odds update on bet)
- [ ] Bet slip with projected payout preview before confirming
- [ ] Token balance display (persistent in UI)
- [ ] Admin resolution UI (select outcome, trigger payout)
- [ ] Post-resolution payout distribution to winning bettors
- [ ] Leaderboard by current token balance

### Add After Validation (v1.x)

Add these once the core loop is working and users are engaged.

- [ ] Multiple-choice markets — add when users hit binary limitations in their questions
- [ ] Market comments/discussion thread — add when leaderboard competition creates debates worth having
- [ ] User profile page with bet history and win/loss record — add when users ask "how am I doing?"
- [ ] Periodic prize system UI — add when first prize payout is imminent (admin can manually handle the first one without formal UI)
- [ ] Share market link with OG preview — add to drive viral growth in the community

### Future Consideration (v2+)

Defer until product-market fit with the initial community.

- [ ] Performance stats / calibration score — deferred because it requires multiple resolved markets to be meaningful
- [ ] Push notifications / SMS reminders for closing markets — deferred because v1 community uses group chat
- [ ] PWA installability / add-to-homescreen optimization — worth refining once users want it on home screen
- [ ] Market categories / filtering / search — deferred until there are enough markets to need organization (>50)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Phone/SMS auth | HIGH | LOW | P1 |
| Free token grant | HIGH | LOW | P1 |
| Binary market creation | HIGH | MEDIUM | P1 |
| Market feed | HIGH | LOW | P1 |
| Market detail + odds | HIGH | LOW | P1 |
| CPMM AMM betting | HIGH | HIGH | P1 |
| Token balance display | HIGH | LOW | P1 |
| Admin resolution + payout | HIGH | MEDIUM | P1 |
| Leaderboard | HIGH | LOW | P1 |
| Bet slip / payout preview | MEDIUM | LOW | P1 (low cost, high polish) |
| Multiple-choice markets | HIGH | MEDIUM | P2 |
| Market comments | MEDIUM | LOW | P2 |
| Bet history / user profile | MEDIUM | LOW | P2 |
| Prize system UI | MEDIUM | LOW | P2 |
| Share market link + OG tags | MEDIUM | LOW | P2 |
| Performance stats | MEDIUM | MEDIUM | P3 |
| Push notifications | LOW | MEDIUM | P3 |
| Market search / filter | LOW | LOW | P3 (defer until >50 markets) |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | Polymarket | Manifold Markets | Our Approach |
|---------|------------|------------------|--------------|
| Auth | Crypto wallet / email | Email + social | Phone/SMS only — lower friction for mobile-first community |
| Tokens | Real USDC | Play mana (free) | Free virtual tokens — same as Manifold, avoids regulation |
| Market types | Binary + multi-outcome | Binary, multiple choice, numeric, polls | Binary + multiple-choice — enough for community use cases |
| AMM mechanism | CPMM (moved from LMSR) | CPMM | CPMM — industry standard, simpler, well-documented |
| Market creation | Curated (admin creates most) | Any user | Any user — community-generated content is the product |
| Resolution | Oracle + admin | Creator resolves own market | Admin resolves all — single trusted authority for small group |
| Leaderboard | No (volume/profit tracking) | Yes (by mana balance) | Yes (by token balance) — core engagement mechanic |
| Prizes | No (real money trades) | No cash prizes | Yes (informal USD prizes) — the differentiator for this community |
| Social features | Minimal (shares, embeds) | Comments, follows, communities | Comments per market — enough for a tight community |
| Scale | Global, millions of users | Global, ~30K active | 10-20 users — no need for heavy infra or moderation |
| Mobile | Web + app | Web + app | Mobile-first PWA only — right for the audience |

---

## Sources

- [Manifold Markets FAQ / Docs](https://docs.manifold.markets/faq) — confirmed CPMM AMM, token system, market types, creator resolution model (MEDIUM confidence, official docs)
- [Polymarket Documentation](https://docs.polymarket.com/) — confirmed CPMM usage, market structure (MEDIUM confidence, official docs)
- [Gnosis Conditional Tokens — AMM docs](https://conditionaltokens-docs.dev.gnosisdev.com/conditionaltokens/docs/introduction3/) — CPMM vs LMSR comparison (HIGH confidence, official documentation)
- [Paradigm: pm-AMM](https://www.paradigm.xyz/2024/11/pm-amm) — current state of AMM research for prediction markets (MEDIUM confidence, authoritative research blog, Nov 2024)
- [Social Prediction Markets article — BettorEdge](https://www.bettoredge.com/post/social-prediction-markets-the-next-evolution-in-sports-betting) — social and community features (LOW confidence, single source)
- [9 Pitfalls — Vinfotech](https://blog.vinfotech.com/9-pitfalls-to-avoid-when-launching-a-prediction-market-platform) — liquidity, trust, and resolution pitfalls (LOW confidence, vendor blog)
- [Manifold Markets Review 2026 — CryptoNews](https://cryptonews.com/cryptocurrency/manifold-markets-review/) — features overview cross-check (LOW confidence, third-party review)
- [Prediction Market Wikipedia](https://en.wikipedia.org/wiki/Prediction_market) — baseline definitions and mechanism overview (MEDIUM confidence)
- [Top Prediction Market Apps 2026 — Vegas Insider](https://www.vegasinsider.com/prediction-markets/best-prediction-market-apps/) — UX and community feature patterns across platforms (LOW confidence, review aggregator)

---

*Feature research for: community prediction market with virtual tokens and AMM odds*
*Researched: 2026-02-19*
