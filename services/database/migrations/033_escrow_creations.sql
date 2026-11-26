-- Write-ahead record of an escrow being created. Creating an escrow locks the employer's money in the contract, so a
-- crash, an RPC timeout or a lost database write between the chain call and the escrows insert used to leave funds
-- locked with no row: invisible to the employer, to refunds and to the reconciler (which only walks escrows rows).
--
-- A row here is written BEFORE anything is signed; the signed transaction's hash and time bound are stored just
-- before it is submitted. The escrows table keeps its meaning (escrows that exist on chain): the route, or the
-- reconciler after the time bound, turns a confirmed creation into its escrows + escrow_milestones rows.
CREATE TABLE IF NOT EXISTS escrow_creations (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id    UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id        UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contract_address TEXT          NOT NULL,
  milestones       JSONB         NOT NULL,          -- [{ description, amountXlm }], in contract order
  expires_at       TIMESTAMPTZ   NOT NULL,
  idempotency_key  TEXT,
  payload_hash     TEXT,
  status           VARCHAR(20)   NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'done', 'failed')),
  tx_hash          TEXT,
  tx_max_time      TIMESTAMPTZ,
  escrow_id        UUID          REFERENCES escrows(id) ON DELETE SET NULL,
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One creation per client-minted key: a retried request replays instead of locking the money twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_escrow_creations_idempotency
  ON escrow_creations (enterprise_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The reconciler's scan: creations still waiting for the chain's answer.
CREATE INDEX IF NOT EXISTS idx_escrow_creations_pending ON escrow_creations (updated_at) WHERE status = 'pending';
