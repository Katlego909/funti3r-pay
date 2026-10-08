-- MoneyGram Ramps as a cash-out rail (custodial). A cash-out now has a rail:
--   anchor     the generic Stellar anchor rail (SEP-6/SEP-24)
--   moneygram  MoneyGram Ramps: the worker completes MoneyGram's widget, we pay
--              the USDC deposit it asks for, MoneyGram issues a cash-pickup
--              reference number.
--
-- Receipt columns from 013/017 are reused where they fit (anchor_tx_id = MoneyGram
-- transaction id, anchor_settlement_hash = our USDC payment, anchor_amount_out =
-- what the recipient receives, anchor_fee = MoneyGram's fee). Only what is new is
-- added here. MoneyGram's KYC data is never stored.

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS cashout_rail VARCHAR(12) NOT NULL DEFAULT 'anchor'
    CHECK (cashout_rail IN ('anchor', 'moneygram')),
  ADD COLUMN IF NOT EXISTS ramps_status TEXT,
  ADD COLUMN IF NOT EXISTS ramps_reference_number TEXT,
  ADD COLUMN IF NOT EXISTS ramps_destination_country TEXT,
  ADD COLUMN IF NOT EXISTS ramps_send_usdc TEXT;

-- One MoneyGram transaction can fund exactly one milestone: a replayed or forged
-- deposit request can never make us pay the same transaction twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrow_milestones_moneygram_tx
  ON escrow_milestones (anchor_tx_id)
  WHERE cashout_rail = 'moneygram' AND anchor_tx_id IS NOT NULL;
