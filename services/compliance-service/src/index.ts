import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, query } from '@funti3r/database';
import { createApp } from './app.js';
import { sealExistingRecords } from './sealExisting.js';

const logger = createLogger('ComplianceService');

/**
 * COMPLIANCE_AUTO_APPROVE=true (testnet) marks every KYC submission as approved
 * immediately and reports any user as verified. Set false to require review.
 */
const AUTO_APPROVE = process.env.COMPLIANCE_AUTO_APPROVE === 'true';

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');
    const sealed = await sealExistingRecords(query);
    if (sealed) logger.info('Encrypted existing KYC records', { sealed });
  } catch (err) {
    logger.warn('PostgreSQL unavailable at startup', { error: String(err) });
  }

  const app = createApp({ query, autoApprove: AUTO_APPROVE });
  const PORT = parseInt(process.env.COMPLIANCE_SERVICE_PORT || '3003', 10);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Compliance Service running on port ${PORT}${AUTO_APPROVE ? ' [AUTO-APPROVE MODE]' : ''}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
