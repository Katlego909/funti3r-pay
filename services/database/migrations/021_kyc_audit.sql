-- KYC decisions leave a trail: who submitted, approved, rejected, cleared a sanctions flag
-- or re-screened a record, and when. Rows are only ever appended.

CREATE TABLE IF NOT EXISTS kyc_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Who acted: the user themself, a reviewer, or 'system' (screening job). NULL actor = system.
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20) NOT NULL,
  action VARCHAR(30) NOT NULL
    CHECK (action IN ('submitted', 'approved', 'rejected', 'flag_cleared', 'rescreened', 'expired')),
  detail JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_events_user ON kyc_events (user_id, created_at DESC);
