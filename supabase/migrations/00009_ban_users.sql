-- =============================================================================
-- Ban Users: Add ban fields to profiles
-- =============================================================================

-- Add ban columns to profiles
ALTER TABLE profiles
  ADD COLUMN is_banned BOOLEAN DEFAULT FALSE,
  ADD COLUMN banned_at TIMESTAMPTZ;

-- Index for efficient banned user lookups in middleware
CREATE INDEX idx_profiles_banned ON profiles(id) WHERE is_banned = TRUE;

-- Ban the phone number +17176489113 permanently
UPDATE profiles
  SET is_banned = TRUE, banned_at = NOW()
  WHERE phone = '+17176489113';
