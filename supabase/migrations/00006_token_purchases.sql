-- =============================================================================
-- Token Purchases + Stripe Events + Atomic Fulfillment RPC
-- Phase 6: Payment Infrastructure
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Token Purchases table
-- Tracks each Stripe PaymentIntent → token credit lifecycle
-- -----------------------------------------------------------------------------
CREATE TABLE token_purchases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES profiles(id),
  stripe_payment_intent_id TEXT UNIQUE NOT NULL,
  tier                     TEXT NOT NULL CHECK (tier IN ('small', 'medium', 'large')),
  amount_cents             INTEGER NOT NULL,
  tokens_credited          INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'completed', 'failed')),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  completed_at             TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_token_purchases_user ON token_purchases(user_id);
-- Note: UNIQUE constraint on stripe_payment_intent_id already creates a unique index

-- Enable RLS
ALTER TABLE token_purchases ENABLE ROW LEVEL SECURITY;

-- Users can read their own purchases
CREATE POLICY "Users can read own purchases"
  ON token_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role can manage all purchases
CREATE POLICY "Service role can manage purchases"
  ON token_purchases FOR ALL
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Stripe Events table (webhook idempotency)
-- Ensures each Stripe event is processed exactly once
-- -----------------------------------------------------------------------------
CREATE TABLE stripe_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          TEXT UNIQUE NOT NULL,
  event_type        TEXT NOT NULL,
  payment_intent_id TEXT,
  processed_at      TIMESTAMPTZ DEFAULT NOW(),
  status            TEXT DEFAULT 'processed'
);

-- Enable RLS with service-role-only access
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage stripe events"
  ON stripe_events FOR ALL
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Alter token_ledger CHECK constraint to accept 'token_purchase' reason
-- MUST be done before any payment code deploys (Pitfall 7)
-- -----------------------------------------------------------------------------
ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_reason_check;
ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_reason_check
  CHECK (reason IN (
    'signup_bonus',
    'bet_placed',
    'resolution_payout',
    'market_cancelled_refund',
    'adjustment',
    'token_purchase'
  ));

-- -----------------------------------------------------------------------------
-- credit_token_purchase RPC
-- Atomically credits tokens to ledger and updates purchase status
-- Idempotent: calling twice with same PI does not double-credit
-- Follows existing place_bet RPC pattern
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION credit_token_purchase(
  p_payment_intent_id TEXT,
  p_user_id UUID,
  p_tokens INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase RECORD;
  v_ledger_id UUID;
BEGIN
  -- Lock the purchase row to prevent concurrent processing
  SELECT * INTO v_purchase
    FROM token_purchases
    WHERE stripe_payment_intent_id = p_payment_intent_id
    FOR UPDATE;

  -- Purchase not found
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Purchase not found');
  END IF;

  -- Already completed — idempotent return
  IF v_purchase.status = 'completed' THEN
    RETURN json_build_object('already_processed', true);
  END IF;

  -- User mismatch safety check
  IF v_purchase.user_id != p_user_id THEN
    RETURN json_build_object('error', 'User mismatch');
  END IF;

  -- Credit tokens to ledger
  INSERT INTO token_ledger (user_id, amount, reason, reference_id)
    VALUES (p_user_id, p_tokens, 'token_purchase', v_purchase.id)
    RETURNING id INTO v_ledger_id;

  -- Mark purchase as completed
  UPDATE token_purchases
    SET status = 'completed', completed_at = NOW()
    WHERE id = v_purchase.id;

  RETURN json_build_object(
    'success', true,
    'ledger_id', v_ledger_id,
    'tokens_credited', p_tokens
  );
END;
$$;
