import { z } from 'zod/v4';

/**
 * Server-authoritative token pack tier constants.
 * The client NEVER sends dollar amounts — only a tier key.
 * The server looks up the price from this map.
 */
export const TIERS = {
  small: {
    price_cents: 500,
    tokens: 500,
    label: '$5 — 500 Tokens',
  },
  medium: {
    price_cents: 1000,
    tokens: 1100,
    label: '$10 — 1,100 Tokens',
    bonus: '10% bonus',
  },
  large: {
    price_cents: 2000,
    tokens: 2400,
    label: '$20 — 2,400 Tokens',
    bonus: '20% bonus',
  },
} as const;

export type TierKey = keyof typeof TIERS;

/** Zod enum for tier validation in server actions and API routes */
export const tierSchema = z.enum(['small', 'medium', 'large']);
