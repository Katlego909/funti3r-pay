-- Milestone review flow. The contract only knows Pending -> Approved -> Claimed;
-- "the worker says the work is done" and "the employer sent it back" are
-- off-chain, so they live here, with a full audit trail.
--
--   review_status: none      worker hasn't submitted anything yet
--                  submitted worker submitted work, waiting on the employer
--                  rejected  employer sent it back with a reason; worker resubmits
--
-- Approval stays the on-chain moment and is still allowed without a
-- submission (the employer's call), but is recorded in the same trail.

ALTER TABLE escrow_milestones
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (review_status IN ('none', 'submitted', 'rejected'));

CREATE TABLE IF NOT EXISTS escrow_milestone_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id   UUID        NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  idx         INT         NOT NULL,
  kind        VARCHAR(20) NOT NULL CHECK (kind IN ('submitted', 'approved', 'rejected')),
  actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  actor_role  VARCHAR(20) NOT NULL CHECK (actor_role IN ('worker', 'enterprise')),
  note        TEXT,
  links       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_milestone_events_escrow
  ON escrow_milestone_events (escrow_id, idx, created_at);
