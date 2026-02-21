---
phase: 08-purchase-ui
plan: 01
status: complete
started: 2026-02-21
completed: 2026-02-21
duration: ~6 min
commits:
  - hash: ce96bb3
    message: "feat(08-01): buy page with tier selection, Express Checkout, and Payment Element fallback"
---

# 08-01 Summary: Purchase UI

## What Was Built

### Token Pack Selection (TierSelector)
- Three tier cards displaying $5/500 tokens, $10/1,100 tokens (+10% bonus), $20/2,400 tokens (+20% bonus)
- Visual selection state with green border and radio-style indicator
- Bonus badges on medium and large tiers
- Disabled state during checkout

### Express Checkout + Payment Element (CheckoutForm)
- Express Checkout Element renders Apple Pay / Google Pay buttons when wallet available
- `onReady` callback detects wallet availability
- Payment Element fallback for manual card entry when no wallet configured
- Deferred PaymentIntent creation (created on confirm, not page load)
- Flow: `elements.submit()` -> `POST /api/payments/create-intent` -> `stripe.confirmPayment()`
- Error display for all failure modes
- Processing state during payment

### Buy Page (BuyTokensClient + page.tsx)
- Server component page shell with Suspense boundary
- Client component manages tier selection state and checkout toggle
- Elements provider with dark theme matching app appearance
- Re-creates Elements on tier change (key prop)
- Success state with green checkmark, confirmation message, and link to feed
- Payment summary showing price and token count before checkout

## Files Created

| File | Purpose |
|------|---------|
| `src/components/payments/TierSelector.tsx` | Tier card selection UI |
| `src/components/payments/CheckoutForm.tsx` | Express Checkout + Payment Element + payment flow |
| `src/app/(app)/buy/BuyTokensClient.tsx` | Client component with Elements provider and state management |
| `src/app/(app)/buy/page.tsx` | Server component page shell |

## Requirements Addressed

- **PURC-01**: Three token pack cards with prices, amounts, and bonus callouts
- **PURC-02**: Express Checkout Element for Apple Pay / Google Pay
- **PURC-03**: Payment Element fallback for card entry
- **PURC-04**: Success confirmation + Realtime balance update via existing useUserBalance hook
