import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error(
    'Missing STRIPE_SECRET_KEY environment variable. ' +
    'Set it in .env.local for development or in your hosting provider for production.'
  );
}

/**
 * Stripe server SDK singleton.
 * Server-only — never import this from client components.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
