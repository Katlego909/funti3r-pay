// Applies every pending SQL migration (services/database/migrations) to DATABASE_URL, then exits.
// The services do the same at boot; this is for running it deliberately: before a deploy, or in CI against a
// fresh database to prove the whole migration history still applies cleanly.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@funti3r/shared-utils';
import { closePostgres, initPostgres } from '../postgres.js';
import { runInitialMigrations } from './schema.js';

const logger = createLogger('Migrations');

async function main() {
  await initPostgres();
  const here = dirname(fileURLToPath(import.meta.url));
  await runInitialMigrations(join(here, '../../../../services/database/migrations'));
  await closePostgres();
}

main().catch((error) => {
  logger.error('Migration failed', { error: String(error) });
  process.exit(1);
});
