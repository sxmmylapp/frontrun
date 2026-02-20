-- =============================================================================
-- Initial Schema: Profiles + Token Ledger (Append-Only)
-- Phase 1: Foundation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Profiles table
-- Extends auth.users with public profile data
-- -----------------------------------------------------------------------------
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  is_admin    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce phone uniqueness at index level
CREATE UNIQUE INDEX idx_profiles_phone ON profiles(phone);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own display_name
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Service role can insert (via trigger)
CREATE POLICY "Service role can insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Token Ledger (Append-Only)
-- Source of truth for all token balances
-- Balance = SUM(amount) WHERE user_id = $1
-- NO mutable balance column anywhere
-- -----------------------------------------------------------------------------
CREATE TABLE token_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id),
  amount        NUMERIC NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN (
    'signup_bonus',
    'bet_placed',
    'resolution_payout',
    'market_cancelled_refund',
    'adjustment'
  )),
  reference_id  UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient balance queries
CREATE INDEX idx_token_ledger_user_created ON token_ledger(user_id, created_at);

-- Enable RLS
ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;

-- Users can read their own ledger entries
CREATE POLICY "Users can read own ledger"
  ON token_ledger FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can insert (no client-side token manipulation)
CREATE POLICY "Service role can insert ledger entries"
  ON token_ledger FOR INSERT
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- User Balances View
-- Derived balance from append-only ledger
-- -----------------------------------------------------------------------------
CREATE VIEW user_balances AS
SELECT
  user_id,
  COALESCE(SUM(amount), 0) AS balance
FROM token_ledger
GROUP BY user_id;

-- -----------------------------------------------------------------------------
-- Random Display Name Generator
-- Combines adjective + animal for fun default names
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_display_name()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  adjectives TEXT[] := ARRAY[
    'Lucky', 'Swift', 'Bold', 'Clever', 'Brave',
    'Cosmic', 'Mighty', 'Steady', 'Sharp', 'Quick',
    'Fierce', 'Sly', 'Wise', 'Noble', 'Daring',
    'Chill', 'Wild', 'Keen', 'Snappy', 'Slick'
  ];
  animals TEXT[] := ARRAY[
    'Llama', 'Fox', 'Eagle', 'Otter', 'Hawk',
    'Wolf', 'Bear', 'Lynx', 'Raven', 'Falcon',
    'Panda', 'Tiger', 'Shark', 'Cobra', 'Phoenix',
    'Badger', 'Jaguar', 'Viper', 'Owl', 'Bison'
  ];
BEGIN
  RETURN adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
    || ' '
    || animals[1 + floor(random() * array_length(animals, 1))::int];
END;
$$;

-- -----------------------------------------------------------------------------
-- Auto-create profile and grant tokens on signup
-- Trigger fires after INSERT on auth.users
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create profile with random display name
  INSERT INTO profiles (id, phone, display_name)
  VALUES (
    NEW.id,
    NEW.phone,
    generate_display_name()
  );

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

-- Trigger on auth.users INSERT
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- -----------------------------------------------------------------------------
-- Enable Realtime for token_ledger (live balance updates)
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE token_ledger;
