'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

const createMarketSchema = z.object({
  question: z.string().min(5, 'Question must be at least 5 characters'),
  resolutionCriteria: z.string().min(10, 'Resolution criteria must be at least 10 characters'),
  closesAt: z.string().datetime({ message: 'Invalid date' }),
});

const placeBetSchema = z.object({
  marketId: z.string().uuid(),
  outcome: z.enum(['yes', 'no']),
  amount: z.number().positive('Amount must be positive'),
});

const cancelBetSchema = z.object({
  positionId: z.string().uuid(),
});

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

const INITIAL_LIQUIDITY = 1000; // Tokens to seed each market pool

/**
 * Create a new binary market.
 * Seeds the CPMM pool with initial liquidity (house-funded, not from creator).
 */
export async function createMarket(input: {
  question: string;
  resolutionCriteria: string;
  closesAt: string;
}): Promise<ActionResult<{ marketId: string }>> {
  const ts = new Date().toISOString();

  const parsed = createMarketSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { question, resolutionCriteria, closesAt } = parsed.data;

  // Validate closes_at is in the future
  if (new Date(closesAt) <= new Date()) {
    return { success: false, error: 'Close date must be in the future' };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check for duplicate open market with same question
    const admin = createAdminClient();
    const normalized = question.trim().toLowerCase();
    const { data: existing } = await admin
      .from('markets')
      .select('id')
      .eq('status', 'open')
      .ilike('question', normalized)
      .limit(1);

    if (existing && existing.length > 0) {
      return { success: false, error: 'A market with this question already exists' };
    }

    // Insert market
    const { data: market, error: marketError } = await supabase
      .from('markets')
      .insert({
        creator_id: user.id,
        question,
        resolution_criteria: resolutionCriteria,
        closes_at: closesAt,
      })
      .select('id')
      .single();

    if (marketError) {
      console.error(`[${ts}] createMarket ERROR: ${marketError.message}`);
      return { success: false, error: 'Failed to create market' };
    }

    // Seed CPMM pool with initial liquidity (equal YES/NO)
    const half = INITIAL_LIQUIDITY / 2;
    const { error: poolError } = await admin
      .from('market_pools')
      .insert({
        market_id: market.id,
        yes_pool: half,
        no_pool: half,
      });

    if (poolError) {
      console.error(`[${ts}] createMarket pool ERROR: ${poolError.message}`);
      // Clean up the market if pool creation fails
      await admin.from('markets').delete().eq('id', market.id);
      return { success: false, error: 'Failed to initialize market pool' };
    }

    console.info(`[${ts}] createMarket INFO: market ${market.id} created by ${user.id}`);
    return { success: true, data: { marketId: market.id } };
  } catch (err) {
    console.error(`[${ts}] createMarket ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Place a bet on a market via the atomic RPC function.
 */
export async function placeBet(input: {
  marketId: string;
  outcome: 'yes' | 'no';
  amount: number;
}): Promise<ActionResult<{ positionId: string; shares: number }>> {
  const ts = new Date().toISOString();

  const parsed = placeBetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const admin = createAdminClient();

    // Early validation: fetch market + pool for creator check and max bet
    const { data: marketData, error: marketError } = await admin
      .from('markets')
      .select('creator_id, market_pools(yes_pool, no_pool)')
      .eq('id', input.marketId)
      .single();

    if (marketError || !marketData) {
      console.error(`[${ts}] placeBet ERROR: failed to fetch market - ${marketError?.message}`);
      return { success: false, error: 'Market not found' };
    }

    // Creator check
    if (marketData.creator_id === user.id) {
      console.warn(`[${ts}] placeBet WARN: creator ${user.id} tried to bet on own market ${input.marketId}`);
      return { success: false, error: 'Cannot bet on a market you created' };
    }

    // Max bet check (25% of pool) and per-user-per-market total limit (25% of pool)
    const pool = Array.isArray(marketData.market_pools)
      ? marketData.market_pools[0]
      : marketData.market_pools;
    if (pool) {
      const totalPool = Number(pool.yes_pool) + Number(pool.no_pool);
      const maxBet = totalPool * 0.25;
      if (input.amount > maxBet) {
        console.warn(`[${ts}] placeBet WARN: user ${user.id} bet ${input.amount} exceeds max ${maxBet.toFixed(2)} in market ${input.marketId}`);
        return { success: false, error: `Bet too large — max is 25% of pool (${maxBet.toFixed(2)} tokens)` };
      }

      // Check total user investment on this market
      const { data: positions } = await admin
        .from('positions')
        .select('cost')
        .eq('user_id', user.id)
        .eq('market_id', input.marketId)
        .is('cancelled_at', null);

      const userTotalCost = (positions ?? []).reduce((sum, p) => sum + Number(p.cost), 0);
      const maxUserTotal = totalPool * 0.25;
      if (userTotalCost + input.amount > maxUserTotal) {
        const remaining = Math.max(0, maxUserTotal - userTotalCost);
        console.warn(`[${ts}] placeBet WARN: user ${user.id} total ${userTotalCost + input.amount} exceeds per-market limit ${maxUserTotal.toFixed(2)}`);
        return { success: false, error: `Would exceed per-market limit — you can invest up to ${maxUserTotal.toFixed(2)} tokens total (${remaining.toFixed(2)} remaining)` };
      }
    }

    // Call the atomic place_bet RPC
    const { data, error } = await admin.rpc('place_bet', {
      p_user_id: user.id,
      p_market_id: input.marketId,
      p_outcome: input.outcome,
      p_amount: input.amount,
    });

    if (error) {
      console.error(`[${ts}] placeBet ERROR: ${error.message}`);
      return { success: false, error: 'Failed to place bet' };
    }

    const result = data as Record<string, unknown>;
    if (result.error) {
      console.warn(`[${ts}] placeBet WARN: ${result.error}`);
      return { success: false, error: result.error as string };
    }

    console.info(`[${ts}] placeBet INFO: user ${user.id} bet ${input.amount} on ${input.outcome} in market ${input.marketId}`);
    return {
      success: true,
      data: {
        positionId: result.position_id as string,
        shares: result.shares as number,
      },
    };
  } catch (err) {
    console.error(`[${ts}] placeBet ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Cancel a bet — sell shares back into the AMM pool at current market prices.
 * Calls the atomic cancel_bet RPC.
 */
export async function cancelBet(input: {
  positionId: string;
}): Promise<ActionResult<{ tokensReturned: number; originalCost: number }>> {
  const ts = new Date().toISOString();

  const parsed = cancelBetSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('cancel_bet', {
      p_user_id: user.id,
      p_position_id: input.positionId,
    });

    if (error) {
      console.error(`[${ts}] cancelBet ERROR: ${error.message}`);
      return { success: false, error: 'Failed to cancel bet' };
    }

    const result = data as Record<string, unknown>;
    if (result.error) {
      console.warn(`[${ts}] cancelBet WARN: ${result.error}`);
      return { success: false, error: result.error as string };
    }

    console.info(`[${ts}] cancelBet INFO: user ${user.id} cancelled position ${input.positionId}, returned ${result.tokens_returned} tokens`);
    return {
      success: true,
      data: {
        tokensReturned: result.tokens_returned as number,
        originalCost: result.original_cost as number,
      },
    };
  } catch (err) {
    console.error(`[${ts}] cancelBet ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
