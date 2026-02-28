-- 00018_deferred_referral_bonus.sql
-- Defer referral bonus until referred user places first bet (min 50 tokens).
-- Adds tracking flag and unique constraint for anti-abuse.

-- 1. Add flag to track whether referrer has been credited for this referral
ALTER TABLE profiles ADD COLUMN referral_bonus_credited BOOLEAN DEFAULT FALSE;

-- 2. Unique partial index on token_ledger to prevent double-credit of referral bonuses
-- (user_id = referrer, reference_id = referred user)
CREATE UNIQUE INDEX idx_token_ledger_referral_unique
  ON token_ledger (user_id, reason, reference_id)
  WHERE reason = 'referral_bonus';
