'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

// --- Search Users ---

const searchUsersSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
});

export type UserSearchResult = {
  id: string;
  display_name: string;
  phone: string;
  balance: number;
};

export async function searchUsers(input: {
  query: string;
}): Promise<ActionResult<UserSearchResult[]>> {
  const ts = new Date().toISOString();

  const parsed = searchUsersSchema.safeParse(input);
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
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return { success: false, error: 'Not authorized — admin only' };
    }

    const q = `%${parsed.data.query}%`;

    const { data: users, error } = await admin
      .from('profiles')
      .select('id, display_name, phone')
      .or(`display_name.ilike.${q},phone.ilike.${q}`)
      .limit(20);

    if (error) {
      console.error(`[${ts}] searchUsers ERROR: ${error.message}`);
      return { success: false, error: 'Failed to search users' };
    }

    if (!users || users.length === 0) {
      return { success: true, data: [] };
    }

    // Get balances for matched users
    const userIds = users.map((u) => u.id);
    const { data: balances } = await admin
      .from('user_balances')
      .select('user_id, balance')
      .in('user_id', userIds);

    const balanceMap = new Map(
      (balances ?? []).map((b) => [b.user_id, Number(b.balance ?? 0)])
    );

    const results: UserSearchResult[] = users.map((u) => ({
      id: u.id,
      display_name: u.display_name,
      phone: u.phone,
      balance: balanceMap.get(u.id) ?? 0,
    }));

    console.info(`[${ts}] searchUsers INFO: query="${parsed.data.query}" found ${results.length} users`);
    return { success: true, data: results };
  } catch (err) {
    console.error(`[${ts}] searchUsers ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

// --- Adjust Balance ---

const adjustBalanceSchema = z.object({
  userId: z.uuid('Invalid user ID'),
  amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero'),
  note: z.string().optional(),
});

export async function adjustBalance(input: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<ActionResult<{ newBalance: number }>> {
  const ts = new Date().toISOString();

  const parsed = adjustBalanceSchema.safeParse(input);
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
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      return { success: false, error: 'Not authorized — admin only' };
    }

    // Verify target user exists
    const { data: targetUser } = await admin
      .from('profiles')
      .select('id, display_name')
      .eq('id', parsed.data.userId)
      .single();

    if (!targetUser) {
      return { success: false, error: 'Target user not found' };
    }

    // Insert ledger entry
    const { error: ledgerError } = await admin
      .from('token_ledger')
      .insert({
        user_id: parsed.data.userId,
        amount: parsed.data.amount,
        reason: 'adjustment',
      });

    if (ledgerError) {
      console.error(`[${ts}] adjustBalance ERROR: ${ledgerError.message}`);
      return { success: false, error: 'Failed to insert ledger entry' };
    }

    // Get updated balance
    const { data: balanceRow } = await admin
      .from('user_balances')
      .select('balance')
      .eq('user_id', parsed.data.userId)
      .single();

    const newBalance = Number(balanceRow?.balance ?? 0);

    console.info(
      `[${ts}] adjustBalance INFO: admin=${user.id} adjusted user=${parsed.data.userId} (${targetUser.display_name}) amount=${parsed.data.amount} note="${parsed.data.note ?? ''}" newBalance=${newBalance}`
    );

    return { success: true, data: { newBalance } };
  } catch (err) {
    console.error(`[${ts}] adjustBalance ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
