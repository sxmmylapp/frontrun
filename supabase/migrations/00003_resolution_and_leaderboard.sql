-- =============================================================================
-- Resolution + Cancellation RPCs (Atomic Payouts/Refunds)
-- Phase 4: Resolution and Leaderboard
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Resolve Market RPC
-- Admin resolves a market, paying out winning bettors atomically.
-- Each winning share pays 1 token. Payout = shares held.
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
  v_is_admin BOOLEAN;
  v_position RECORD;
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

  -- Update market status
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = p_outcome,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Pay out winning bettors: each share = 1 token
  FOR v_position IN
    SELECT user_id, shares
      FROM positions
      WHERE market_id = p_market_id AND outcome = p_outcome
  LOOP
    INSERT INTO token_ledger (user_id, amount, reason, reference_id)
      VALUES (v_position.user_id, v_position.shares, 'resolution_payout', p_market_id);
    v_total_paid := v_total_paid + v_position.shares;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'market_id', p_market_id,
    'outcome', p_outcome,
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Cancel Market RPC
-- Admin cancels a market, refunding all bettors their original cost atomically.
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

  -- Refund all bettors their original cost
  FOR v_position IN
    SELECT user_id, cost
      FROM positions
      WHERE market_id = p_market_id
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

-- -----------------------------------------------------------------------------
-- Leaderboard: Allow all authenticated users to read all profiles
-- (needed for display names on leaderboard)
-- -----------------------------------------------------------------------------
CREATE POLICY "Authenticated users can read profiles for leaderboard"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);
