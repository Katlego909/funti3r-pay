-- Multi-tenancy Phase 3: invite a teammate into an existing company.
-- New dedicated table (not a reuse of worker_invites) so enterprise_id is
-- correct from day one — it references enterprises.id directly, unlike
-- worker_invites.enterprise_id (which is actually a users.id, a historical
-- naming confusion this table deliberately avoids repeating).

CREATE TABLE IF NOT EXISTS enterprise_member_invites (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID         NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  invited_by    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,
  company_role  VARCHAR(20)  NOT NULL DEFAULT 'member'
                  CHECK (company_role IN ('admin', 'member')), -- no 'owner' — ownership transfer is out of scope
  token         VARCHAR(64)  NOT NULL UNIQUE,
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS idx_enterprise_member_invites_token      ON enterprise_member_invites(token);
CREATE INDEX IF NOT EXISTS idx_enterprise_member_invites_enterprise ON enterprise_member_invites(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_enterprise_member_invites_email      ON enterprise_member_invites(email);
