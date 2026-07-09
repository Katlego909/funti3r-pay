-- Milestone escrows: off-chain mirror of the funti3r-escrow Soroban contract
-- (contracts/escrow). Amounts/status live on-chain; descriptions and the
-- linkage to users live here. One row per on-chain escrow, one row per
-- milestone tranche.

CREATE TABLE IF NOT EXISTS escrows (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contract_address  TEXT         NOT NULL,             -- C... address of the deployed escrow contract
  onchain_escrow_id BIGINT       NOT NULL,             -- id returned by the contract's create()
  token_code        VARCHAR(12)  NOT NULL DEFAULT 'XLM',
  total_amount      NUMERIC(20,7) NOT NULL CHECK (total_amount > 0),
  status            VARCHAR(20)  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'refunded')),
  expires_at        TIMESTAMP    NOT NULL,
  create_tx_hash    TEXT,
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (contract_address, onchain_escrow_id)
);

CREATE TABLE IF NOT EXISTS escrow_milestones (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id      UUID          NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  idx            INT           NOT NULL,               -- position in the contract's amounts vec
  description    TEXT,
  amount         NUMERIC(20,7) NOT NULL CHECK (amount > 0),
  status         VARCHAR(20)   NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'claimed', 'refunded')),
  approved_at    TIMESTAMP,
  claimed_at     TIMESTAMP,
  claim_tx_hash  TEXT,
  UNIQUE (escrow_id, idx)
);

CREATE INDEX idx_escrows_enterprise ON escrows(enterprise_id);
CREATE INDEX idx_escrows_worker     ON escrows(worker_id);
CREATE INDEX idx_escrow_milestones_escrow ON escrow_milestones(escrow_id);
