-- =============================================================================
-- Fix hybrid payout fallback: winners must always get at least their cost back.
--
-- Bug: When surplus < 0 (pool drained by cancellations), the fallback computed
-- payout = cost * (total_pool / total_winning_cost), giving winners LESS than
-- their cost — violating the "all winners profit" guarantee.
--
-- Fix: fallback now returns payout = cost (break-even floor). House absorbs
-- any shortfall rather than passing the loss to winners.
--
-- Also repairs historically affected positions where payout < cost.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Section A: Fix resolve_market (binary) fallback
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
  v_total_winning_cost NUMERIC;
  v_surplus NUMERIC;
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

  -- Sum winning shares and cost (exclude cancelled positions)
  SELECT COALESCE(SUM(shares), 0), COALESCE(SUM(cost), 0)
    INTO v_total_winning_shares, v_total_winning_cost
    FROM positions
    WHERE market_id = p_market_id AND outcome = p_outcome AND cancelled_at IS NULL;

  v_surplus := v_total_pool - v_total_winning_cost;

  -- Update market status
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = p_outcome,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Pay out winning bettors using hybrid formula
  IF v_total_winning_shares > 0 THEN
    FOR v_position IN
      SELECT id, user_id, shares, cost
        FROM positions
        WHERE market_id = p_market_id AND outcome = p_outcome AND cancelled_at IS NULL
    LOOP
      IF v_surplus >= 0 THEN
        -- Normal case: refund cost + share of surplus
        v_payout := v_position.cost + (v_position.shares / v_total_winning_shares * v_surplus);
      ELSE
        -- Fallback: return cost (break-even floor). House absorbs shortfall.
        v_payout := v_position.cost;
      END IF;

      INSERT INTO token_ledger (user_id, amount, reason, reference_id)
        VALUES (v_position.user_id, v_payout, 'resolution_payout', p_market_id);
      UPDATE positions SET payout = v_payout WHERE id = v_position.id;
      v_total_paid := v_total_paid + v_payout;
    END LOOP;
  END IF;

  -- Mark losing positions with payout = 0
  UPDATE positions
    SET payout = 0
    WHERE market_id = p_market_id
      AND (outcome != p_outcome OR cancelled_at IS NOT NULL)
      AND payout IS NULL;

  RETURN json_build_object(
    'success', true,
    'market_id', p_market_id,
    'outcome', p_outcome,
    'total_pool', v_total_pool,
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Section B: Fix resolve_market_mc (multiple choice) fallback
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
  v_total_winning_cost NUMERIC;
  v_surplus NUMERIC;
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

  -- Sum winning shares and cost (only active positions with this outcome_id)
  SELECT COALESCE(SUM(shares), 0), COALESCE(SUM(cost), 0)
    INTO v_total_winning_shares, v_total_winning_cost
    FROM positions
    WHERE market_id = p_market_id
      AND outcome_id = p_outcome_id
      AND cancelled_at IS NULL;

  v_surplus := v_total_pool - v_total_winning_cost;

  -- Update market status
  UPDATE markets
    SET status = 'resolved',
        resolved_outcome = v_outcome.label,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_market_id;

  -- Pay out winners using hybrid formula
  IF v_total_winning_shares > 0 THEN
    FOR v_position IN
      SELECT id, user_id, shares, cost
        FROM positions
        WHERE market_id = p_market_id
          AND outcome_id = p_outcome_id
          AND cancelled_at IS NULL
    LOOP
      IF v_surplus >= 0 THEN
        v_payout := v_position.cost + (v_position.shares / v_total_winning_shares * v_surplus);
      ELSE
        -- Fallback: return cost (break-even floor). House absorbs shortfall.
        v_payout := v_position.cost;
      END IF;

      INSERT INTO token_ledger (user_id, amount, reason, reference_id)
        VALUES (v_position.user_id, v_payout, 'resolution_payout', p_market_id);
      UPDATE positions SET payout = v_payout WHERE id = v_position.id;
      v_total_paid := v_total_paid + v_payout;
    END LOOP;
  END IF;

  -- Mark losing positions with payout = 0
  UPDATE positions
    SET payout = 0
    WHERE market_id = p_market_id
      AND (outcome_id != p_outcome_id OR cancelled_at IS NOT NULL)
      AND payout IS NULL;

  RETURN json_build_object(
    'success', true,
    'market_id', p_market_id,
    'outcome', v_outcome.label,
    'total_pool', v_total_pool,
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Section C: Data repair — credit affected winners for binary markets
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
  v_shortfall NUMERIC;
BEGIN
  FOR v_rec IN
    SELECT p.id AS position_id, p.user_id, p.cost, p.payout, p.market_id
      FROM positions p
      JOIN markets m ON m.id = p.market_id
      WHERE m.status = 'resolved'
        AND m.market_type = 'binary'
        AND p.outcome = m.resolved_outcome
        AND p.cancelled_at IS NULL
        AND p.payout IS NOT NULL
        AND p.payout < p.cost
  LOOP
    v_shortfall := v_rec.cost - v_rec.payout;

    -- Credit the shortfall
    INSERT INTO token_ledger (user_id, amount, reason, reference_id)
      VALUES (v_rec.user_id, v_shortfall, 'adjustment', v_rec.market_id);

    -- Update position payout to cost (break-even)
    UPDATE positions SET payout = v_rec.cost WHERE id = v_rec.position_id;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- Section D: Data repair — credit affected winners for multiple-choice markets
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_rec RECORD;
  v_shortfall NUMERIC;
BEGIN
  FOR v_rec IN
    SELECT p.id AS position_id, p.user_id, p.cost, p.payout, p.market_id
      FROM positions p
      JOIN markets m ON m.id = p.market_id
      JOIN market_outcomes mo ON mo.id = p.outcome_id AND mo.market_id = m.id
      WHERE m.status = 'resolved'
        AND m.market_type = 'multiple_choice'
        AND mo.label = m.resolved_outcome
        AND p.cancelled_at IS NULL
        AND p.payout IS NOT NULL
        AND p.payout < p.cost
  LOOP
    v_shortfall := v_rec.cost - v_rec.payout;

    -- Credit the shortfall
    INSERT INTO token_ledger (user_id, amount, reason, reference_id)
      VALUES (v_rec.user_id, v_shortfall, 'adjustment', v_rec.market_id);

    -- Update position payout to cost (break-even)
    UPDATE positions SET payout = v_rec.cost WHERE id = v_rec.position_id;
  END LOOP;
END;
$$;
