# Pitfalls Research

**Domain:** Community prediction market — virtual tokens, AMM odds, leaderboard prizes
**Researched:** 2026-02-19
**Confidence:** HIGH (critical pitfalls), MEDIUM (performance/UX pitfalls)

---

## Critical Pitfalls

### Pitfall 1: Wrong LMSR `b` Parameter — Market Prices Never Reflect Reality

**What goes wrong:**
You pick an LMSR `b` value that is too large for your user base. With 10-20 users holding a fixed token supply, no one has enough capital to move prices toward their true probabilities. Markets read 50/50 forever, regardless of how obvious the likely outcome is. Users stop trusting the odds and stop betting.

Conversely, a `b` that is too small means a single large bet by one user swings prices 40% in one trade, creating wild instability and discouraging other participants.

**Why it happens:**
Developers copy `b` values from tutorials or large-platform examples, without accounting for their expected trading volume. LMSR's `b` is described even in academic literature as a "black art" that is context-dependent. Small community apps have drastically less liquidity than the examples those defaults were designed for.

**How to avoid:**
- Size `b` to your total token supply. A common starting formula: `b = total_tokens_in_circulation / (N * 10)` where N is the number of outcomes. Adjust after testing.
- Run a simulation with your expected token supply (e.g., 20 users × 1000 tokens each = 20,000 tokens) before launch.
- Aim for a single 100-token bet moving odds by roughly 2-5 percentage points — test this by hand before deploying.
- Document the `b` value as a tunable constant with a clear comment explaining the tradeoff.

**Warning signs:**
- All markets hover near 50/50 regardless of topic
- A single trade moves odds by more than 15 percentage points
- Users comment that the odds "don't feel right"

**Phase to address:** AMM core implementation phase (first phase that implements betting)

---

### Pitfall 2: LMSR Cost Function Rounding Errors Corrupt Token Balances

**What goes wrong:**
LMSR requires computing `b * ln(sum of e^(q_i/b))` for all outcomes. Implemented naively in JavaScript with floating-point arithmetic, cumulative rounding errors over many trades cause the system's internal accounting to drift. Users end up with fractional tokens that don't sum correctly, or a bet costs slightly different than the UI previewed. Over time, token totals become inconsistent and admin resolution payouts are wrong.

**Why it happens:**
Floating-point arithmetic is non-deterministic at the sub-cent level across platforms. Developers test with small examples and don't notice drift until hundreds of trades have accumulated. The LMSR formula involves exponentials which amplify small errors.

**How to avoid:**
- Store all token quantities as integers (millitokens — multiply by 1000). Never store fractional tokens.
- Implement the cost function using a numerically stable log-sum-exp trick to avoid overflow.
- After every trade, assert that `sum(all outcome shares) == total_collateral_deposited`. Fail loudly if this invariant breaks.
- Write a test that runs 1000 sequential trades and verifies balance integrity after each one.

**Warning signs:**
- Token totals differ by small amounts after resolution
- Bet preview shows 47 tokens cost but deduction is 47.002
- Running sum checks in tests start failing intermittently

**Phase to address:** AMM core implementation phase — build the invariant check into the initial implementation, not as a follow-up

---

### Pitfall 3: Race Conditions on Simultaneous Bets — Negative Balances and Double-Spends

**What goes wrong:**
Two users place bets at the same time. Both requests read the same market state, compute their cost, deduct from their balances, and write back. One deduction overwrites the other. Result: the market's outcome share counts are wrong, one user's tokens vanish, or a user ends up with a negative balance.

At small scale (10-20 users) this seems unlikely but becomes near-certain during any exciting market — the exact moments when multiple people bet simultaneously.

**Why it happens:**
Developers treat bet placement as two sequential operations (read state, write state) without wrapping them in a transaction or using row-level locking. ORMs make it easy to do `user.balance -= cost; user.save()` without realizing this is not atomic.

