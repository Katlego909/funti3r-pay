import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, initRedis, runInitialMigrations, query } from '@funti3r/database';
import { PaymentStatus } from '@funti3r/shared-types';
import * as stellar from './lib/stellar.js';
import { startScheduler } from './scheduler.js';
import app from './app.js';

const logger = createLogger('PaymentService');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrapStreaming() {
  try {
    const result = await query(
      'SELECT public_key FROM wallets WHERE wallet_type = $1 AND status = $2',
      ['enterprise', 'active'],
    );

    for (const wallet of result.rows) {
      stellar.streamEnterprisePayments(wallet.public_key, async (txHash: string) => {
        logger.info('Updating payment from Horizon stream', { txHash });
        await query(
          `UPDATE payments SET status = $1, updated_at = NOW() WHERE stellar_tx_hash = $2`,
          [PaymentStatus.COMPLETED, txHash],
        );
      }).catch((err) => {
        logger.error('Failed to bootstrap stream', { error: String(err) });
      });
    }

    logger.info('Horizon payment streaming bootstrapped', { walletCount: result.rows.length });
  } catch (err) {
    logger.error('Failed to bootstrap streaming', { error: String(err) });
  }
}

async function start() {
  await initPostgres();
  logger.info('PostgreSQL connected');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  await runInitialMigrations(join(__dirname, '../../database/migrations'));
  await initRedis();
  logger.info('Redis connected');

  // Bootstrap Horizon streaming for enterprise wallets
  await bootstrapStreaming();

  startScheduler();

  const PORT = parseInt(process.env.PAYMENT_SERVICE_PORT || '3002', 10);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Payment Service running on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
