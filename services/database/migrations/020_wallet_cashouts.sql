-- MoneyGram cash-outs come out of the worker's wallet balance, not out of one escrow
-- milestone. Once a milestone is claimed its XLM is just part of the wallet, so a
-- cash-out is its own record: how much XLM was spent, what MoneyGram will pay out.
-- MoneyGram's KYC data is never stored.

CREATE TABLE IF NOT EXISTS cashouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES users(id),
  rail VARCHAR(12) NOT NULL DEFAULT 'moneygram' CHECK (rail IN ('moneygram')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  -- MoneyGram's transaction id; unique so a replayed deposit request can never pay one transaction twice.
  mg_tx_id TEXT NOT NULL UNIQUE,
  mg_status TEXT,
  settlement_hash TEXT,
  xlm_spent NUMERIC(20,7),
  send_usdc TEXT,
  reference_number TEXT,
  destination_country TEXT,
  receive_amount TEXT,
  receive_currency TEXT,
  fee TEXT,
  fee_currency TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cashouts_worker ON cashouts (worker_id, created_at DESC);

-- Carry over the cash-outs already made against milestones (re-runnable: guarded by the unique index).
INSERT INTO cashouts (worker_id, status, mg_tx_id, mg_status, settlement_hash, xlm_spent, send_usdc, reference_number,
                      destination_country, receive_amount, receive_currency, fee, fee_currency, error, created_at, completed_at)
SELECT e.worker_id, CASE WHEN m.cashout_status IN ('completed', 'failed') THEN m.cashout_status ELSE 'pending' END, m.anchor_tx_id, m.ramps_status, m.anchor_settlement_hash, m.cashout_xlm_spent,
       m.ramps_send_usdc, m.ramps_reference_number, m.ramps_destination_country, m.anchor_amount_out,
       m.anchor_amount_out_asset, m.anchor_fee, m.anchor_fee_asset, m.cashout_error,
       COALESCE(m.cashout_at, NOW()), m.cashout_at
  FROM escrow_milestones m JOIN escrows e ON e.id = m.escrow_id
 WHERE m.cashout_rail = 'moneygram' AND m.anchor_tx_id IS NOT NULL
ON CONFLICT (mg_tx_id) DO NOTHING;

-- Milestones go back to plain claimed; the MoneyGram columns have moved to cashouts.
UPDATE escrow_milestones
   SET cashout_status = 'none', cashout_error = NULL, cashout_at = NULL, cashout_xlm_spent = NULL,
       anchor_tx_id = NULL, anchor_domain = NULL, anchor_settlement_hash = NULL, anchor_status = NULL,
       anchor_amount_out = NULL, anchor_amount_out_asset = NULL, anchor_fee = NULL, anchor_fee_asset = NULL
 WHERE cashout_rail = 'moneygram';

DROP INDEX IF EXISTS uq_escrow_milestones_moneygram_tx;
ALTER TABLE escrow_milestones
  DROP COLUMN IF EXISTS cashout_rail,
  DROP COLUMN IF EXISTS ramps_status,
  DROP COLUMN IF EXISTS ramps_reference_number,
  DROP COLUMN IF EXISTS ramps_destination_country,
  DROP COLUMN IF EXISTS ramps_send_usdc;
