-- =============================================================================
-- Fix: FOR UPDATE cannot be combined with aggregate functions in MC RPCs
-- PostgreSQL does not allow FOR UPDATE with SUM/EXP/LN aggregates.
-- Solution: lock rows first with PERFORM, then compute aggregates separately.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- place_bet_mc: Fix aggregate + FOR UPDATE conflict
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION place_bet_mc(
  p_user_id UUID,
  p_market_id UUID,
  p_outcome_id UUID,
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
  v_outcome RECORD;
  v_num_outcomes INT;
  v_k NUMERIC;
  v_pool_rec RECORD;
  v_target_pool NUMERIC;
  v_per_other NUMERIC;
  v_new_product NUMERIC;
  v_new_target NUMERIC;
  v_shares NUMERIC;
  v_position_id UUID;
  v_outcome_label TEXT;
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

  -- Validate outcome belongs to this market
  SELECT * INTO v_outcome FROM market_outcomes
    WHERE id = p_outcome_id AND market_id = p_market_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Invalid outcome for this market');
  END IF;
  v_outcome_label := v_outcome.label;

  -- Check balance
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
    FROM token_ledger WHERE user_id = p_user_id;
  IF v_balance < p_amount THEN
    RETURN json_build_object('error', 'Insufficient balance');
  END IF;

  -- Count outcomes
  SELECT COUNT(*) INTO v_num_outcomes FROM market_outcomes WHERE market_id = p_market_id;

  -- Lock all pool rows first (separate from aggregate)
  PERFORM 1 FROM outcome_pools WHERE market_id = p_market_id FOR UPDATE;

  -- Compute k = product of all pools (rows already locked)
  SELECT EXP(SUM(LN(pool))) INTO v_k
    FROM outcome_pools WHERE market_id = p_market_id;

  -- Get current target pool
  SELECT pool INTO v_target_pool FROM outcome_pools
    WHERE market_id = p_market_id AND outcome_id = p_outcome_id;

  -- Add tokens/(N-1) to each non-target pool
  v_per_other := p_amount / (v_num_outcomes - 1);
  UPDATE outcome_pools
    SET pool = pool + v_per_other, updated_at = NOW()
    WHERE market_id = p_market_id AND outcome_id != p_outcome_id;

  -- Compute product of all non-target pools after update
  SELECT EXP(SUM(LN(pool))) INTO v_new_product
    FROM outcome_pools
    WHERE market_id = p_market_id AND outcome_id != p_outcome_id;

  -- new target pool = k / product(other new pools)
  v_new_target := v_k / v_new_product;
  v_shares := v_target_pool - v_new_target;

  -- Safety: shares must be positive
  IF v_shares <= 0 THEN
    RETURN json_build_object('error', 'Trade would produce zero or negative shares');
  END IF;

  -- Update target pool
  UPDATE outcome_pools
    SET pool = v_new_target, updated_at = NOW()
    WHERE market_id = p_market_id AND outcome_id = p_outcome_id;

  -- Insert position
  INSERT INTO positions (user_id, market_id, outcome, outcome_id, shares, cost)
    VALUES (p_user_id, p_market_id, v_outcome_label, p_outcome_id, v_shares, p_amount)
    RETURNING id INTO v_position_id;

  -- Debit tokens
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, -p_amount, 'bet_placed', v_position_id);

  RETURN json_build_object(
    'success', true,
    'position_id', v_position_id,
    'shares', v_shares,
    'outcome_label', v_outcome_label
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- cancel_bet_mc: Fix aggregate + FOR UPDATE conflict
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
  v_num_outcomes INT;
  v_k NUMERIC;
  v_old_target NUMERIC;
  v_new_target NUMERIC;
  v_pool_rec RECORD;
  v_scale_factor NUMERIC;
  v_tokens_returned NUMERIC := 0;
  v_other_product_old NUMERIC;
  v_other_product_new_needed NUMERIC;
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
  IF v_position.outcome_id IS NULL THEN
    RETURN json_build_object('error', 'Use cancel_bet for binary positions');
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

  -- Count outcomes
  SELECT COUNT(*) INTO v_num_outcomes FROM market_outcomes WHERE market_id = v_position.market_id;

  -- Lock all pool rows first (separate from aggregate)
  PERFORM 1 FROM outcome_pools WHERE market_id = v_position.market_id FOR UPDATE;

  -- Compute k = product of all pools (rows already locked)
  SELECT EXP(SUM(LN(pool))) INTO v_k
    FROM outcome_pools WHERE market_id = v_position.market_id;

  -- Get current target pool
  SELECT pool INTO v_old_target FROM outcome_pools
    WHERE market_id = v_position.market_id AND outcome_id = v_position.outcome_id;

  -- Return shares to target pool
  v_new_target := v_old_target + v_position.shares;

  -- Compute product of other pools (before change)
  SELECT EXP(SUM(LN(pool))) INTO v_other_product_old
    FROM outcome_pools
    WHERE market_id = v_position.market_id AND outcome_id != v_position.outcome_id;

  -- We need: v_new_target * new_other_product = k
  -- new_other_product = k / v_new_target
  v_other_product_new_needed := v_k / v_new_target;

  -- Scale factor: each other pool scales by r = (needed_product / old_product)^(1/(N-1))
  v_scale_factor := POWER(v_other_product_new_needed / v_other_product_old, 1.0 / (v_num_outcomes - 1));

  -- Calculate tokens returned = sum of (old_pool - new_pool) for non-target pools
  v_tokens_returned := 0;
  FOR v_pool_rec IN
    SELECT outcome_id, pool FROM outcome_pools
    WHERE market_id = v_position.market_id AND outcome_id != v_position.outcome_id
  LOOP
    v_tokens_returned := v_tokens_returned + (v_pool_rec.pool - v_pool_rec.pool * v_scale_factor);
  END LOOP;

  -- Safety: tokens must be positive
  IF v_tokens_returned <= 0 THEN
    RETURN json_build_object('error', 'Sell would return zero or negative tokens');
  END IF;

  -- Update target pool
  UPDATE outcome_pools
    SET pool = v_new_target, updated_at = NOW()
    WHERE market_id = v_position.market_id AND outcome_id = v_position.outcome_id;

  -- Scale down other pools
  UPDATE outcome_pools
    SET pool = pool * v_scale_factor, updated_at = NOW()
    WHERE market_id = v_position.market_id AND outcome_id != v_position.outcome_id;

  -- Mark position cancelled
  UPDATE positions SET cancelled_at = NOW() WHERE id = p_position_id;

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
-- resolve_market_mc: Fix aggregate + FOR UPDATE conflict
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_market_mc(
  p_admin_id UUID,
  p_market_id UUID,
  p_outcome_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_is_admin BOOLEAN;
  v_outcome RECORD;
  v_total_pool NUMERIC;
  v_total_winning_shares NUMERIC;
  v_payout_per_share NUMERIC;
  v_position RECORD;
  v_payout NUMERIC;
  v_total_paid NUMERIC := 0;
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

  -- Validate outcome
  SELECT * INTO v_outcome FROM market_outcomes
    WHERE id = p_outcome_id AND market_id = p_market_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Invalid outcome for this market');
  END IF;

  -- Lock pool rows first (separate from aggregate)
  PERFORM 1 FROM outcome_pools WHERE market_id = p_market_id FOR UPDATE;

  -- Calculate total pool (rows already locked)
  SELECT COALESCE(SUM(pool), 0) INTO v_total_pool
    FROM outcome_pools WHERE market_id = p_market_id;

  -- Sum winning shares (only active positions with this outcome_id)
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winning_shares
    FROM positions
    WHERE market_id = p_market_id
      AND outcome_id = p_outcome_id
      AND cancelled_at IS NULL;

  -- Update market status
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = v_outcome.label,
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
          AND outcome_id = p_outcome_id
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
    'outcome', v_outcome.label,
    'total_pool', v_total_pool,
    'payout_per_share', COALESCE(v_payout_per_share, 0),
    'winners_paid', v_total_paid
  );
END;
$$;
