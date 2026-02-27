-- 00014_trading_bots.sql
-- Add bot support: is_bot flag, bot_seed ledger reason, bot_trade_log table

-- 1. Add is_bot column to profiles
ALTER TABLE profiles ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT false;

-- 2. Update token_ledger reason CHECK constraint to include 'bot_seed'
ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_reason_check;
ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_reason_check
  CHECK (reason IN (
    'signup_bonus', 'bet_placed', 'resolution_payout',
    'market_cancelled_refund', 'adjustment', 'token_purchase',
    'bet_cancelled', 'bot_seed'
  ));

-- 3. Create bot_trade_log table for observability
CREATE TABLE bot_trade_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES profiles(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  strategy TEXT NOT NULL,
  action TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  position_id UUID REFERENCES positions(id),
  yes_prob NUMERIC NOT NULL,
  skip_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying bot activity
CREATE INDEX idx_bot_trade_log_bot_id ON bot_trade_log(bot_id);
CREATE INDEX idx_bot_trade_log_created_at ON bot_trade_log(created_at DESC);

-- Enable RLS (service-role-only access)
ALTER TABLE bot_trade_log ENABLE ROW LEVEL SECURITY;
-- No RLS policies = only service_role can read/write
