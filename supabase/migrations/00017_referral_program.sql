-- 00017_referral_program.sql
-- Add referral program: unique referral codes, referred_by tracking, referral_bonus token reason

-- 1. Add referral columns to profiles
ALTER TABLE profiles ADD COLUMN referral_code TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN referred_by UUID REFERENCES profiles(id);

-- 2. Backfill existing users with deterministic codes
UPDATE profiles
SET referral_code = upper(substr(md5(id::text || created_at::text), 1, 8));

-- 3. Make referral_code NOT NULL after backfill
ALTER TABLE profiles ALTER COLUMN referral_code SET NOT NULL;

-- 4. Update token_ledger reason CHECK constraint to include 'referral_bonus'
ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_reason_check;
ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_reason_check
  CHECK (reason IN (
    'signup_bonus', 'bet_placed', 'resolution_payout',
    'market_cancelled_refund', 'adjustment', 'token_purchase',
    'bet_cancelled', 'bot_seed', 'referral_bonus'
  ));

-- 5. Replace handle_new_user() to also generate a referral_code (collision-safe loop)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code TEXT;
  attempts INT := 0;
BEGIN
  -- Generate a unique referral code (collision-safe loop, max 10 attempts)
  LOOP
    new_code := upper(substr(md5(NEW.id::text || NOW()::text || random()::text), 1, 8));
    BEGIN
      INSERT INTO profiles (id, phone, display_name, referral_code)
      VALUES (
        NEW.id,
        NEW.phone,
        generate_display_name(),
        new_code
      );
      EXIT; -- Success, break the loop
    EXCEPTION WHEN unique_violation THEN
      attempts := attempts + 1;
      IF attempts >= 10 THEN
        RAISE EXCEPTION 'Failed to generate unique referral code after 10 attempts';
      END IF;
      -- Loop again with a new code
    END;
  END LOOP;

  -- Grant 1,000 signup bonus tokens
  INSERT INTO token_ledger (user_id, amount, reason)
  VALUES (
    NEW.id,
    1000,
    'signup_bonus'
  );

  RETURN NEW;
END;
$$;
