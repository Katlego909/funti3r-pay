-- Escrow accounting. Until now no escrow route wrote to `payments`, the table behind
-- Total Received, Payment History, the charts and the employer's totals, so escrow
-- money the worker had really received was invisible there.
--
-- A claimed milestone is the moment the worker actually receives the money, so it
-- becomes one completed payment (funding is "locked", not "paid"). The row is keyed
-- `escrow:<escrowId>:<idx>` on the existing (enterprise_id, idempotency_key) unique
-- index, so recording it twice — from the claim route, the reconciler or this
-- backfill — is a no-op. Cash-outs and refunds are not payments.

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS cashout_xlm_spent NUMERIC(20,7);

-- Anchor cash-outs send the whole milestone amount.
UPDATE escrow_milestones
   SET cashout_xlm_spent = amount
 WHERE cashout_status = 'completed' AND cashout_rail = 'anchor' AND cashout_xlm_spent IS NULL;

-- Backfill every milestone claimed so far (re-runnable).
INSERT INTO payments
  (enterprise_id, worker_id, amount, currency, status, stellar_tx_hash, stellar_destination,
   description, reference_id, created_at, completed_at, updated_at, idempotency_key, rail)
SELECT e.enterprise_id, e.worker_id, m.amount, 'XLM', 'completed', m.claim_tx_hash, u.stellar_public_key,
       'Escrow milestone: ' || COALESCE(NULLIF(m.description, ''), 'Milestone ' || (m.idx + 1)),
       e.id::text, COALESCE(m.claimed_at, NOW()), COALESCE(m.claimed_at, NOW()), COALESCE(m.claimed_at, NOW()),
       'escrow:' || e.id::text || ':' || m.idx, 'escrow'
  FROM escrow_milestones m
  JOIN escrows e ON e.id = m.escrow_id
  JOIN users u ON u.id = e.worker_id
 WHERE m.status = 'claimed'
ON CONFLICT (enterprise_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
