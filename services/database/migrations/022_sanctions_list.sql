-- The sanctions list the KYC gate screens against: OFAC's public SDN list, refreshed on a schedule,
-- plus the list's version so evidence can say which list a decision used. The built-in stub list in the
-- compliance service stays as a floor (and carries the QA canary), so an empty table never means "no screening".

CREATE TABLE IF NOT EXISTS sanctions_entries (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL,
  list VARCHAR(20) NOT NULL DEFAULT 'OFAC-SDN',
  name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  program TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sanctions_entries_batch ON sanctions_entries (batch_id);

-- One row: what is loaded now.
CREATE TABLE IF NOT EXISTS sanctions_list_meta (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  batch_id UUID NOT NULL,
  source TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- KYC approvals now expire; records approved before this existed get a year from their approval.
UPDATE kyc_records SET expires_at = COALESCE(verified_at, created_at) + INTERVAL '365 days'
 WHERE status = 'approved' AND expires_at IS NULL;
