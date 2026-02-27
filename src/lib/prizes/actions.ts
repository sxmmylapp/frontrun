'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

const createSnapshotSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

/**
 * Create a prize period snapshot — captures current leaderboard standings.
 * Admin only.
 */
export async function createPrizeSnapshot(input: {
  title: string;
}): Promise<ActionResult<{ periodId: string; entriesCount: number }>> {
  const ts = new Date().toISOString();

  const parsed = createSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Verify admin
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return { success: false, error: 'Not authorized — admin only' };
    }

    // Create the prize period
    const { data: period, error: periodError } = await admin
      .from('prize_periods')
      .insert({
        title: input.title,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (periodError || !period) {
      console.error(`[${ts}] createPrizeSnapshot ERROR: ${periodError?.message}`);
      return { success: false, error: 'Failed to create prize period' };
    }

    // Get current leaderboard and bot IDs
    const [balancesResult, botsResult] = await Promise.all([
      admin
        .from('user_balances')
        .select('user_id, balance')
        .order('balance', { ascending: false })
        .limit(200),
      admin
        .from('profiles')
        .select('id')
        .eq('is_bot', true),
    ]);

    const botIds = new Set((botsResult.data ?? []).map((b) => b.id));
    const balances = (balancesResult.data ?? [])
      .filter((b) => b.user_id && !botIds.has(b.user_id))
      .slice(0, 100);

    if (balances.length === 0) {
      return { success: true, data: { periodId: period.id, entriesCount: 0 } };
    }

    // Insert snapshot entries
    const entries = balances.map((b, i) => ({
      period_id: period.id,
      user_id: b.user_id!,
      rank: i + 1,
      balance: Number(b.balance ?? 0),
    }));

    const { error: snapshotError } = await admin
      .from('leaderboard_snapshots')
      .insert(entries);

    if (snapshotError) {
      console.error(`[${ts}] createPrizeSnapshot ERROR: ${snapshotError.message}`);
      return { success: false, error: 'Failed to save snapshot entries' };
    }

    console.info(`[${ts}] createPrizeSnapshot INFO: period ${period.id} created with ${entries.length} entries`);
    return {
      success: true,
      data: { periodId: period.id, entriesCount: entries.length },
    };
  } catch (err) {
    console.error(`[${ts}] createPrizeSnapshot ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Toggle a snapshot entry as a winner — admin only.
 */
export async function toggleWinner(input: {
  snapshotId: string;
  isWinner: boolean;
}): Promise<ActionResult<undefined>> {
  const ts = new Date().toISOString();

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return { success: false, error: 'Not authorized — admin only' };
    }

    const { error } = await admin
      .from('leaderboard_snapshots')
      .update({ is_winner: input.isWinner })
      .eq('id', input.snapshotId);

    if (error) {
      console.error(`[${ts}] toggleWinner ERROR: ${error.message}`);
      return { success: false, error: 'Failed to update winner status' };
    }

    return { success: true, data: undefined };
  } catch (err) {
    console.error(`[${ts}] toggleWinner ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
