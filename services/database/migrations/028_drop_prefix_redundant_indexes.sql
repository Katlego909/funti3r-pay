-- An index on (a) is redundant when another index on the same table starts with (a): every lookup on `a` already
-- uses the wider one, and the narrow copy only adds a write to every insert/update and cache pressure.
-- Only plain (non-unique, non-partial) indexes are dropped; each is covered by an index that stays.

-- Covered by a UNIQUE constraint's index
DROP INDEX IF EXISTS idx_enterprise_members_enterprise;   -- (enterprise_id, user_id)
DROP INDEX IF EXISTS idx_enterprise_workers_enterprise_id; -- (enterprise_id, worker_id)
DROP INDEX IF EXISTS idx_escrow_milestones_escrow;        -- (escrow_id, idx)

-- Covered by a wider composite index
DROP INDEX IF EXISTS idx_audit_logs_entity;               -- (entity_type, entity_id, action)
DROP INDEX IF EXISTS idx_payments_enterprise_id;          -- (enterprise_id, worker_id)
DROP INDEX IF EXISTS idx_payments_status;                 -- (status, created_at DESC)

-- idx_user_credentials_user_id is left alone here: it is only redundant once the (user_id, origin) unique constraint
-- exists, and databases created before the migrations became the schema authority may lack that constraint.
