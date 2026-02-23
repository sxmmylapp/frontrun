-- Add banned_at column to profiles for admin user banning
ALTER TABLE profiles ADD COLUMN banned_at timestamptz DEFAULT NULL;
