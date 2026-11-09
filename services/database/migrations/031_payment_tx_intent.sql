-- Write-ahead transaction intent. A payout's signed transaction hash (stellar_tx_hash) and its time bound
-- (tx_max_time) are stored BEFORE it is submitted. After a crash, a timeout or a lost database write, the watchdog
-- then knows exactly which transaction to look up and when the chain's answer becomes final (after tx_max_time
-- nothing can land). It no longer has to guess from how long a row has sat unchanged.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tx_max_time TIMESTAMPTZ;

-- When the chain check (lib/paymentReconcile.ts) last confirmed this settled payment. NULL = not yet verified, so
-- each settled payment is checked until it passes instead of re-checking the newest few hundred every run.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS chain_verified_at TIMESTAMPTZ;

-- The watchdog's scan: payouts still waiting for the chain's answer.
CREATE INDEX IF NOT EXISTS idx_payments_in_flight ON payments (updated_at)
  WHERE status IN ('initiated', 'submitted');

-- The chain check's scan: settled payouts not yet verified.
CREATE INDEX IF NOT EXISTS idx_payments_unverified ON payments (updated_at)
  WHERE status IN ('completed', 'pending_claim') AND chain_verified_at IS NULL;
