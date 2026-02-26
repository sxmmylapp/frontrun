-- Add notification preferences to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notify_new_markets BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_market_resolved BOOLEAN DEFAULT true;

-- SMS log table for audit trail
CREATE TABLE IF NOT EXISTS sms_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  phone TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('new_market', 'market_resolved')),
  market_id UUID REFERENCES markets(id),
  message TEXT NOT NULL,
  twilio_sid TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS on sms_log
ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own SMS logs
CREATE POLICY "Users read own sms_log"
  ON sms_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role has full access (no policy needed, bypasses RLS)
