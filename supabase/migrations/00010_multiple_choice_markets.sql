-- =============================================================================
-- Multiple Choice Markets
-- Phase 10: Support markets with N outcomes (2-10) using N-way CPMM
-- - New market_options table (per-outcome pools)
-- - market_type column on markets ('binary' or 'multiple_choice')
-- - market_option_id on positions (FK for MC bets)
-- - place_bet_mc, cancel_bet_mc, resolve_market_mc RPCs
-- - Updated cancel_market to handle both market types
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema: Add market_type to markets
-- -----------------------------------------------------------------------------
ALTER TABLE markets ADD COLUMN market_type TEXT NOT NULL DEFAULT 'binary';
ALTER TABLE markets ADD CONSTRAINT markets_market_type_check
  CHECK (market_type IN ('binary', 'multiple_choice'));

-- -----------------------------------------------------------------------------
-- Schema: market_options table
-- -----------------------------------------------------------------------------
CREATE TABLE market_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id   UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  pool        NUMERIC NOT NULL CHECK (pool > 0),
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_options_market_id ON market_options(market_id);

-- RLS
ALTER TABLE market_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read market_options"
  ON market_options FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages market_options"
  ON market_options FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Realtime for live odds updates
ALTER PUBLICATION supabase_realtime ADD TABLE market_options;

-- -----------------------------------------------------------------------------
-- Schema: Add market_option_id to positions
-- For MC markets, this references the chosen option.
-- For binary markets, this remains NULL.
-- -----------------------------------------------------------------------------
ALTER TABLE positions ADD COLUMN market_option_id UUID REFERENCES market_options(id);
CREATE INDEX idx_positions_market_option_id ON positions(market_option_id);

