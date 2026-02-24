-- Add is_banned column to profiles
ALTER TABLE profiles ADD COLUMN is_banned boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN banned_at timestamptz;
ALTER TABLE profiles ADD COLUMN ban_reason text;

-- Index for quick lookup of banned users
CREATE INDEX idx_profiles_is_banned ON profiles (is_banned) WHERE is_banned = true;
