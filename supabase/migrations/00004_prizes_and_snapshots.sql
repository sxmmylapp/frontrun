-- =============================================================================
-- Prize Period Snapshots
-- Phase 5: Engagement Layer
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Prize periods — each snapshot of the leaderboard for a prize cycle
-- -----------------------------------------------------------------------------
CREATE TABLE prize_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE prize_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read prize periods"
  ON prize_periods FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage prize periods"
  ON prize_periods FOR ALL
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Leaderboard snapshots — frozen rankings at the time of a prize period
-- -----------------------------------------------------------------------------
CREATE TABLE leaderboard_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id       UUID NOT NULL REFERENCES prize_periods(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id),
  rank            INT NOT NULL,
  balance         NUMERIC NOT NULL,
  is_winner       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_snapshots_period ON leaderboard_snapshots(period_id);
CREATE INDEX idx_snapshots_user ON leaderboard_snapshots(user_id);

ALTER TABLE leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read snapshots"
  ON leaderboard_snapshots FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage snapshots"
  ON leaderboard_snapshots FOR ALL
  USING (true)
  WITH CHECK (true);
