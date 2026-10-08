-- The SDF test anchor rail is gone: cash-outs are MoneyGram only, and they come out of the wallet
-- balance (the `cashouts` table, migration 020). These columns held the per-milestone anchor
-- cash-out state and the worker's bank details for it.
-- payments.rail / provider_reference stay: older payments keep their history.

ALTER TABLE escrow_milestones
  DROP COLUMN IF EXISTS cashout_status,
  DROP COLUMN IF EXISTS cashout_error,
  DROP COLUMN IF EXISTS cashout_at,
  DROP COLUMN IF EXISTS cashout_xlm_spent,
  DROP COLUMN IF EXISTS anchor_tx_id,
  DROP COLUMN IF EXISTS anchor_settlement_hash,
  DROP COLUMN IF EXISTS anchor_status,
  DROP COLUMN IF EXISTS anchor_more_info_url,
  DROP COLUMN IF EXISTS anchor_protocol,
  DROP COLUMN IF EXISTS anchor_domain,
  DROP COLUMN IF EXISTS anchor_amount_out,
  DROP COLUMN IF EXISTS anchor_amount_out_asset,
  DROP COLUMN IF EXISTS anchor_fee,
  DROP COLUMN IF EXISTS anchor_fee_asset,
  DROP COLUMN IF EXISTS payout_destination;

ALTER TABLE users
  DROP COLUMN IF EXISTS payout_method,
  DROP COLUMN IF EXISTS payout_details;
