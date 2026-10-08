-- Escrow v2: anchor cash-out of claimed milestones, and the compliance freeze
-- flag mirrored from the contract.
--
-- A claimed milestone lands in the worker's Stellar wallet; "cash-out" is the
-- optional second leg that routes those funds through a Stellar anchor
-- (bank/cash). It is tracked separately from the on-chain claim so a failed
-- anchor leg never loses or double-pays funds: the claim stays 'claimed', the
-- cash-out stays retryable.

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS cashout_status VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (cashout_status IN ('none', 'pending', 'action_required', 'completed', 'failed')),
  -- action_required: the anchor is waiting on a step only the worker can do
  -- on the anchor's own website (anchor_more_info_url); resume once done.
  ADD COLUMN IF NOT EXISTS anchor_more_info_url TEXT,
  ADD COLUMN IF NOT EXISTS anchor_tx_id TEXT,
  ADD COLUMN IF NOT EXISTS anchor_settlement_hash TEXT,
  ADD COLUMN IF NOT EXISTS anchor_status TEXT,
  ADD COLUMN IF NOT EXISTS cashout_error TEXT,
  ADD COLUMN IF NOT EXISTS cashout_at TIMESTAMP;

ALTER TABLE escrows
  ADD COLUMN IF NOT EXISTS frozen BOOLEAN NOT NULL DEFAULT FALSE;
