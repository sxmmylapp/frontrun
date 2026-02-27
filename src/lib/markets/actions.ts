'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';
import { notifyNewMarket } from '@/lib/notifications/sms';

const createMarketSchema = z.object({
  question: z.string().min(5, 'Question must be at least 5 characters'),
  resolutionCriteria: z.string().min(10, 'Resolution criteria must be at least 10 characters'),
  closesAt: z.string().datetime({ message: 'Invalid date' }),
  marketType: z.enum(['binary', 'multiple_choice']).default('binary'),
  outcomes: z.array(z.string().min(1)).min(2).max(10).optional(),
});

const placeBetSchema = z.object({
  marketId: z.string().uuid(),
  outcome: z.string().min(1),
  outcomeId: z.string().uuid().optional(),
  amount: z.number().positive('Amount must be positive'),
});

const cancelBetSchema = z.object({
  positionId: z.string().uuid(),
});

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

const INITIAL_LIQUIDITY = 5000; // Tokens to seed each market pool

/**
 * Create a new market (binary or multiple choice).
 * Seeds the CPMM pool with initial liquidity (house-funded, not from creator).
 */
export async function createMarket(input: {
  question: string;
  resolutionCriteria: string;
  closesAt: string;
  marketType?: 'binary' | 'multiple_choice';
  outcomes?: string[];
}): Promise<ActionResult<{ marketId: string }>> {
  const ts = new Date().toISOString();

  const parsed = createMarketSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { question, resolutionCriteria, closesAt, marketType, outcomes } = parsed.data;

  // Multiple choice must have outcomes
  if (marketType === 'multiple_choice') {
    if (!outcomes || outcomes.length < 2) {
      return { success: false, error: 'Multiple choice markets need at least 2 outcomes' };
    }
    if (outcomes.length > 10) {
      return { success: false, error: 'Maximum 10 outcomes allowed' };
    }
    // Check for duplicate outcome labels
    const unique = new Set(outcomes.map(o => o.trim().toLowerCase()));
    if (unique.size !== outcomes.length) {
      return { success: false, error: 'Outcome labels must be unique' };
    }
  }

  // Validate closes_at is in the future
  const now = new Date();
  if (new Date(closesAt) <= now) {
    return { success: false, error: 'Close date must be in the future' };
  }

  // Validate closes_at is within 3 months
  const maxDate = new Date(now);
  maxDate.setMonth(maxDate.getMonth() + 3);
  if (new Date(closesAt) > maxDate) {
    return { success: false, error: 'Close date cannot be more than 3 months from now' };
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
        market_type: marketType ?? 'binary',
      })
      .select('id')
      .single();

    if (marketError) {
      console.error(`[${ts}] createMarket ERROR: ${marketError.message}`);
      return { success: false, error: 'Failed to create market' };
    }

    if (marketType === 'multiple_choice' && outcomes) {
      // Insert market_outcomes
      const outcomeRows = outcomes.map((label, i) => ({
        market_id: market.id,
        label: label.trim(),
        sort_order: i,
      }));

      const { data: insertedOutcomes, error: outcomesError } = await admin
        .from('market_outcomes')
        .insert(outcomeRows)
        .select('id');

      if (outcomesError || !insertedOutcomes) {
        console.error(`[${ts}] createMarket outcomes ERROR: ${outcomesError?.message}`);
        await admin.from('markets').delete().eq('id', market.id);
        return { success: false, error: 'Failed to create market outcomes' };
      }

      // Seed outcome pools with equal liquidity
      const perOutcome = INITIAL_LIQUIDITY / outcomes.length;
      const poolRows = insertedOutcomes.map((o) => ({
        market_id: market.id,
        outcome_id: o.id,
        pool: perOutcome,
      }));

      const { error: poolError } = await admin
        .from('outcome_pools')
        .insert(poolRows);

      if (poolError) {
        console.error(`[${ts}] createMarket mc pool ERROR: ${poolError.message}`);
        await admin.from('markets').delete().eq('id', market.id);
        return { success: false, error: 'Failed to initialize outcome pools' };
      }
    } else {
      // Binary: seed CPMM pool with initial liquidity (equal YES/NO)
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
        await admin.from('markets').delete().eq('id', market.id);
        return { success: false, error: 'Failed to initialize market pool' };
      }
    }

    console.info(`[${ts}] createMarket INFO: ${marketType ?? 'binary'} market ${market.id} created by ${user.id}`);

    // Fire-and-forget SMS notification
    notifyNewMarket({ marketId: market.id, question }).catch(console.error);

    return { success: true, data: { marketId: market.id } };
  } catch (err) {
    console.error(`[${ts}] createMarket ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Place a bet on a market via the atomic RPC function.
 * Routes to place_bet (binary) or place_bet_mc (multiple choice).
 */
export async function placeBet(input: {
  marketId: string;
  outcome: string;
  outcomeId?: string;
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

    // Fetch market type + creator
    const { data: marketData, error: marketError } = await admin
      .from('markets')
      .select('creator_id, market_type, market_pools(yes_pool, no_pool)')
      .eq('id', input.marketId)
      .single();

    if (marketError || !marketData) {
      console.error(`[${ts}] placeBet ERROR: failed to fetch market - ${marketError?.message}`);
      return { success: false, error: 'Market not found' };
    }

    // Creator check (admins can bet on their own markets)
    if (marketData.creator_id === user.id) {
      const { data: profile } = await admin
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      if (!profile?.is_admin) {
        console.warn(`[${ts}] placeBet WARN: creator ${user.id} tried to bet on own market ${input.marketId}`);
        return { success: false, error: 'Cannot bet on a market you created' };
      }
    }

    const isMultiChoice = marketData.market_type === 'multiple_choice';

    // Max bet check
    if (isMultiChoice) {
      // For multi-choice: total pool = sum of outcome_pools
      const { data: outcomePools } = await admin
        .from('outcome_pools')
        .select('pool')
        .eq('market_id', input.marketId);

      const mcTotalPool = (outcomePools ?? []).reduce((sum, p) => sum + Number(p.pool), 0);
      const maxBet = mcTotalPool * 0.25;
      if (input.amount > maxBet) {
        return { success: false, error: `Bet too large — max is 25% of pool (${Math.floor(maxBet)} tokens)` };
      }

      // Per-user-per-market limit
      const { data: positions } = await admin
        .from('positions')
        .select('cost')
        .eq('user_id', user.id)
        .eq('market_id', input.marketId)
        .is('cancelled_at', null);

      const userTotalCost = (positions ?? []).reduce((sum, p) => sum + Number(p.cost), 0);
      const maxUserTotal = mcTotalPool * 0.25;
      if (userTotalCost + input.amount > maxUserTotal) {
        const remaining = Math.max(0, maxUserTotal - userTotalCost);
        return { success: false, error: `Would exceed per-market limit — you can invest up to ${Math.floor(maxUserTotal)} tokens total (${Math.floor(remaining)} remaining)` };
      }

      // Must have outcomeId for multi-choice
      if (!input.outcomeId) {
        return { success: false, error: 'Outcome selection required' };
      }

      // Call multi-choice RPC
      const { data, error } = await admin.rpc('place_bet_mc', {
        p_user_id: user.id,
        p_market_id: input.marketId,
        p_outcome_id: input.outcomeId,
        p_amount: input.amount,
      });

      if (error) {
        console.error(`[${ts}] placeBet mc ERROR: ${error.message}`);
        return { success: false, error: 'Failed to place bet' };
      }

      const result = data as Record<string, unknown>;
      if (result.error) {
        console.warn(`[${ts}] placeBet mc WARN: ${result.error}`);
        return { success: false, error: result.error as string };
      }

      console.info(`[${ts}] placeBet INFO: user ${user.id} bet ${input.amount} on ${result.outcome_label} in mc market ${input.marketId}`);
      return {
        success: true,
        data: {
          positionId: result.position_id as string,
          shares: result.shares as number,
        },
      };
    } else {
      // Binary path — unchanged
      const pool = Array.isArray(marketData.market_pools)
        ? marketData.market_pools[0]
        : marketData.market_pools;
      if (pool) {
        const totalPool = Number(pool.yes_pool) + Number(pool.no_pool);
        const maxBet = totalPool * 0.25;
        if (input.amount > maxBet) {
          console.warn(`[${ts}] placeBet WARN: user ${user.id} bet ${input.amount} exceeds max ${Math.floor(maxBet)} in market ${input.marketId}`);
          return { success: false, error: `Bet too large — max is 25% of pool (${Math.floor(maxBet)} tokens)` };
        }

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
          console.warn(`[${ts}] placeBet WARN: user ${user.id} total ${userTotalCost + input.amount} exceeds per-market limit ${Math.floor(maxUserTotal)}`);
          return { success: false, error: `Would exceed per-market limit — you can invest up to ${Math.floor(maxUserTotal)} tokens total (${Math.floor(remaining)} remaining)` };
        }
      }

      // Validate binary outcome
      if (input.outcome !== 'yes' && input.outcome !== 'no') {
        return { success: false, error: 'Invalid outcome — must be yes or no' };
      }

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
    }
  } catch (err) {
    console.error(`[${ts}] placeBet ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Cancel a bet — sell shares back into the AMM pool at current market prices.
 * Routes to cancel_bet (binary) or cancel_bet_mc (multiple choice) based on position.
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

    // Check if this is a multi-choice position (has outcome_id)
    const { data: position } = await admin
      .from('positions')
      .select('outcome_id')
      .eq('id', input.positionId)
      .single();

    const isMultiChoice = position?.outcome_id != null;

    if (isMultiChoice) {
      const { data, error } = await admin.rpc('cancel_bet_mc', {
        p_user_id: user.id,
        p_position_id: input.positionId,
      });

      if (error) {
        console.error(`[${ts}] cancelBet mc ERROR: ${error.message}`);
        return { success: false, error: 'Failed to cancel bet' };
      }

      const result = data as Record<string, unknown>;
      if (result.error) {
        console.warn(`[${ts}] cancelBet mc WARN: ${result.error}`);
        return { success: false, error: result.error as string };
      }

      console.info(`[${ts}] cancelBet INFO: user ${user.id} cancelled mc position ${input.positionId}, returned ${result.tokens_returned} tokens`);
      return {
        success: true,
        data: {
          tokensReturned: result.tokens_returned as number,
          originalCost: result.original_cost as number,
        },
      };
    } else {
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
    }
  } catch (err) {
    console.error(`[${ts}] cancelBet ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