-- -----------------------------------------------------------------------------
-- place_bet_mc RPC (atomic, SECURITY DEFINER)
-- Places a bet on one outcome of a multiple-choice market.
-- N-way CPMM: tokens added to all OTHER pools, shares from target pool.
-- k = product(all pools) is preserved.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION place_bet_mc(
  p_user_id UUID,
  p_market_id UUID,
  p_option_id UUID,
  p_amount NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_balance NUMERIC;
  v_total_pool NUMERIC;
  v_max_bet NUMERIC;
  v_user_total_cost NUMERIC;
  v_max_user_total NUMERIC;
  v_k NUMERIC := 1;
  v_other_product NUMERIC := 1;
  v_old_pool NUMERIC;
  v_new_pool NUMERIC;
  v_shares NUMERIC;
  v_position_id UUID;
  v_option RECORD;
  v_option_label TEXT;
BEGIN
  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN json_build_object('error', 'Amount must be positive');
  END IF;

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Market not found');
  END IF;
  IF v_market.market_type != 'multiple_choice' THEN
    RETURN json_build_object('error', 'Not a multiple choice market');
  END IF;
  IF v_market.status != 'open' THEN
    RETURN json_build_object('error', 'Market is not open for betting');
  END IF;
  IF v_market.closes_at <= NOW() THEN
    RETURN json_build_object('error', 'Market has closed');
  END IF;

  -- Block creator
  IF v_market.creator_id = p_user_id THEN
    RETURN json_build_object('error', 'Cannot bet on a market you created');
  END IF;

  -- Check balance
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM token_ledger WHERE user_id = p_user_id;
  IF v_balance < p_amount THEN
    RETURN json_build_object('error', 'Insufficient balance');
  END IF;

  -- Lock all option rows for this market (ordered to prevent deadlocks)
  -- and compute total pool + k
  v_total_pool := 0;
  FOR v_option IN
    SELECT * FROM market_options
    WHERE market_id = p_market_id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_total_pool := v_total_pool + v_option.pool;
    v_k := v_k * v_option.pool;
    IF v_option.id = p_option_id THEN
      v_old_pool := v_option.pool;
      v_option_label := v_option.label;
    END IF;
  END LOOP;

  IF v_old_pool IS NULL THEN
    RETURN json_build_object('error', 'Option not found in this market');
  END IF;

  -- Cap single bet at 25% of pool
  v_max_bet := v_total_pool * 0.25;
  IF p_amount > v_max_bet THEN
    RETURN json_build_object('error', 'Bet too large — max is 25% of pool (' || ROUND(v_max_bet, 2) || ' tokens)');
  END IF;

  -- Cap total user investment on this market at 25% of pool
  SELECT COALESCE(SUM(cost), 0) INTO v_user_total_cost
    FROM positions
    WHERE user_id = p_user_id
      AND market_id = p_market_id
      AND cancelled_at IS NULL;

  v_max_user_total := v_total_pool * 0.25;
  IF v_user_total_cost + p_amount > v_max_user_total THEN
    RETURN json_build_object(
      'error', 'Would exceed per-market limit — you can invest up to '
        || ROUND(v_max_user_total, 2) || ' tokens total ('
        || ROUND(v_max_user_total - v_user_total_cost, 2) || ' remaining)'
    );
  END IF;

  -- N-way CPMM: add tokens to all other pools, compute new target pool
  -- product of all NEW other pools
  v_other_product := 1;
  FOR v_option IN
    SELECT * FROM market_options WHERE market_id = p_market_id ORDER BY id
  LOOP
    IF v_option.id != p_option_id THEN
      v_other_product := v_other_product * (v_option.pool + p_amount);
    END IF;
  END LOOP;

  v_new_pool := v_k / v_other_product;
  v_shares := v_old_pool - v_new_pool;

  IF v_shares <= 0 THEN
    RETURN json_build_object('error', 'Trade produces zero shares');
  END IF;

  -- Update all option pools
  UPDATE market_options
    SET pool = pool + p_amount
    WHERE market_id = p_market_id AND id != p_option_id;

  UPDATE market_options
    SET pool = v_new_pool
    WHERE id = p_option_id;

  -- Insert position
  INSERT INTO positions (user_id, market_id, outcome, shares, cost, market_option_id)
    VALUES (p_user_id, p_market_id, v_option_label, v_shares, p_amount, p_option_id)
    RETURNING id INTO v_position_id;

  -- Debit tokens
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, -p_amount, 'bet_placed', v_position_id);

  RETURN json_build_object(
    'success', true,
    'position_id', v_position_id,
    'shares', v_shares,
    'option_id', p_option_id,
    'option_label', v_option_label
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- cancel_bet_mc RPC (atomic, SECURITY DEFINER)
-- Sells MC shares back into the pool using Newton's method.
-- Shares return to target pool, equal tokens extracted from all other pools.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_bet_mc(
  p_user_id UUID,
  p_position_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position RECORD;
  v_market RECORD;
  v_option RECORD;
  v_k NUMERIC := 1;
  v_new_target_pool NUMERIC;
  v_target_product NUMERIC;
  v_t NUMERIC := 0;
  v_f NUMERIC;
  v_f_prime NUMERIC;
  v_prod NUMERIC;
  v_term NUMERIC;
  v_sum_recip NUMERIC;
  v_iter INT;
  v_num_others INT := 0;
  v_other_pools NUMERIC[];
  v_tokens_returned NUMERIC;
  v_all_positive BOOLEAN;
BEGIN
  -- Lock position
  SELECT * INTO v_position FROM positions WHERE id = p_position_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Position not found');
  END IF;

  IF v_position.user_id != p_user_id THEN
    RETURN json_build_object('error', 'Not your position');
  END IF;

  IF v_position.cancelled_at IS NOT NULL THEN
    RETURN json_build_object('error', 'Position already cancelled');
  END IF;

  IF v_position.market_option_id IS NULL THEN
    RETURN json_build_object('error', 'Not a multiple choice position');
  END IF;

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = v_position.market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Market not found');
  END IF;
  IF v_market.status != 'open' THEN
    RETURN json_build_object('error', 'Market is not open');
  END IF;
  IF v_market.closes_at <= NOW() THEN
    RETURN json_build_object('error', 'Market has closed');
  END IF;

  -- Lock all options and compute k
  v_other_pools := ARRAY[]::NUMERIC[];
  FOR v_option IN
    SELECT * FROM market_options
    WHERE market_id = v_position.market_id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_k := v_k * v_option.pool;
    IF v_option.id != v_position.market_option_id THEN
      v_other_pools := array_append(v_other_pools, v_option.pool);
      v_num_others := v_num_others + 1;
    END IF;
  END LOOP;

  -- Compute new target pool and target product for other pools
  SELECT pool INTO v_new_target_pool
    FROM market_options WHERE id = v_position.market_option_id;
  v_new_target_pool := v_new_target_pool + v_position.shares;
  v_target_product := v_k / v_new_target_pool;

  -- Newton's method: find t such that product(other_pool[j] - t) = target_product
  v_t := 0;
  FOR v_iter IN 1..100 LOOP
    v_prod := 1;
    v_sum_recip := 0;
    v_all_positive := true;

    FOR i IN 1..v_num_others LOOP
      v_term := v_other_pools[i] - v_t;
      IF v_term <= 0 THEN
        v_all_positive := false;
        EXIT;
      END IF;
      v_prod := v_prod * v_term;
      v_sum_recip := v_sum_recip + 1.0 / v_term;
    END LOOP;

    IF NOT v_all_positive THEN
      v_t := v_t * 0.5;
      CONTINUE;
    END IF;

    v_f := v_prod - v_target_product;
    IF ABS(v_f) < 1e-12 THEN EXIT; END IF;

    v_f_prime := -v_prod * v_sum_recip;
    IF v_f_prime = 0 THEN EXIT; END IF;

    v_t := v_t - v_f / v_f_prime;
    IF v_t < 0 THEN v_t := 0; END IF;
  END LOOP;

  v_tokens_returned := v_t;

  IF v_tokens_returned <= 0 THEN
    RETURN json_build_object('error', 'Sell would return zero or negative tokens');
  END IF;

  -- Update pools: target gets shares back, others lose tokens
  UPDATE market_options
    SET pool = v_new_target_pool
    WHERE id = v_position.market_option_id;

  UPDATE market_options
    SET pool = pool - v_tokens_returned
    WHERE market_id = v_position.market_id
      AND id != v_position.market_option_id;

  -- Mark position cancelled
  UPDATE positions
    SET cancelled_at = NOW()
    WHERE id = p_position_id;

  -- Credit tokens
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, v_tokens_returned, 'bet_cancelled', p_position_id);

  RETURN json_build_object(
    'success', true,
    'position_id', p_position_id,
    'tokens_returned', ROUND(v_tokens_returned, 4),
    'original_cost', v_position.cost
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- resolve_market_mc RPC (atomic, SECURITY DEFINER)
-- Resolves a multiple-choice market to a specific option.
-- Winners are positions with market_option_id = winning option.
-- Total pool = sum of all option pools.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_market_mc(
  p_admin_id UUID,
  p_market_id UUID,
  p_winning_option_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_is_admin BOOLEAN;
  v_option RECORD;
  v_position RECORD;
  v_total_pool NUMERIC := 0;
  v_total_winning_shares NUMERIC;
  v_payout_per_share NUMERIC;
  v_payout NUMERIC;
  v_total_paid NUMERIC := 0;
  v_winning_label TEXT;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = p_admin_id;
  IF NOT FOUND OR v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('error', 'Not authorized — admin only');
  END IF;

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Market not found');
  END IF;
  IF v_market.market_type != 'multiple_choice' THEN
    RETURN json_build_object('error', 'Not a multiple choice market');
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RETURN json_build_object('error', 'Market is already resolved or cancelled');
  END IF;

  -- Verify winning option exists and get total pool
  FOR v_option IN
    SELECT * FROM market_options
    WHERE market_id = p_market_id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_total_pool := v_total_pool + v_option.pool;
    IF v_option.id = p_winning_option_id THEN
      v_winning_label := v_option.label;
    END IF;
  END LOOP;

  IF v_winning_label IS NULL THEN
    RETURN json_build_object('error', 'Winning option not found in this market');
  END IF;

  -- Sum winning shares
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winning_shares
    FROM positions
    WHERE market_id = p_market_id
      AND market_option_id = p_winning_option_id
      AND cancelled_at IS NULL;

  -- Update market status (store winning option ID as resolved_outcome)
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = p_winning_option_id::TEXT,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Pay out winners
  IF v_total_winning_shares > 0 THEN
    v_payout_per_share := v_total_pool / v_total_winning_shares;

    FOR v_position IN
      SELECT user_id, shares
        FROM positions
        WHERE market_id = p_market_id
          AND market_option_id = p_winning_option_id
          AND cancelled_at IS NULL
    LOOP
      v_payout := v_position.shares * v_payout_per_share;
      INSERT INTO token_ledger (user_id, amount, reason, reference_id)
        VALUES (v_position.user_id, v_payout, 'resolution_payout', p_market_id);
      v_total_paid := v_total_paid + v_payout;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'success', true,
    'market_id', p_market_id,
    'winning_option_id', p_winning_option_id,
    'winning_label', v_winning_label,
    'total_pool', v_total_pool,
    'payout_per_share', COALESCE(v_payout_per_share, 0),
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Update cancel_market to handle both binary and MC markets
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_market(
  p_admin_id UUID,
  p_market_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_is_admin BOOLEAN;
  v_position RECORD;
  v_total_refunded NUMERIC := 0;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = p_admin_id;
  IF NOT FOUND OR v_is_admin IS NOT TRUE THEN
    RETURN json_build_object('error', 'Not authorized — admin only');
  END IF;

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Market not found');
  END IF;
  IF v_market.status IN ('resolved', 'cancelled') THEN
    RETURN json_build_object('error', 'Market is already resolved or cancelled');
  END IF;

  -- Update market status
  UPDATE markets
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Refund all active positions (works for both binary and MC)
  FOR v_position IN
    SELECT user_id, cost
      FROM positions
      WHERE market_id = p_market_id
        AND cancelled_at IS NULL
  LOOP
    INSERT INTO token_ledger (user_id, amount, reason, reference_id)
      VALUES (v_position.user_id, v_position.cost, 'market_cancelled_refund', p_market_id);
    v_total_refunded := v_total_refunded + v_position.cost;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'market_id', p_market_id,
    'total_refunded', v_total_refunded
  );
END;
$$;