**How to avoid:**
- Every bet must be a single database transaction that: (1) SELECT FOR UPDATE locks the user row and market row, (2) validates the user has sufficient balance, (3) updates the outcome share quantities, (4) recomputes and stores new odds, (5) deducts from user balance, (6) inserts the bet record — all in one commit.
- Never compute the LMSR cost outside the transaction and then apply it inside; compute inside.
- Add a unique constraint on (user_id, market_id, timestamp_ms) to catch any duplicate submissions.

**Warning signs:**
- Any user balance ever goes below zero
- Market outcome shares don't sum to what you expect
- Duplicate bet records for the same user within the same millisecond

**Phase to address:** AMM core implementation phase — this must be correct from day one; retrofitting transactions later is a nightmare

---

### Pitfall 4: Ambiguous Market Resolution Criteria — Admin Bias and User Fury

**What goes wrong:**
A market asks "Will the team win the championship?" The admin resolves it YES. A user argues they only made finals, not the championship. The admin resolves subjectively and half the community loses tokens on what they believe was a bad call. Trust collapses. On a small community platform, this is existential — the entire user base is 20 people and they all know each other.

**Why it happens:**
Market creation forms don't enforce specific resolution criteria. Users write vague questions without resolution rules. The admin resolves based on their interpretation when no authoritative rule was written. This is the #1 documented cause of prediction market disputes, from Polymarket's $200M Zelensky suit market to UMA oracle manipulation.

**How to avoid:**
- Market creation form must have a required "Resolution criteria" field separate from the question text. Example: "YES if the official league standings on [source URL] show [Team] in 1st place by [date]."
- Admin resolution UI should show the original resolution criteria prominently before confirming.
- Create a small set of resolution rule templates (sports outcome, price threshold, yes/no event happened) and let creators pick a template.
- For v1, admin should only resolve after posting the source of truth in a visible way (e.g., a comment or link on the market).

**Warning signs:**
- Market descriptions say things like "if it goes well" or "roughly"
- Users posting complaints in Discord/chat after resolution
- Same admin resolving markets they have large positions in

**Phase to address:** Market creation phase AND admin resolution phase — enforce at both entry and resolution time

---

### Pitfall 5: Leaderboard Gaming — Multi-Account and Wash Betting

**What goes wrong:**
When a real USD prize is attached to the leaderboard, even friends will game it. A user creates a second account (or convinces a friend to act as a dummy), bets heavily on both sides of the same market, guarantees a winning side takes the tokens, and inflates their leaderboard position with zero forecasting skill. On Polymarket, wash trading peaked near 60% of volume when incentives were attached.

**Why it happens:**
Virtual tokens feel low-stakes until a real prize appears. The combination of (a) free token grants on signup, (b) an AMM that always takes the bet, and (c) a cash prize creates a mechanical exploit: create accounts, bet against yourself, farm tokens to the winning account.

**How to avoid:**
- Require phone number verification and enforce one-account-per-phone-number at the database level (unique index on `phone_number`). Block VoIP numbers via Twilio Lookup API.
- Log all bets with IP address, user agent, and device fingerprint. Flag when two accounts share the same device/IP and bet on opposite sides of the same market.
- For the prize period, require accounts to be at least X days old (e.g., 7 days) and have placed bets on at least Y distinct markets.
- Consider a "net profit skill score" instead of raw token balance — this penalizes the practice of farming both sides.

**Warning signs:**
- Two accounts with similar names register near-simultaneously from the same IP
- A user's win rate is near 100% (impossible without wash trading or insider knowledge)
- Token velocity spikes on low-interest markets just before a leaderboard cutoff

**Phase to address:** Auth + leaderboard phase — build the phone uniqueness constraint before any prize is announced

---

## Moderate Pitfalls

### Pitfall 6: Token Inflation Makes Early Adopters Permanently Dominant

**What goes wrong:**
Early users accumulate tokens through lucky early markets. Later users join with the same starting balance but face opponents with 10x their tokens. The leaderboard becomes fixed within the first week, disengaging new users. Worse, users who "go broke" (near-zero balance) have no recovery path and churn.

