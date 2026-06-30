-- Funti3r-Pay Clean Schema
-- This is the definitive schema for Phase 1

-- Drop old tables (development only)
DROP TABLE IF EXISTS payment_signatures CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;
DROP TABLE IF EXISTS enterprise_workers CASCADE;
DROP TABLE IF EXISTS enterprises CASCADE;
DROP TABLE IF EXISTS kyc_records CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS refresh_token_blacklist CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Core Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255), -- nullable: passkey (WebAuthn) users have no password
  role VARCHAR(20) NOT NULL CHECK (role IN ('enterprise', 'worker', 'admin')),

  -- Worker-specific: Classic Stellar ed25519 account
  stellar_public_key VARCHAR(60) UNIQUE,
  stellar_secret_key TEXT, -- encrypted at rest in production

  -- User info
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(20),
  country VARCHAR(2),

  -- KYC/Compliance
  kyc_status VARCHAR(20) CHECK (kyc_status IN ('pending', 'verified', 'failed', 'rejected')) DEFAULT 'pending',
  kyc_verified_at TIMESTAMP,

  -- Payout currency the worker receives (USDC or a local currency code)
  preferred_currency VARCHAR(10) NOT NULL DEFAULT 'USDC',

  -- Account status
  status VARCHAR(20) CHECK (status IN ('active', 'suspended', 'closed')) DEFAULT 'active',

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_stellar_public_key ON users(stellar_public_key);
CREATE INDEX idx_users_status ON users(status);

-- WebAuthn Credentials (passkeys). One credential per (user, origin).
CREATE TABLE user_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   TEXT        NOT NULL UNIQUE,
  public_key      TEXT        NOT NULL,
  counter         BIGINT      NOT NULL DEFAULT 0,
  transports      TEXT[]      NOT NULL DEFAULT '{}',
  aaguid          VARCHAR(100),
  origin          VARCHAR(255),
  created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, origin)
);

CREATE INDEX idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX idx_user_credentials_credential_id ON user_credentials(credential_id);

-- Enterprise Profile
CREATE TABLE enterprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  company_registration VARCHAR(255),
  country VARCHAR(2),

  -- Enterprise wallet (for escrow, optional)
  wallet_address VARCHAR(255),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enterprises_user_id ON enterprises(user_id);

-- Enterprise-Worker Relationship
CREATE TABLE enterprise_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) CHECK (status IN ('active', 'inactive', 'removed')) DEFAULT 'active',
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(enterprise_id, worker_id)
);

CREATE INDEX idx_enterprise_workers_enterprise_id ON enterprise_workers(enterprise_id);
CREATE INDEX idx_enterprise_workers_worker_id ON enterprise_workers(worker_id);

-- Payment Records
-- enterprise_id and worker_id both reference the users table (the enterprise
-- user and the worker user). Each holds a classic Stellar account.
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- Amount
  amount DECIMAL(18, 8) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'XLM',

  -- Status: initiated → pending_signature → submitted → completed
  status VARCHAR(20) NOT NULL CHECK (status IN (
    'initiated',
    'pending_signature',
    'submitted',
    'completed',
    'failed',
    'cancelled'
  )) DEFAULT 'initiated',

  -- Stellar blockchain data
  stellar_tx_hash VARCHAR(255),
  stellar_destination VARCHAR(60), -- worker's Stellar account
  stellar_source_secret TEXT, -- encrypted, for signing transactions

  -- Failure reason (set when a payment fails)
  failure_reason TEXT,

  -- Metadata
  description VARCHAR(500),
  reference_id VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMP,
  completed_at TIMESTAMP,
  failed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_enterprise_id ON payments(enterprise_id);
CREATE INDEX idx_payments_worker_id ON payments(worker_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_stellar_tx_hash ON payments(stellar_tx_hash);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX idx_payments_enterprise_worker ON payments(enterprise_id, worker_id);
CREATE INDEX idx_payments_status_created ON payments(status, created_at DESC);

-- Payment Signatures (for multi-sig or external signing)
CREATE TABLE payment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,

  -- Signed transaction XDR
  signed_xdr TEXT NOT NULL,

  -- Who signed
  signed_by UUID NOT NULL REFERENCES users(id),
  signed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_signatures_payment_id ON payment_signatures(payment_id);

-- KYC Records
CREATE TABLE kyc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- KYC Provider
  provider VARCHAR(50) NOT NULL DEFAULT 'manual',
  provider_request_id VARCHAR(255),

  -- Status
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending',

  -- Provider data (JSON response)
  data JSONB,
  verified_at TIMESTAMP,
  expires_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kyc_records_user_id ON kyc_records(user_id);
CREATE INDEX idx_kyc_records_status ON kyc_records(status);

-- Audit Log
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL, -- 'user', 'payment', 'kyc'
  entity_id UUID NOT NULL,
  action VARCHAR(100) NOT NULL, -- 'created', 'updated', 'deleted'
  actor_id UUID REFERENCES users(id),

  -- JSON changes
  changes JSONB, -- {field: {from: old, to: new}}
  metadata JSONB, -- additional context

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_entity_action ON audit_logs(entity_type, entity_id, action);

-- Refresh Token Blacklist (for logout)
CREATE TABLE refresh_token_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti VARCHAR(255) UNIQUE NOT NULL,
  blacklisted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_refresh_token_blacklist_user_id ON refresh_token_blacklist(user_id);
CREATE INDEX idx_refresh_token_blacklist_expires_at ON refresh_token_blacklist(expires_at);

-- Done
SELECT 'Schema created successfully' AS message;
