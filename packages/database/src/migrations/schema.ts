import { getPostgres } from '../postgres.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:Migrations');

export async function runInitialMigrations() {
  const db = await getPostgres();

  try {
    logger.info('Running migrations...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email                   VARCHAR(255) NOT NULL UNIQUE,
        role                    VARCHAR(20)  NOT NULL DEFAULT 'worker',
        status                  VARCHAR(20)  NOT NULL DEFAULT 'active',
        country                 VARCHAR(10),
        wallet_deployed_at      TIMESTAMPTZ,
        wallet_deployment_retries INT        NOT NULL DEFAULT 0,
        created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
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
        encryption_salt       VARCHAR(64),
        contract_address      VARCHAR(100),
        status                VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deployed_at           TIMESTAMPTZ,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                 UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        tier                    VARCHAR(10) NOT NULL DEFAULT 'tier1',
        status                  VARCHAR(20) NOT NULL DEFAULT 'pending',

        -- Identity (encrypted)
        full_name               VARCHAR(255),
        legal_name              VARCHAR(255),
        date_of_birth           DATE,
        nationality             VARCHAR(10),
        country_of_residence    VARCHAR(10),

        -- Government ID
        id_type                 VARCHAR(50),
        id_number               VARCHAR(100),
        id_issue_date           DATE,
        id_expiry_date          DATE,
        id_country              VARCHAR(10),

        -- Address (encrypted)
        street_address          VARCHAR(500),
        city                    VARCHAR(100),
        state_province          VARCHAR(100),
        postal_code             VARCHAR(20),
        country                 VARCHAR(10),

        -- Tax Information (encrypted)
        tax_id                  VARCHAR(100),
        tax_residency_country   VARCHAR(10),

        -- Bank Account (encrypted)
        bank_name               VARCHAR(255),
        account_holder_name     VARCHAR(255),
        account_number          VARCHAR(50),
        iban                    VARCHAR(50),
        swift_code              VARCHAR(20),
        currency                VARCHAR(10),

        -- Verification
        id_verified_at          TIMESTAMPTZ,
        address_verified_at     TIMESTAMPTZ,
        verified_at             TIMESTAMPTZ,
        verification_notes      TEXT,
        rejection_reason        TEXT,

        -- Metadata
        submitted_at            TIMESTAMPTZ,
        reviewed_at             TIMESTAMPTZ,
        reviewed_by             VARCHAR(100),
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS kyc_documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kyc_record_id UUID        NOT NULL REFERENCES kyc_records(id) ON DELETE CASCADE,
        document_type VARCHAR(50) NOT NULL,
        file_name     VARCHAR(255),
        file_hash     VARCHAR(100),
        s3_key        VARCHAR(500),
        verified      BOOLEAN     NOT NULL DEFAULT FALSE,
        verified_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS pep_screening (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kyc_id      UUID        NOT NULL REFERENCES kyc_records(id) ON DELETE CASCADE,
        status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        result      JSONB,
        screened_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    await db.query(`
      CREATE TABLE IF NOT EXISTS wallet_deployment_errors (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        error_message   TEXT        NOT NULL,
        error_stack     TEXT,
        retry_count     INT         NOT NULL DEFAULT 0,
        last_retry_at   TIMESTAMPTZ,
        resolved_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query('CREATE INDEX IF NOT EXISTS idx_payments_enterprise ON payments(enterprise_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_payments_worker    ON payments(worker_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_audit_user         ON audit_logs(user_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_wallets_user_type  ON wallets(user_id, wallet_type);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_wallet_errors_user ON wallet_deployment_errors(user_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_wallet_errors_resolved ON wallet_deployment_errors(resolved_at);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_kyc_status         ON kyc_records(status);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_kyc_tier           ON kyc_records(tier);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_kyc_docs           ON kyc_documents(kyc_record_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pep_kyc            ON pep_screening(kyc_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_pep_status         ON pep_screening(status);');

    logger.info('Migrations completed.');
  } catch (error) {
    logger.error('Migration failed', { error: String(error) });
    throw error;
  }
}
