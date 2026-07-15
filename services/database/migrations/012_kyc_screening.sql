-- Sanctions/AML screening results, layered onto the existing kyc_records
-- table (compliance-service already owns KYC; this adds the screening gate
-- rather than standing up a second KYC system).

ALTER TABLE kyc_records
  ADD COLUMN IF NOT EXISTS sanctions_status VARCHAR(20) NOT NULL DEFAULT 'clear'
    CHECK (sanctions_status IN ('clear', 'flagged')),
  ADD COLUMN IF NOT EXISTS sanctions_matches JSONB,
  ADD COLUMN IF NOT EXISTS sanctions_checked_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_kyc_records_sanctions_status ON kyc_records(sanctions_status);
