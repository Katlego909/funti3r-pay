import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createLogger, assertInternalAuthConfigured, installProcessHandlers, stellarNetwork } from '@funti3r/shared-utils';
import { initPostgres, initRedis, runInitialMigrations } from '@funti3r/database';
import { startScheduler } from './scheduler.js';
import app from './app.js';

const logger = createLogger('PaymentService');
installProcessHandlers(logger);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  await initPostgres();
  logger.info('PostgreSQL connected');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  await runInitialMigrations(join(__dirname, '../../database/migrations'));
  await initRedis();
  logger.info('Redis connected');

  startScheduler();

  const PORT = parseInt(process.env.PAYMENT_SERVICE_PORT || '3002', 10);
  assertInternalAuthConfigured();
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Payment Service running on port ${PORT}`, { stellarNetwork: stellarNetwork().name });
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
