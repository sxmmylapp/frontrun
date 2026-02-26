-- =============================================================================
-- Add payout column to positions for accurate P&L display.
-- Previously the frontend used raw share count as payout, which is incorrect
-- because payout = shares * (total_pool / total_winning_shares).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add payout column (nullable — NULL means not yet resolved)
-- -----------------------------------------------------------------------------
ALTER TABLE positions ADD COLUMN payout NUMERIC DEFAULT NULL;

-- -----------------------------------------------------------------------------
-- 2. Backfill binary markets: winning positions get actual payout
-- -----------------------------------------------------------------------------
WITH winning_totals AS (
  SELECT
    p.market_id,
    m.resolved_outcome,
    SUM(p.shares) AS total_winning_shares,
    (mp.yes_pool + mp.no_pool) AS total_pool
  FROM positions p
  JOIN markets m ON m.id = p.market_id
  JOIN market_pools mp ON mp.market_id = m.id
  WHERE m.status = 'resolved'
    AND m.market_type = 'binary'
    AND p.outcome = m.resolved_outcome
    AND p.cancelled_at IS NULL
  GROUP BY p.market_id, m.resolved_outcome, mp.yes_pool, mp.no_pool
)
UPDATE positions pos
SET payout = pos.shares * (wt.total_pool / wt.total_winning_shares)
FROM winning_totals wt
WHERE pos.market_id = wt.market_id
  AND pos.outcome = wt.resolved_outcome
  AND pos.cancelled_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Backfill MC markets: winning positions get actual payout
-- -----------------------------------------------------------------------------
WITH mc_winning_totals AS (
  SELECT
    p.market_id,
    mo.id AS winning_outcome_id,
    SUM(p.shares) AS total_winning_shares,
    (SELECT COALESCE(SUM(pool), 0) FROM outcome_pools op WHERE op.market_id = p.market_id) AS total_pool
  FROM positions p
  JOIN markets m ON m.id = p.market_id
  JOIN market_outcomes mo ON mo.market_id = m.id AND mo.label = m.resolved_outcome
  WHERE m.status = 'resolved'
    AND m.market_type = 'multiple_choice'
    AND p.outcome_id = mo.id
    AND p.cancelled_at IS NULL
  GROUP BY p.market_id, mo.id
)
UPDATE positions pos
SET payout = pos.shares * (mwt.total_pool / mwt.total_winning_shares)
FROM mc_winning_totals mwt
WHERE pos.market_id = mwt.market_id
  AND pos.outcome_id = mwt.winning_outcome_id
  AND pos.cancelled_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. Backfill losing positions on resolved markets: payout = 0
-- -----------------------------------------------------------------------------
UPDATE positions pos
SET payout = 0
FROM markets m
WHERE pos.market_id = m.id
  AND m.status = 'resolved'
  AND pos.cancelled_at IS NULL
  AND pos.payout IS NULL;

-- -----------------------------------------------------------------------------
-- 5. Cancelled market positions: payout = 0 (refund handled via ledger)
-- -----------------------------------------------------------------------------
UPDATE positions pos
SET payout = 0
FROM markets m
WHERE pos.market_id = m.id
  AND m.status = 'cancelled'
  AND pos.cancelled_at IS NULL
  AND pos.payout IS NULL;

-- -----------------------------------------------------------------------------
-- 6. Update resolve_market to set payout on positions
-- Also fix: filter out cancelled positions from resolution
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
    WHERE market_id = p_market_id AND outcome = p_outcome AND cancelled_at IS NULL;

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
      SELECT id, user_id, shares
        FROM positions
        WHERE market_id = p_market_id AND outcome = p_outcome AND cancelled_at IS NULL
    LOOP
      v_payout := v_position.shares * v_payout_per_share;
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
    'payout_per_share', COALESCE(v_payout_per_share, 0),
    'winners_paid', v_total_paid
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Update resolve_market_mc to set payout on positions
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
      SELECT id, user_id, shares
        FROM positions
        WHERE market_id = p_market_id
          AND outcome_id = p_outcome_id
          AND cancelled_at IS NULL
    LOOP
      v_payout := v_position.shares * v_payout_per_share;
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
    'payout_per_share', COALESCE(v_payout_per_share, 0),
    'winners_paid', v_total_paid
  );
END;
$$;
