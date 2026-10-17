-- Brings databases created before the migrations became the schema authority in line with 001, and makes the one
-- column whose type differs between the two the same everywhere. A no-op on a database built from the migrations
-- alone, apart from that column type. Where existing data would block a change it logs a WARNING and skips just that
-- change instead of failing: a failed migration stops every service that runs it at boot.

-- Passkeys of users that no longer exist can never sign in (login joins users on user_id) and would block the
-- foreign key below.
DELETE FROM user_credentials uc WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = uc.user_id);

DO $$
DECLARE
  fk record;
  legacy text;
  has_rows boolean;
BEGIN
  -- Foreign keys 001 defines. Added NOT VALID first so new writes are checked straight away, then validated; a row
  -- that already breaks one leaves it enforced for new rows only.
  FOR fk IN SELECT * FROM (VALUES
    ('payments',         'payments_enterprise_id_fkey',        'FOREIGN KEY (enterprise_id) REFERENCES users(id) ON DELETE RESTRICT'),
    ('payment_batches',  'payment_batches_enterprise_id_fkey', 'FOREIGN KEY (enterprise_id) REFERENCES users(id)'),
    ('user_credentials', 'user_credentials_user_id_fkey',      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE'),
    ('wallet_metadata',  'wallet_metadata_wallet_id_fkey',     'FOREIGN KEY (wallet_id) REFERENCES wallets(id)')
  ) AS t(tbl, name, def)
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name AND conrelid = fk.tbl::regclass);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', fk.tbl, fk.name, fk.def);
    BEGIN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tbl, fk.name);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE WARNING '% has rows that break % — enforced for new rows, existing rows not validated', fk.tbl, fk.name;
    END;
  END LOOP;

  -- One passkey per user per origin (the application relies on it).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_credentials_user_id_origin_key' AND conrelid = 'user_credentials'::regclass) THEN
    IF EXISTS (SELECT 1 FROM user_credentials GROUP BY user_id, origin HAVING count(*) > 1) THEN
      RAISE WARNING 'user_credentials holds several passkeys for one user and origin — unique constraint not added';
    ELSE
      ALTER TABLE user_credentials ADD CONSTRAINT user_credentials_user_id_origin_key UNIQUE (user_id, origin);
    END IF;
  END IF;

  -- That constraint's index also serves lookups by user_id, so the separate user_id index is redundant — but only
  -- once the constraint is really there.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_credentials_user_id_origin_key' AND conrelid = 'user_credentials'::regclass) THEN
    DROP INDEX IF EXISTS idx_user_credentials_user_id;
  END IF;

  -- 001 made this column a plain TIMESTAMP while older databases have TIMESTAMPTZ; settle on TIMESTAMPTZ. Values were
  -- written by NOW() on a UTC server, so reading them as UTC loses nothing.
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_credentials' AND column_name = 'created_at') = 'timestamp without time zone' THEN
    ALTER TABLE user_credentials ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
  END IF;

  -- Tables left by the retired TypeScript schema: no migration creates them and nothing reads or writes them. Each
  -- goes only if empty, so no data can be lost.
  FOREACH legacy IN ARRAY ARRAY['kyc_documents', 'pep_screening', 'wallet_deployment_errors']
  LOOP
    CONTINUE WHEN to_regclass(legacy) IS NULL;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', legacy) INTO has_rows;
    IF has_rows THEN
      RAISE WARNING 'legacy table % still holds rows — left in place', legacy;
    ELSE
      BEGIN
        EXECUTE format('DROP TABLE %I', legacy);
      EXCEPTION WHEN dependent_objects_still_exist THEN
        RAISE WARNING 'legacy table % is still referenced by other objects — left in place', legacy;
      END;
    END IF;
  END LOOP;
END $$;
