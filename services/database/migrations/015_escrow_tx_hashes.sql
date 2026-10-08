-- Transaction trail for escrow payments: every on-chain step now keeps its
-- hash so the dashboards can show (and link to) the full history of an escrow.
-- Funding (escrows.create_tx_hash), claim (claim_tx_hash) and anchor
-- settlement (anchor_settlement_hash) were already stored; approval and refund
-- were not.

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS approve_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS refund_tx_hash  TEXT;
