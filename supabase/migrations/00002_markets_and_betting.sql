-- =============================================================================
-- Markets + Outcomes + Positions Schema
-- Phase 3: Core Loop
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Markets table
-- Each market is a binary question with YES/NO outcomes
-- -----------------------------------------------------------------------------
CREATE TABLE markets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      UUID NOT NULL REFERENCES profiles(id),
  question        TEXT NOT NULL CHECK (char_length(question) >= 5),
  resolution_criteria TEXT NOT NULL CHECK (char_length(resolution_criteria) >= 10),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'resolved', 'cancelled')),
  resolved_outcome TEXT CHECK (resolved_outcome IN ('yes', 'no')),
  closes_at       TIMESTAMPTZ NOT NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_closes_at ON markets(closes_at);
CREATE INDEX idx_markets_creator ON markets(creator_id);

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read markets
CREATE POLICY "Authenticated users can read markets"
  ON markets FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can create markets
CREATE POLICY "Authenticated users can create markets"
  ON markets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = creator_id);

-- Only admins can update markets (resolve/cancel)
CREATE POLICY "Admins can update markets"
  ON markets FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- -----------------------------------------------------------------------------
-- Market Pools (CPMM state)
-- Tracks the AMM pool values for each market
-- -----------------------------------------------------------------------------
CREATE TABLE market_pools (
  market_id   UUID PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  yes_pool    NUMERIC NOT NULL CHECK (yes_pool > 0),
  no_pool     NUMERIC NOT NULL CHECK (no_pool > 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE market_pools ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read pools (needed for odds display)
CREATE POLICY "Authenticated users can read pools"
  ON market_pools FOR SELECT
  TO authenticated
  USING (true);

-- Service role manages pool updates
CREATE POLICY "Service role can manage pools"
  ON market_pools FOR ALL
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Positions (user bets on markets)
-- Each row = one bet placed by a user
-- -----------------------------------------------------------------------------
CREATE TABLE positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  market_id       UUID NOT NULL REFERENCES markets(id),
  outcome         TEXT NOT NULL CHECK (outcome IN ('yes', 'no')),
  shares          NUMERIC NOT NULL CHECK (shares > 0),
  cost            NUMERIC NOT NULL CHECK (cost > 0),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_positions_user ON positions(user_id);
CREATE INDEX idx_positions_market ON positions(market_id);
CREATE INDEX idx_positions_user_market ON positions(user_id, market_id);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Users can read their own positions
CREATE POLICY "Users can read own positions"
  ON positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Anyone can read positions on a market (for volume display)
CREATE POLICY "Authenticated users can read market positions"
  ON positions FOR SELECT
  TO authenticated
  USING (true);

-- Service role inserts positions (via bet API)
CREATE POLICY "Service role can insert positions"
  ON positions FOR INSERT
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Place bet RPC (atomic transaction)
-- Validates balance, updates pool, inserts position, debits tokens
-- ALL in one transaction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION place_bet(
  p_user_id UUID,
  p_market_id UUID,
  p_outcome TEXT,
  p_amount NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_pool RECORD;
  v_balance NUMERIC;
  v_k NUMERIC;
  v_new_yes NUMERIC;
  v_new_no NUMERIC;
  v_shares NUMERIC;
  v_position_id UUID;
BEGIN
  -- Validate outcome
  IF p_outcome NOT IN ('yes', 'no') THEN
    RETURN json_build_object('error', 'Invalid outcome');
  END IF;

  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN json_build_object('error', 'Amount must be positive');
  END IF;

  -- Lock market row to prevent concurrent resolution
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Market not found');
  END IF;
  IF v_market.status != 'open' THEN
    RETURN json_build_object('error', 'Market is not open for betting');
  END IF;
  IF v_market.closes_at <= NOW() THEN
    RETURN json_build_object('error', 'Market has closed');
  END IF;

  -- Check user balance
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM token_ledger WHERE user_id = p_user_id;
  IF v_balance < p_amount THEN
    RETURN json_build_object('error', 'Insufficient balance');
  END IF;

  -- Lock pool row
  SELECT * INTO v_pool FROM market_pools WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Pool not found');
  END IF;

  -- CPMM calculation
  v_k := v_pool.yes_pool * v_pool.no_pool;

  IF p_outcome = 'yes' THEN
    v_new_no := v_pool.no_pool + p_amount;
    v_new_yes := v_k / v_new_no;
    v_shares := v_pool.yes_pool - v_new_yes;
  ELSE
    v_new_yes := v_pool.yes_pool + p_amount;
    v_new_no := v_k / v_new_yes;
    v_shares := v_pool.no_pool - v_new_no;
  END IF;

  -- Update pool
  UPDATE market_pools
    SET yes_pool = v_new_yes, no_pool = v_new_no, updated_at = NOW()
    WHERE market_id = p_market_id;

  -- Insert position
  INSERT INTO positions (user_id, market_id, outcome, shares, cost)
    VALUES (p_user_id, p_market_id, p_outcome, v_shares, p_amount)
    RETURNING id INTO v_position_id;

  -- Debit tokens from user ledger
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, -p_amount, 'bet_placed', v_position_id);

  RETURN json_build_object(
    'success', true,
    'position_id', v_position_id,
    'shares', v_shares,
    'new_yes_pool', v_new_yes,
    'new_no_pool', v_new_no,
    'new_yes_probability', v_new_no / (v_new_yes + v_new_no),
    'new_no_probability', v_new_yes / (v_new_yes + v_new_no)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Enable Realtime for market_pools (live odds updates)
-- -----------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE market_pools;
ALTER PUBLICATION supabase_realtime ADD TABLE markets;
