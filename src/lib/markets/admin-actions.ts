'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

const resolveSchema = z.object({
  marketId: z.string().uuid(),
  outcome: z.enum(['yes', 'no']),
});

const cancelSchema = z.object({
  marketId: z.string().uuid(),
});

/**
 * Resolve a market — admin only.
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
 * Cancel a market — admin only.
 * Calls the atomic cancel_market RPC which refunds all bettors.
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
