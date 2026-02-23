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
  is_banned: boolean;
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
      .select('id, display_name, phone, is_banned')
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
      is_banned: u.is_banned === true,
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

// --- Ban User ---

const banUserSchema = z.object({
  userId: z.uuid('Invalid user ID'),
});

export async function banUser(input: {
  userId: string;
}): Promise<ActionResult> {
  const ts = new Date().toISOString();

  const parsed = banUserSchema.safeParse(input);
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

    // Prevent banning yourself
    if (parsed.data.userId === user.id) {
      return { success: false, error: 'Cannot ban yourself' };
    }

    // Verify target user exists and isn't already banned
    const { data: targetUser } = await admin
      .from('profiles')
      .select('id, display_name, is_banned, is_admin')
      .eq('id', parsed.data.userId)
      .single();

    if (!targetUser) {
      return { success: false, error: 'User not found' };
    }

    if (targetUser.is_admin) {
      return { success: false, error: 'Cannot ban an admin' };
    }

    if (targetUser.is_banned) {
      return { success: false, error: 'User is already banned' };
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update({ is_banned: true, banned_at: new Date().toISOString() })
      .eq('id', parsed.data.userId);

    if (updateError) {
      console.error(`[${ts}] banUser ERROR: ${updateError.message}`);
      return { success: false, error: 'Failed to ban user' };
    }

    console.info(
      `[${ts}] banUser INFO: admin=${user.id} banned user=${parsed.data.userId} (${targetUser.display_name})`
    );

    return { success: true, data: undefined };
  } catch (err) {
    console.error(`[${ts}] banUser ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

// --- Unban User ---

export async function unbanUser(input: {
  userId: string;
}): Promise<ActionResult> {
  const ts = new Date().toISOString();

  const parsed = banUserSchema.safeParse(input);
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

    const { data: targetUser } = await admin
      .from('profiles')
      .select('id, display_name, is_banned')
      .eq('id', parsed.data.userId)
      .single();

    if (!targetUser) {
      return { success: false, error: 'User not found' };
    }

    if (!targetUser.is_banned) {
      return { success: false, error: 'User is not banned' };
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update({ is_banned: false, banned_at: null })
      .eq('id', parsed.data.userId);

    if (updateError) {
      console.error(`[${ts}] unbanUser ERROR: ${updateError.message}`);
      return { success: false, error: 'Failed to unban user' };
    }

    console.info(
      `[${ts}] unbanUser INFO: admin=${user.id} unbanned user=${parsed.data.userId} (${targetUser.display_name})`
    );

    return { success: true, data: undefined };
  } catch (err) {
    console.error(`[${ts}] unbanUser ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

// --- Get Banned Users ---

export type BannedUser = {
  id: string;
  display_name: string;
  phone: string;
  banned_at: string | null;
};

export async function getBannedUsers(): Promise<ActionResult<BannedUser[]>> {
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

    const { data: banned, error } = await admin
      .from('profiles')
      .select('id, display_name, phone, banned_at')
      .eq('is_banned', true)
      .order('banned_at', { ascending: false });

    if (error) {
      console.error(`[${ts}] getBannedUsers ERROR: ${error.message}`);
      return { success: false, error: 'Failed to fetch banned users' };
    }

    return { success: true, data: banned ?? [] };
  } catch (err) {
    console.error(`[${ts}] getBannedUsers ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
