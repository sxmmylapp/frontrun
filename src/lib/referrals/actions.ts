'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

const referralCodeSchema = z.string().regex(/^[A-F0-9]{8}$/, 'Invalid referral code');

type ActionResult =
  | { success: true }
  | { success: false; error: string };

export async function processReferral(code: string): Promise<ActionResult> {
  const ts = new Date().toISOString();

  const parsed = referralCodeSchema.safeParse(code);
  if (!parsed.success) {
    console.warn(`[${ts}] processReferral WARN: invalid code format "${code}"`);
    return { success: false, error: 'Invalid referral code' };
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const admin = createAdminClient();

    // Check if user was already referred
    const { data: currentProfile } = await admin
      .from('profiles')
      .select('id, referred_by')
      .eq('id', user.id)
      .single();

    if (!currentProfile) {
      console.error(`[${ts}] processReferral ERROR: profile not found for user ${user.id}`);
      return { success: false, error: 'Profile not found' };
    }

    if (currentProfile.referred_by) {
      console.info(`[${ts}] processReferral INFO: user ${user.id} already referred, skipping`);
      return { success: false, error: 'Already referred' };
    }

    // Look up the referrer by code
    const { data: referrer } = await admin
      .from('profiles')
      .select('id, is_banned, is_bot')
      .eq('referral_code', parsed.data)
      .single();

    if (!referrer) {
      console.warn(`[${ts}] processReferral WARN: referral code "${parsed.data}" not found`);
      return { success: false, error: 'Referral code not found' };
    }

    // Guard: self-referral
    if (referrer.id === user.id) {
      console.warn(`[${ts}] processReferral WARN: self-referral attempt by ${user.id}`);
      return { success: false, error: 'Cannot refer yourself' };
    }

    // Guard: banned referrer
    if (referrer.is_banned) {
      console.warn(`[${ts}] processReferral WARN: banned referrer ${referrer.id}`);
      return { success: false, error: 'Invalid referral' };
    }

    // Guard: bot referrer
    if (referrer.is_bot) {
      console.warn(`[${ts}] processReferral WARN: bot referrer ${referrer.id}`);
      return { success: false, error: 'Invalid referral' };
    }

    // Atomically set referred_by (only if still NULL — prevents double-credit)
    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update({ referred_by: referrer.id })
      .eq('id', user.id)
      .is('referred_by', null)
      .select('id')
      .single();

    if (updateError || !updated) {
      console.warn(`[${ts}] processReferral WARN: atomic update failed for ${user.id} (likely already referred)`);
      return { success: false, error: 'Already referred' };
    }

    // Credit referrer 1,000 tokens
    const { error: ledgerError } = await admin
      .from('token_ledger')
      .insert({
        user_id: referrer.id,
        amount: 1000,
        reason: 'referral_bonus',
        reference_id: user.id,
      });

    if (ledgerError) {
      console.error(`[${ts}] processReferral ERROR: failed to credit referrer ${referrer.id} - ${ledgerError.message}`);
      return { success: false, error: 'Failed to process referral' };
    }

    console.info(`[${ts}] processReferral INFO: user ${user.id} referred by ${referrer.id}, 1000 tokens credited`);
    return { success: true };
  } catch (err) {
    console.error(`[${ts}] processReferral ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}
