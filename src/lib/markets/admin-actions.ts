'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';
import { notifyMarketResolved } from '@/lib/notifications/sms';

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

const resolveSchema = z.object({
  marketId: z.string().uuid(),
  outcome: z.enum(['yes', 'no']),
});

const resolveMcSchema = z.object({
  marketId: z.string().uuid(),
  outcomeId: z.string().uuid(),
});

const cancelSchema = z.object({
  marketId: z.string().uuid(),
});

/**
 * Resolve a binary market — admin only.
 * Calls the atomic resolve_market RPC which pays out all winning bettors.
 */
export async function resolveMarket(input: {
  marketId: string;
  outcome: 'yes' | 'no';
}): Promise<ActionResult<{ winnersPaid: number }>> {
  const ts = new Date().toISOString();

  const parsed = resolveSchema.safeParse(input);
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
    const { data, error } = await admin.rpc('resolve_market', {
      p_admin_id: user.id,
      p_market_id: input.marketId,
      p_outcome: input.outcome,
    });

    if (error) {
      console.error(`[${ts}] resolveMarket ERROR: ${error.message}`);
      return { success: false, error: 'Failed to resolve market' };
    }

    const result = data as Record<string, unknown>;
    if (result.error) {
      console.warn(`[${ts}] resolveMarket WARN: ${result.error}`);
      return { success: false, error: result.error as string };
    }

    console.info(`[${ts}] resolveMarket INFO: market ${input.marketId} resolved as ${input.outcome}, paid ${result.winners_paid} tokens`);

    // Fire-and-forget SMS notification
    (async () => {
      const { data: m } = await admin.from('markets').select('question').eq('id', input.marketId).single();
      if (m) {
        await notifyMarketResolved({
          marketId: input.marketId,
          question: m.question,
          resolvedOutcome: input.outcome,
          marketType: 'binary',
        });
      }
    })().catch(console.error);

    return {
      success: true,
      data: { winnersPaid: result.winners_paid as number },
    };
  } catch (err) {
    console.error(`[${ts}] resolveMarket ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Resolve a multiple choice market — admin only.
 * Calls the atomic resolve_market_mc RPC which pays out all winning bettors.
 */
export async function resolveMarketMc(input: {
  marketId: string;
  outcomeId: string;
}): Promise<ActionResult<{ winnersPaid: number }>> {
  const ts = new Date().toISOString();

  const parsed = resolveMcSchema.safeParse(input);
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
    const { data, error } = await admin.rpc('resolve_market_mc', {
      p_admin_id: user.id,
      p_market_id: input.marketId,
      p_outcome_id: input.outcomeId,
    });

    if (error) {
      console.error(`[${ts}] resolveMarketMc ERROR: ${error.message}`);
      return { success: false, error: 'Failed to resolve market' };
    }

    const result = data as Record<string, unknown>;
    if (result.error) {
      console.warn(`[${ts}] resolveMarketMc WARN: ${result.error}`);
      return { success: false, error: result.error as string };
    }

    console.info(`[${ts}] resolveMarketMc INFO: market ${input.marketId} resolved as ${result.outcome}, paid ${result.winners_paid} tokens`);

    // Fire-and-forget SMS notification
    (async () => {
      const { data: m } = await admin.from('markets').select('question').eq('id', input.marketId).single();
      if (m) {
        await notifyMarketResolved({
          marketId: input.marketId,
          question: m.question,
          resolvedOutcome: result.outcome as string,
          marketType: 'multiple_choice',
          winningOutcomeId: input.outcomeId,
        });
      }
    })().catch(console.error);

    return {
      success: true,
      data: { winnersPaid: result.winners_paid as number },
    };
  } catch (err) {
    console.error(`[${ts}] resolveMarketMc ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Cancel a market — admin only.
 * Calls the atomic cancel_market RPC which refunds all bettors.
 * Works for both binary and multi-choice (refunds based on cost).
 */
export async function cancelMarket(input: {
  marketId: string;
}): Promise<ActionResult<{ totalRefunded: number }>> {
  const ts = new Date().toISOString();

  const parsed = cancelSchema.safeParse(input);
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
    const { data, error } = await admin.rpc('cancel_market', {
      p_admin_id: user.id,
      p_market_id: input.marketId,
    });

    if (error) {
      console.error(`[${ts}] cancelMarket ERROR: ${error.message}`);
      return { success: false, error: 'Failed to cancel market' };
    }

    const result = data as Record<string, unknown>;
    if (result.error) {
      console.warn(`[${ts}] cancelMarket WARN: ${result.error}`);
      return { success: false, error: result.error as string };
    }

    console.info(`[${ts}] cancelMarket INFO: market ${input.marketId} cancelled, refunded ${result.total_refunded} tokens`);
    return {
      success: true,
      data: { totalRefunded: result.total_refunded as number },
    };
  } catch (err) {
    console.error(`[${ts}] cancelMarket ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
