-- Which anchor transfer protocol created a cash-out's anchor transaction, so a
-- resume always continues on the same one. The reference anchor leaves SEP-6
-- withdrawals parked at `incomplete`; SEP-24 (interactive) is the working path,
-- and a cash-out started on one protocol can't be finished on the other.

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS anchor_protocol VARCHAR(10)
    CHECK (anchor_protocol IN ('sep6', 'sep24'));
