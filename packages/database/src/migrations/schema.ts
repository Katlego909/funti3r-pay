import { getPostgres } from '../postgres.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:Migrations');

export async function runInitialMigrations() {
  const db = await getPostgres();

  try {
    logger.info('Running migrations...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         VARCHAR(255) NOT NULL UNIQUE,
        role          VARCHAR(20)  NOT NULL DEFAULT 'worker',
        status        VARCHAR(20)  NOT NULL DEFAULT 'active',
        country       VARCHAR(10),
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_credentials (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        credential_id   TEXT        NOT NULL UNIQUE,
        public_key      TEXT        NOT NULL,
        counter         BIGINT      NOT NULL DEFAULT 0,
        transports      TEXT[]      NOT NULL DEFAULT '{}',
        aaguid          VARCHAR(100),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id               UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        wallet_type           VARCHAR(20) NOT NULL DEFAULT 'worker',
        public_key            VARCHAR(100),
        encrypted_secret      TEXT,
        encryption_iv         VARCHAR(64),
        encryption_tag        VARCHAR(64),
        contract_address      VARCHAR(100),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key   VARCHAR(100) UNIQUE,
        enterprise_id     UUID         NOT NULL REFERENCES users(id),
        worker_id         UUID         NOT NULL REFERENCES users(id),
        amount            DECIMAL(18, 7) NOT NULL,
        currency          VARCHAR(10)  NOT NULL,
        status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
        payment_method    VARCHAR(30)  NOT NULL,
        rail              VARCHAR(30),
        stellar_tx_hash   VARCHAR(100),
        failure_reason    TEXT,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS kyc_records (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        status        VARCHAR(20) NOT NULL DEFAULT 'pending',
        id_type       VARCHAR(50),
        id_number     VARCHAR(100),
        date_of_birth DATE,
        country       VARCHAR(10),
        verified_at   TIMESTAMPTZ,
        expires_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID        NOT NULL,
        action     VARCHAR(100) NOT NULL,
        details    JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query('CREATE INDEX IF NOT EXISTS idx_payments_enterprise ON payments(enterprise_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_payments_worker    ON payments(worker_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_audit_user         ON audit_logs(user_id);');

    logger.info('Migrations completed.');
  } catch (error) {
    logger.error('Migration failed', { error: String(error) });
    throw error;
  }
}