**How to avoid:**
- Design periodic leaderboard resets (e.g., monthly competitions with a fresh starting balance). This is the most important structural decision for long-term engagement.
- Give users a "daily bonus" or "weekly top-up" of a small token amount so zero-balance users can re-engage.
- Track a "score" metric separately from raw token balance — e.g., profit percentage since last reset — rather than absolute token count.

**Warning signs:**
- Top-5 leaderboard positions unchanged for more than 2 weeks
- New user churn spikes after they check the leaderboard for the first time
- Users stop betting because they "don't want to lose their stack"

**Phase to address:** Token economy and leaderboard design phase

---

### Pitfall 7: Missing "What Happens to My Bet" Feedback Loop

**What goes wrong:**
A user bets on a market. The market closes for new bets. Then nothing happens for days or weeks until the admin resolves it. The user forgot they had a pending bet. When tokens appear in their account, they don't know why. Users disengage because the prediction loop — bet, wait, outcome, reward — has no feedback.

**Why it happens:**
Developers build the betting UI but skip the notification and market lifecycle state machines. Markets exist in a limbo "closed but unresolved" state that is invisible to users.

**How to avoid:**
- Implement explicit market states: `open`, `closed` (no new bets), `resolved`. Users can see their pending bets on all open/closed markets.
- Push notifications (or SMS) when: (1) a market you bet on closes, (2) a market you bet on resolves, (3) your tokens are paid out.
- "My Bets" dashboard showing pending positions, expected payout at current odds, and resolved history.

**Warning signs:**
- Users asking "did my bet go through?" in chat
- Zero return visits between market creation and resolution
- No push notification infrastructure exists in the codebase

**Phase to address:** Bet placement phase (notifications) and market lifecycle phase

---

### Pitfall 8: Market Feed with No Markets, or Too Many Unresolved Markets

**What goes wrong:**
At launch, nobody has created markets yet — new users see an empty feed and leave immediately. Alternatively, after a month of use, the feed is clogged with 40 old unresolved markets and 3 new ones. Users can't find what's relevant.

**How to avoid:**
- Pre-seed the platform with 5-10 admin-created markets before inviting the first users.
- Default feed sort: active (has recent bets), then closing soon, then new. Not chronological.
- Surface "unresolved" markets in a separate section so they don't crowd out active ones.
- Admin gets a dashboard showing: markets past their resolution date, markets with no bets, markets expiring in 24 hours.

**Warning signs:**
- The feed is sorted by creation date ascending (common ORM default)
- Markets from 3 weeks ago appear above markets ending today
- Zero bets on any market older than 7 days

