-- =============================================================================
-- Fix 1: Proportional payout on resolution (was 1:1 share-to-token)
-- Fix 2: Block market creators from betting on own markets
-- Fix 3: Cap max bet at 10% of pool size
-- =============================================================================

-- -----------------------------------------------------------------------------
-- resolve_market — proportional payout
-- Winners split the total pool (yes_pool + no_pool) proportionally to shares.
-- payoutPerShare = totalPool / totalWinningShares
-- Each winner gets: shares * payoutPerShare
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_market(
  p_admin_id UUID,
  p_market_id UUID,
  p_outcome TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_pool RECORD;
  v_is_admin BOOLEAN;
  v_position RECORD;
  v_total_pool NUMERIC;
  v_total_winning_shares NUMERIC;
  v_payout_per_share NUMERIC;
  v_payout NUMERIC;
  v_total_paid NUMERIC := 0;
BEGIN
  -- Validate outcome
  IF p_outcome NOT IN ('yes', 'no') THEN
    RETURN json_build_object('error', 'Invalid outcome — must be yes or no');
  END IF;

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
  IF v_market.status NOT IN ('open', 'closed') THEN
    RETURN json_build_object('error', 'Market is already resolved or cancelled');
  END IF;

  -- Lock pool and read totals
  SELECT * INTO v_pool FROM market_pools WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Pool not found');
  END IF;

  v_total_pool := v_pool.yes_pool + v_pool.no_pool;

  -- Sum winning shares
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winning_shares
    FROM positions
    WHERE market_id = p_market_id AND outcome = p_outcome;

  -- Update market status
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = p_outcome,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Pay out winning bettors proportionally
  IF v_total_winning_shares > 0 THEN
    v_payout_per_share := v_total_pool / v_total_winning_shares;

    FOR v_position IN
      SELECT user_id, shares
        FROM positions
        WHERE market_id = p_market_id AND outcome = p_outcome
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
    'outcome', p_outcome,
    'total_pool', v_total_pool,
    'payout_per_share', COALESCE(v_payout_per_share, 0),
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- place_bet — add creator block + max bet (10% of pool)
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
  v_max_bet NUMERIC;
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

  -- Fix 2: Block creator from betting on own market
  IF v_market.creator_id = p_user_id THEN
    RETURN json_build_object('error', 'Cannot bet on a market you created');
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

  -- Fix 3: Cap bet at 10% of pool
  v_max_bet := (v_pool.yes_pool + v_pool.no_pool) * 0.10;
  IF p_amount > v_max_bet THEN
    RETURN json_build_object('error', 'Bet too large — max is 10% of pool (' || ROUND(v_max_bet, 2) || ' tokens)');
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
