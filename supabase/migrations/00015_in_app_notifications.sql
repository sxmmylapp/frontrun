-- In-app broadcast notifications
-- Admin sends a message that shows as a popup for all users

-- notifications: one row per broadcast
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  message TEXT NOT NULL,
  max_views INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- notification_dismissals: tracks view count per user per notification
CREATE TABLE notification_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  view_count INTEGER NOT NULL DEFAULT 1,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(notification_id, user_id)
);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_dismissals ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read notifications
CREATE POLICY "Authenticated users can read notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (true);

-- Dismissals: users can read their own
CREATE POLICY "Users can read own dismissals"
  ON notification_dismissals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Dismissals: users can insert their own
CREATE POLICY "Users can insert own dismissals"
  ON notification_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Dismissals: users can update their own (to increment view_count)
CREATE POLICY "Users can update own dismissals"
  ON notification_dismissals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
