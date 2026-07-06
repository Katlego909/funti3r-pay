-- Idempotency keys for payouts. Purely additive: new nullable columns +
-- partial unique indexes (only enforced when a key is actually supplied),
-- so callers that don't pass a key behave exactly as before.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payload_hash CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
  ON payments (enterprise_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS payload_hash CHAR(64);
-- Heartbeat: bumped once per item during batch execution so the reconciliation
-- watchdog can distinguish "crashed" from "still legitimately running" — a
-- 100-item sequential batch can easily outlive a fixed staleness window.
ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_idempotency
  ON payment_batches (enterprise_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
