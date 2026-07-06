-- Schema reconciliation: brings payment_batches, wallets, wallet_metadata, and
-- several payments/users columns under migration control. These have existed
-- in live databases (added out-of-band at some point) but were never captured
-- in a migration file, so a fresh clone would break the moment anyone hit
-- /payouts/batch or wallet-linking. Purely additive — IF NOT EXISTS throughout,
-- matching the live shape exactly. No behavior change.

CREATE TABLE IF NOT EXISTS payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES users(id),
  stellar_tx_hash VARCHAR(100),
  total_amount NUMERIC(18, 7) NOT NULL,
  payment_count INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batches_enterprise ON payment_batches(enterprise_id);

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_type VARCHAR(20) NOT NULL DEFAULT 'worker',
  public_key VARCHAR(100),
  encrypted_secret TEXT,
  encryption_iv VARCHAR(64),
  encryption_tag VARCHAR(64),
  encryption_salt VARCHAR(64),
  contract_address VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  wallet_provider VARCHAR(50),
  is_external BOOLEAN NOT NULL DEFAULT false,
  public_key_verified BOOLEAN NOT NULL DEFAULT false,
  verification_challenge TEXT,
  verification_signature TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deployed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, wallet_type, is_external)
);

CREATE TABLE IF NOT EXISTS wallet_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL UNIQUE REFERENCES wallets(id),
  provider_config JSONB,
  connection_status VARCHAR(50) NOT NULL DEFAULT 'connected',
  last_activity_at TIMESTAMPTZ,
  connection_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_metadata ON wallet_metadata(wallet_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES payment_batches(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS signer_wallet_id UUID REFERENCES wallets(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_paid_xlm NUMERIC(18, 7);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS memo_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_payments_batch ON payments(batch_id);
CREATE INDEX IF NOT EXISTS idx_payments_signer ON payments(signer_wallet_id);

-- Unblocks POST /wallets/deploy-for-existing-user, which writes this column today.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_deployed_at TIMESTAMP;
