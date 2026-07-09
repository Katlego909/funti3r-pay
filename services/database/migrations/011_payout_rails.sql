-- Payout rails: workers choose how they get paid — direct to their Stellar
-- wallet (default, today's behavior) or disbursed through a Stellar anchor
-- (SEP-31 direct payment: bank/cash-out). Also gives payments a real `rail`
-- column (the dashboard's Rail column previously read a field that never
-- existed) and a provider reference for anchor-side transaction ids.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_method VARCHAR(20) NOT NULL DEFAULT 'stellar'
    CHECK (payout_method IN ('stellar', 'anchor')),
  ADD COLUMN IF NOT EXISTS payout_details JSONB;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS rail VARCHAR(20) NOT NULL DEFAULT 'stellar',
  ADD COLUMN IF NOT EXISTS provider_reference TEXT;
