-- =============================================================================
-- Cancel Bet: Allow users to sell shares back into the AMM pool
-- Phase 7: User Position Cancellation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema: Add cancelled_at to positions
-- -----------------------------------------------------------------------------
ALTER TABLE positions ADD COLUMN cancelled_at TIMESTAMPTZ DEFAULT NULL;

-- -----------------------------------------------------------------------------
-- Extend token_ledger reason CHECK to include 'bet_cancelled'
-- -----------------------------------------------------------------------------
ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_reason_check;
ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_reason_check
  CHECK (reason IN (
    'signup_bonus',
    'bet_placed',
    'resolution_payout',
    'market_cancelled_refund',
    'adjustment',
    'token_purchase',
    'bet_cancelled'
  ));

-- -----------------------------------------------------------------------------
-- cancel_bet RPC (atomic, SECURITY DEFINER)
-- User sells their shares back into the CPMM pool at current market prices.
-- Reverse CPMM: shares return to pool, tokens extracted.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_bet(
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
  v_pool RECORD;
  v_k NUMERIC;
  v_new_yes NUMERIC;
  v_new_no NUMERIC;
  v_tokens_returned NUMERIC;
BEGIN
  -- Lock position row
  SELECT * INTO v_position FROM positions WHERE id = p_position_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Position not found');
  END IF;

  -- Verify ownership
  IF v_position.user_id != p_user_id THEN
    RETURN json_build_object('error', 'Not your position');
  END IF;

  -- Check not already cancelled
  IF v_position.cancelled_at IS NOT NULL THEN
    RETURN json_build_object('error', 'Position already cancelled');
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

  -- Lock pool
  SELECT * INTO v_pool FROM market_pools WHERE market_id = v_position.market_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Pool not found');
  END IF;

  -- Reverse CPMM: shares go back into the pool, tokens come out
  v_k := v_pool.yes_pool * v_pool.no_pool;

  IF v_position.outcome = 'yes' THEN
    -- YES shares return to yesPool, tokens extracted from noPool
    v_new_yes := v_pool.yes_pool + v_position.shares;
    v_new_no := v_k / v_new_yes;
    v_tokens_returned := v_pool.no_pool - v_new_no;
  ELSE
    -- NO shares return to noPool, tokens extracted from yesPool
    v_new_no := v_pool.no_pool + v_position.shares;
    v_new_yes := v_k / v_new_no;
    v_tokens_returned := v_pool.yes_pool - v_new_yes;
  END IF;

  -- Safety: tokens returned must be positive
  IF v_tokens_returned <= 0 THEN
    RETURN json_build_object('error', 'Sell would return zero or negative tokens');
  END IF;

  -- Update pool
  UPDATE market_pools
    SET yes_pool = v_new_yes, no_pool = v_new_no, updated_at = NOW()
    WHERE market_id = v_position.market_id;

  -- Mark position as cancelled
  UPDATE positions
    SET cancelled_at = NOW()
    WHERE id = p_position_id;

  -- Credit tokens back to user
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, v_tokens_returned, 'bet_cancelled', p_position_id);

  RETURN json_build_object(
    'success', true,
    'position_id', p_position_id,
    'tokens_returned', ROUND(v_tokens_returned, 4),
    'original_cost', v_position.cost,
    'new_yes_pool', v_new_yes,
    'new_no_pool', v_new_no,
    'new_yes_probability', v_new_no / (v_new_yes + v_new_no),
    'new_no_probability', v_new_yes / (v_new_yes + v_new_no)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Update resolve_market to skip cancelled positions
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

  -- Sum winning shares (exclude cancelled positions)
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winning_shares
    FROM positions
    WHERE market_id = p_market_id
      AND outcome = p_outcome
      AND cancelled_at IS NULL;

  -- Update market status
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = p_outcome,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Pay out winning bettors proportionally (only active positions)
  IF v_total_winning_shares > 0 THEN
    v_payout_per_share := v_total_pool / v_total_winning_shares;

    FOR v_position IN
      SELECT user_id, shares
        FROM positions
        WHERE market_id = p_market_id
          AND outcome = p_outcome
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
    'outcome', p_outcome,
    'total_pool', v_total_pool,
    'payout_per_share', COALESCE(v_payout_per_share, 0),
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Update cancel_market to skip cancelled positions
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

  -- Refund only active (non-cancelled) positions
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
