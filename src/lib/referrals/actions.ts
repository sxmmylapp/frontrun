'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod/v4';

const referralCodeSchema = z.string().regex(/^[A-F0-9]{8}$/, 'Invalid referral code');

const REFERRAL_BONUS = 1000;
const MIN_BET_FOR_REFERRAL = 50;

type ActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Link a referral code to the current user's profile.
 * Does NOT credit tokens — that happens when the user places their first bet.
 */
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

    // Check if user was already referred (retry once if profile not yet created by trigger)
    let currentProfile: { id: string; referred_by: string | null } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data } = await admin
        .from('profiles')
        .select('id, referred_by')
        .eq('id', user.id)
        .single();
      currentProfile = data;
      if (currentProfile) break;
      if (attempt === 0) {
        console.info(`[${ts}] processReferral INFO: profile not ready for ${user.id}, retrying in 1s`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!currentProfile) {
      console.error(`[${ts}] processReferral ERROR: profile not found for user ${user.id} after retry`);
      return { success: false, error: 'Something went wrong' };
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

    // Atomically set referred_by (only if still NULL — prevents race)
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

    console.info(`[${ts}] processReferral INFO: user ${user.id} linked referral to ${referrer.id} (bonus deferred until first bet)`);
    return { success: true };
  } catch (err) {
    console.error(`[${ts}] processReferral ERROR: unexpected -`, err);
    return { success: false, error: 'Something went wrong' };
  }
}

/**
 * Credit the referrer their bonus after the referred user places a qualifying bet.
 * Idempotent — safe to call multiple times (flag + unique constraint).
 */
export async function creditReferralBonus(userId: string, betAmount: number): Promise<void> {
  const ts = new Date().toISOString();

  // Anti-abuse: minimum bet amount
  if (betAmount < MIN_BET_FOR_REFERRAL) {
    return;
  }

  try {
    const admin = createAdminClient();

    // Look up the user's referral status
    const { data: profile } = await admin
      .from('profiles')
      .select('referred_by, referral_bonus_credited')
      .eq('id', userId)
      .single();

    if (!profile?.referred_by || profile.referral_bonus_credited) {
      return; // No referrer or already credited
    }

    // Validate referrer still exists, not banned, not bot
    const { data: referrer } = await admin
      .from('profiles')
      .select('id, is_banned, is_bot')
      .eq('id', profile.referred_by)
      .single();

    if (!referrer || referrer.is_banned || referrer.is_bot) {
      console.warn(`[${ts}] creditReferralBonus WARN: referrer ${profile.referred_by} ineligible (missing/banned/bot)`);
      return;
    }

    // Atomically set flag (only if still FALSE — prevents double-credit race)
    const { data: flagged, error: flagError } = await admin
      .from('profiles')
      .update({ referral_bonus_credited: true })
      .eq('id', userId)
      .eq('referral_bonus_credited', false)
      .eq('referred_by', profile.referred_by)
      .select('id')
      .single();

    if (flagError || !flagged) {
      console.warn(`[${ts}] creditReferralBonus WARN: flag update failed for ${userId} (likely already credited)`);
      return;
    }

    // Credit referrer (unique index prevents double-insert even if flag race somehow lost)
    const { error: ledgerError } = await admin
      .from('token_ledger')
      .insert({
        user_id: referrer.id,
        amount: REFERRAL_BONUS,
        reason: 'referral_bonus',
        reference_id: userId,
      });

    if (ledgerError) {
      // Roll back flag if ledger insert fails (unless it's a duplicate — that's fine)
      if (ledgerError.message.includes('idx_token_ledger_referral_unique')) {
        console.info(`[${ts}] creditReferralBonus INFO: duplicate ledger entry for referrer ${referrer.id}, user ${userId} — already credited`);
      } else {
        console.error(`[${ts}] creditReferralBonus ERROR: ledger insert failed for referrer ${referrer.id} - ${ledgerError.message}`);
        // Roll back the flag
        await admin
          .from('profiles')
          .update({ referral_bonus_credited: false })
          .eq('id', userId);
      }
      return;
    }

    console.info(`[${ts}] creditReferralBonus INFO: credited ${REFERRAL_BONUS} tokens to referrer ${referrer.id} for referred user ${userId}`);
  } catch (err) {
    console.error(`[${ts}] creditReferralBonus ERROR: unexpected -`, err);
  }
}
