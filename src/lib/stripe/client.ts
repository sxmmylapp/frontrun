'use client';

import { loadStripe } from '@stripe/stripe-js';

/**
 * Stripe client-side singleton.
 * Called at module level to avoid re-creating the Stripe object on every render.
 */
export const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);
