import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getPostgres } from '../postgres.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:Migrations');

// Arbitrary fixed key: serializes migration application across services that
// each independently call runInitialMigrations() at boot. Without it, two
// services booting concurrently against a fresh DB can both see a file as
// unapplied and race to run non-idempotent DDL (001_clean_schema.sql has no
// IF NOT EXISTS) — the loser crashes, and since its failed run never reaches
// the _migrations insert, it keeps crashing on every restart.
const MIGRATION_LOCK_KEY = 847_291_003;

export async function runInitialMigrations(migrationsDir?: string) {
  if (!migrationsDir) {
    logger.info('No migrations directory provided — skipping migrations');
    return;
  }

  const pool = await getPostgres();
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM _migrations')).rows.map(
        (r: { filename: string }) => r.filename,
      ),
    );

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        logger.info('Migration already applied, skipping', { file });
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      logger.info('Applying migration', { file });

      // The SQL and its _migrations record must land atomically — otherwise
      // a crash between the two makes the file re-run on next boot and fail
      // against non-idempotent DDL.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      logger.info('Migration applied', { file });
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    client.release();
  }
}
