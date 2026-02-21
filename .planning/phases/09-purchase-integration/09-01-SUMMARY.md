---
phase: 09-purchase-integration
plan: 01
status: complete
started: 2026-02-21
completed: 2026-02-21
duration: ~5 min
commits:
  - hash: dc8b133
    message: "feat(09-01): purchase history on profile and buy CTA in BetSlip"
---

# 09-01 Summary: Purchase Integration

## What Was Built

### Purchase History on Profile
- Added "Purchase History" section above bet history on the profile page
- Queries `token_purchases` table for completed purchases, ordered by date descending
- Each row shows: tier label (from TIERS constant), date, tokens credited, and USD amount
- Empty state with "Buy your first token pack" link to /buy
- Header includes "Buy tokens" link to /buy

### BetSlip Insufficient-Balance CTA
- When user enters a bet amount exceeding their balance, a "Buy more tokens" banner appears
- Shows how many more tokens are needed
- Links directly to /buy page
- Styled with green accent to match the purchase theme

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src/app/(app)/profile/page.tsx` | Updated | Added purchase history section, reorganized layout |
| `src/components/markets/BetSlip.tsx` | Updated | Added insufficient-balance buy CTA |

## Requirements Addressed

- **PURC-05**: Purchase history on profile showing date, USD amount, and tokens received
- **PURC-06**: "Buy more tokens" CTA in BetSlip when balance is insufficient
