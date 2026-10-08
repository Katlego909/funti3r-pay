-- Payout receipt: what a completed anchor cash-out actually did, so a worker can
-- see where the money went instead of just "Paid out". Captured at completion:
--   payout_destination  masked snapshot of the payout details submitted (never the
--                       full account number)
--   anchor_amount_out   what the anchor said it pays out (+ asset) and its fee
--   anchor_domain       which anchor handled it (so a sandbox can be labelled)

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS payout_destination      JSONB,
  ADD COLUMN IF NOT EXISTS anchor_amount_out       TEXT,
  ADD COLUMN IF NOT EXISTS anchor_amount_out_asset TEXT,
  ADD COLUMN IF NOT EXISTS anchor_fee              TEXT,
  ADD COLUMN IF NOT EXISTS anchor_fee_asset        TEXT,
  ADD COLUMN IF NOT EXISTS anchor_domain           TEXT;
