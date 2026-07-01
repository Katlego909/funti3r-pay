-- Add 'pending_claim' to payments status — used when a path payment falls back
-- to a claimable balance because the destination lacks a trustline.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'initiated',
    'pending_signature',
    'submitted',
    'completed',
    'pending_claim',
    'failed',
    'cancelled'
  ));