**Phase to address:** Market feed / discovery phase

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store odds as computed floats in DB, not recomputed from source shares | Faster reads | Odds drift out of sync with actual share quantities; hard to audit | Never — always recompute from shares |
| Skip transaction isolation on bet writes | Simpler code | Race conditions corrupt balances at any meaningful traffic | Never |
| Use raw token balance as leaderboard metric | Easiest query | Incentivizes hoarding over participation, broken when tokens are reset | Only for a no-prize prototype |
| Single admin account for resolution with no audit log | Simple to build | No accountability, disputes have no evidence trail | Never if prizes are involved |
| Vague resolution criteria allowed in market creation | Less friction | Every resolution becomes a fight | Never — enforce specific criteria at creation |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Twilio Verify | Not blocking VoIP numbers — allows disposable phone numbers for multi-account | Enable Twilio Lookup with `line_type_intelligence`; reject `voip` and `prepaid` line types |
| Twilio Verify | Not rate-limiting verification requests — SMS pumping fraud charges you per send | Rate-limit to 1 request per phone per 30 seconds; enable Twilio Fraud Guard |
| Supabase Realtime | Broadcasting every individual DB write to all connected clients — causes UI thrash on active markets | Debounce odds updates; only push when odds change by > 1% or on trade confirmation |
| Push notifications (web) | Prompting for notification permission on first page load — 93% denial rate | Ask only after the user places their first bet with a contextual prompt ("Get notified when this resolves?") |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Recomputing all LMSR odds on every page load instead of caching | Slow market feed; DB CPU spikes on refresh | Cache current odds per market in a dedicated column, invalidate on each bet | 10+ concurrent users refreshing the feed |
| Querying all bets for a market to compute payouts at resolution | Resolution takes 10+ seconds, times out | Maintain running totals (outcome share quantities) updated per bet, never recompute from raw bet history | 500+ bets on a single market |
| Loading full bet history for "my bets" without pagination | Page load slow, mobile users timeout | Paginate to last 20 bets; infinite scroll for history | 50+ bets per user |
| N+1 query on market feed (one query per market for bet count/latest odds) | Feed takes 3+ seconds | Single JOIN query with aggregated stats | 20+ markets in feed |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing admin resolution endpoint without role check | Any user can resolve any market and steal tokens | Middleware role check on every admin route; RLS policy in Supabase for admin-only tables |
| Trusting client-reported bet amount | User sends `amount: 999999` and bypasses balance check | Always validate and deduct balance server-side; never trust client-provided cost |
| No rate limit on bet placement endpoint | Bot floods the market, manipulates odds programmatically | Rate limit to 1 bet per user per 3 seconds per market |
| Displaying other users' phone numbers in leaderboard | Privacy violation — exposes personal data | Leaderboard shows display name only; phone number never leaves server after auth |
| Admin can resolve markets they hold positions in | Conflict of interest; admin self-enrichment | Log admin's own positions at resolution time; surface warning in admin UI |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing raw LMSR math ("cost: 47.23 tokens based on log-sum-exp") | Users confused, distrust the system | Show "Bet 50 tokens → win up to 120 tokens if YES" — outcome-framed, not formula-framed |
| "Yes/No" binary with no probability display | Users don't know if 50 tokens wins them 51 or 500 | Always show implied probability (e.g., "YES: 67% — currently favored") alongside bet controls |
| Resolution with no explanation | Users furious, feel cheated | Admin resolution UI requires a "resolution note" field; this note is displayed on the resolved market |
| Bet confirmation with no undo path | Accidental bets on mobile frustrate users | "Confirm bet" modal on mobile; 10-second cancel window before bet is finalized |
| No way to see your P&L across all markets | Users can't tell if they're good or lucky | "My Performance" tab: total wagered, total returned, net profit/loss, win rate by category |

---

## "Looks Done But Isn't" Checklist

