-- Deleting a user cascades to their wallets (and the encrypted keys in them), escrows, milestones, KYC and
-- cash-outs. One careless DELETE, or a script run against the wrong database, would destroy records that hold
-- or account for real money. These tables refuse DELETE and TRUNCATE unless the session opts in explicitly:
--
--   BEGIN;
--   SET LOCAL funti3r.allow_delete = 'on';
--   DELETE FROM users WHERE id = '...';      -- e.g. an account erasure request, after a backup
--   COMMIT;
--
-- Normal application code never deletes from them, so nothing changes day to day.

CREATE OR REPLACE FUNCTION forbid_destructive_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('funti3r.allow_delete', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION 'Deleting from % is blocked to protect financial records; see migration 024 for the explicit opt-in', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'wallets', 'payments', 'escrows', 'escrow_milestones', 'cashouts', 'kyc_records', 'kyc_events']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'guard_delete_' || t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_destructive_change()', 'guard_delete_' || t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'guard_truncate_' || t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_destructive_change()', 'guard_truncate_' || t, t);
  END LOOP;
END $$;
