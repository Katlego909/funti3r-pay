-- Multi-tenancy Phase 1: company <-> login membership, additive only.
-- No existing query changes behavior in this migration; enterprise_id columns
-- elsewhere keep meaning users.id until a later phase cuts them over.

CREATE TABLE IF NOT EXISTS enterprise_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_role VARCHAR(20) NOT NULL DEFAULT 'owner' CHECK (company_role IN ('owner', 'admin', 'member')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enterprise_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_enterprise_members_enterprise ON enterprise_members(enterprise_id);

-- v1 scope: one active company per login (no company-switcher).
CREATE UNIQUE INDEX IF NOT EXISTS idx_enterprise_members_user_active ON enterprise_members(user_id) WHERE status = 'active';

-- Backfill: any enterprise-role user who never hit the lazy Settings-page
-- creation path (PATCH /users/me) gets an enterprises row now.
INSERT INTO enterprises (user_id, company_name, country)
SELECT u.id, COALESCE(u.first_name || '''s Company', 'Company'), u.country
FROM users u
WHERE u.role = 'enterprise' AND NOT EXISTS (SELECT 1 FROM enterprises e WHERE e.user_id = u.id);

-- Backfill: one owner membership row per existing enterprise (today's model
-- is already 1:1, so this is a no-op behavior change).
INSERT INTO enterprise_members (enterprise_id, user_id, company_role)
SELECT e.id, e.user_id, 'owner'
FROM enterprises e
WHERE NOT EXISTS (
  SELECT 1 FROM enterprise_members m WHERE m.enterprise_id = e.id AND m.user_id = e.user_id
);

-- Enterprise Stellar keypair columns, added now so Phase 2's call-site cutover
-- (which repoints payout signing from users.id to enterprises.id) doesn't need
-- a second schema migration. Not populated or read by any code yet.
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS stellar_public_key VARCHAR(60);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS stellar_secret_key TEXT;
