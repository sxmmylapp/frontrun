-- =============================================================================
-- Limit per-user total investment per market & increase per-bet cap
-- - Per-bet max: 25% of pool (was 10%)
-- - Per-user-per-market total: 25% of pool (new)
-- =============================================================================

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
  v_total_pool NUMERIC;
  v_user_total_cost NUMERIC;
  v_max_user_total NUMERIC;
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

  -- Block creator from betting on own market
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

  v_total_pool := v_pool.yes_pool + v_pool.no_pool;

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
      'error', 'Would exceed per-market limit — you can invest up to ' || ROUND(v_max_user_total, 2) || ' tokens total (' || ROUND(v_max_user_total - v_user_total_cost, 2) || ' remaining)'
    );
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
