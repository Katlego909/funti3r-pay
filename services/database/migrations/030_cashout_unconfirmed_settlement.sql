-- A cash-out payment that Horizon gave no verdict on (a timeout, a dropped connection, a 5xx) may still land until its
-- time bound passes. Its hash is kept on the cash-out so a retry can never pay MoneyGram twice, and this records since
-- when it has been waiting for the chain's answer. The scheduled sweep looks it up once the time bound is over:
-- on chain → cleared to NULL (confirmed); absent → the cash-out fails with the hash removed, and only then may it be retried.
ALTER TABLE cashouts ADD COLUMN IF NOT EXISTS settlement_unconfirmed_since TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_cashouts_unconfirmed ON cashouts (settlement_unconfirmed_since)
  WHERE settlement_unconfirmed_since IS NOT NULL;
