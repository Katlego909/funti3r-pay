import { getPostgres } from '../postgres.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:Migrations');

export async function runInitialMigrations() {
  try {
    logger.info('Running migrations...');
    logger.info('Migrations handled by services/database/migrations/001_clean_schema.sql');
    return; // Skip schema.ts migrations, use clean schema instead
  } catch (err) {
    logger.error('Migration error', { error: String(err) });
    throw err;
  }
}
