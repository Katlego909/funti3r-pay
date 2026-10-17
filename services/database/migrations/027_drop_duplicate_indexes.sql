-- Indexes that duplicate another index on the same column(s). Each one costs a write on every insert/update and
-- disk/cache space, and the planner never needs it: an identical index already serves the same lookups.
--
-- A UNIQUE constraint is backed by its own index, so a plain index on the same column is redundant; the constraint's
-- index is the one kept (and is never touched here — it enforces uniqueness).
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_stellar_public_key;
DROP INDEX IF EXISTS idx_enterprises_user_id;
DROP INDEX IF EXISTS idx_kyc_records_user_id;
DROP INDEX IF EXISTS idx_payment_signatures_payment_id;
DROP INDEX IF EXISTS idx_wallet_metadata;
DROP INDEX IF EXISTS idx_worker_invites_token;
DROP INDEX IF EXISTS idx_enterprise_member_invites_token;
DROP INDEX IF EXISTS idx_user_credentials_credential_id;

-- payments: older databases carry a second, identically-defined index on each column (not created by any migration
-- here); idx_payments_enterprise_id / idx_payments_worker_id from 001 are the ones kept. IF EXISTS makes this a no-op
-- on databases built from the migrations alone.
DROP INDEX IF EXISTS idx_payments_enterprise;
DROP INDEX IF EXISTS idx_payments_worker;
