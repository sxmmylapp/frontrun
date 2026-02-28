-- Fix: referral_bonus_credited was NULL for existing users, causing
-- .eq('referral_bonus_credited', false) to never match (NULL != false in SQL).
-- Backfill NULLs to FALSE and add NOT NULL constraint to prevent recurrence.

UPDATE profiles SET referral_bonus_credited = FALSE WHERE referral_bonus_credited IS NULL;
ALTER TABLE profiles ALTER COLUMN referral_bonus_credited SET NOT NULL;