- [ ] **Bet deduction:** Token deduction happens in the same DB transaction as share quantity update — verify with a failing concurrent test
- [ ] **Market resolution payout:** All winning bettors receive tokens proportional to their share quantity, not their original bet amount — check with an unequal bet test
- [ ] **AMM odds at initialization:** Market starts at exactly 50/50 (or specified prior) — verify LMSR cost at q=0 for all outcomes
- [ ] **Leaderboard prize eligibility:** Account age and minimum bet count enforced server-side — not just displayed in UI
- [ ] **Phone uniqueness:** Unique constraint exists at DB level on phone number — not just application-level validation
- [ ] **Admin resolution audit log:** Every resolution records who resolved it, when, and the source they cited
- [ ] **Closed market state:** Markets past their resolution date accept no new bets — enforce in bet placement handler, not just UI
- [ ] **Zero-balance recovery:** Users with 0 tokens still see the market feed and get the weekly top-up — not locked out of the app

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Balance corruption from race conditions | HIGH | Audit all bet records, recompute expected balances from bet history, correct deltas manually, add transaction locks retroactively |
| Wrong LMSR b parameter (markets won't move) | MEDIUM | Update b constant, reset all active market share quantities to initial state (users lose in-flight positions), announce reset with explanation |
| Multi-account gaming discovered after leaderboard period | MEDIUM | Invalidate the prize winner selection, retroactively flag suspicious accounts, rerun leaderboard excluding flagged users |
| Ambiguous market resolved wrongly | LOW-MEDIUM | Admin overrides resolution, issues corrected payouts, writes a public resolution note explaining the correction |
| Token inflation — one user holds 80% of all tokens | MEDIUM | Announce a seasonal reset with a fixed starting balance for all users for the next period |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Wrong LMSR b parameter | AMM implementation | Simulate 100 trades at expected token supply; verify odds move 2-5% per 100-token bet |
| LMSR floating-point drift | AMM implementation | Run 1000-trade integrity test; assert shares sum to collateral within 0.001% |
| Race conditions on bets | AMM implementation | Concurrent test: 50 simultaneous bets, verify zero balance goes negative |
| Ambiguous resolution criteria | Market creation + admin resolution | Creation form validation rejects markets without resolution criteria field |
| Leaderboard multi-account gaming | Auth + leaderboard | Unique DB constraint on phone; VoIP rejection confirmed via Twilio test number |
| Token inflation / rich-get-richer | Token economy + leaderboard design | Leaderboard resets at defined period; top-up mechanism implemented and tested |
| No bet feedback loop | Bet + notification phase | User receives SMS/push on market resolve; "My Bets" shows pending positions |
| Empty market feed at launch | Pre-launch setup | 5+ admin markets seeded before first user invite |

---

## Sources

- [pm-AMM: A Uniform AMM for Prediction Markets — Paradigm](https://www.paradigm.xyz/2024/11/pm-amm) — CPMM vs LMSR tradeoffs, LP loss mechanics
- [LMSR Logarithmic Market Scoring Rule — Gensyn](https://blog.gensyn.ai/lmsr-logarithmic-market-scoring-rule/) — b parameter mechanics
- [LMSR Primer — Gnosis](https://gnosis-pm-js.readthedocs.io/en/v1.3.0/lmsr-primer.html) — initialization and b relationship to funding
- [How Does LMSR Work — Cultivate Labs](https://www.cultivatelabs.com/crowdsourced-forecasting-guide/how-does-logarithmic-market-scoring-rule-lmsr-work) — b parameter tuning pitfalls
- [Manifold Markets Isn't Very Good — EA Forum](https://forum.effectivealtruism.org/posts/EaR9xFxspmYRkm3eo/manifold-markets-isn-t-very-good) — incentive misalignment, puppet accounts, yes bias
- [What Is a Prediction Market Dispute — UMA](https://blog.uma.xyz/articles/what-is-a-prediction-market-dispute) — resolution dispute mechanics
- [How Prediction Markets Really Settle — OMS](https://www.omsltd.net/how-prediction-markets-really-settle-a-trader-s-guide-to-event-resolution-and-outcomes/) — resolution criteria specificity best practices
- [Preventing Fraud in Verify — Twilio](https://www.twilio.com/docs/verify/preventing-toll-fraud) — VoIP blocking, rate limiting
- [SMS Pumping Fraud — Twilio](https://www.twilio.com/docs/glossary/what-is-sms-pumping-fraud) — phone auth fraud patterns
- [Prediction Markets Grew 4X, Risk Structural Strain — Decrypt](https://decrypt.co/357583/prediction-markets-grew-4x-to-63-5b-in-2025-but-risk-structural-strain-certik) — wash trading volume statistics
- [Everyone's Cheating on Prediction Markets — InGame](https://www.ingame.com/everyone-cheating-prediction-markets/) — incentive-driven cheating patterns
- [Building a Polymarket-Style Prediction Engine — RisingWave](https://risingwave.com/blog/real-time-prediction-market-risingwave/) — database architecture and settlement fan-out problem

---

*Pitfalls research for: community prediction market (virtual tokens, AMM, leaderboard prizes)*
*Researched: 2026-02-19*
