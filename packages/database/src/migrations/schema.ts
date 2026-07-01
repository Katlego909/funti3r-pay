import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { query } from '../postgres.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:Migrations');

export async function runInitialMigrations(migrationsDir?: string) {
  if (!migrationsDir) {
    logger.info('No migrations directory provided — skipping migrations');
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await query('SELECT filename FROM _migrations')).rows.map((r: any) => r.filename as string),
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
    await query(sql);
    await query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    logger.info('Migration applied', { file });
  }
}
