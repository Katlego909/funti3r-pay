import { createLogger, assertInternalAuthConfigured } from '@funti3r/shared-utils';
import { initPostgres, query, transaction, tryWithAdvisoryLock } from '@funti3r/database';
import { createApp } from './app.js';
import { createSanctionsService } from './sanctions/service.js';
import { sealExistingRecords } from './sealExisting.js';

const logger = createLogger('ComplianceService');

/**
 * COMPLIANCE_AUTO_APPROVE=true (testnet) marks every KYC submission as approved
 * immediately and reports any user as verified. Set false to require review.
 */
const AUTO_APPROVE = process.env.COMPLIANCE_AUTO_APPROVE === 'true';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps the sanctions list current: a refresh shortly after boot when none is loaded yet or the loaded
 * one is over a day old, then daily. SANCTIONS_REFRESH=false turns it off (offline dev, tests).
 * A failed download is logged and the list in use stays as it was.
 */
function scheduleSanctionsRefresh(sanctions: Awaited<ReturnType<typeof createSanctionsService>>) {
  if (process.env.SANCTIONS_REFRESH === 'false') return;
  // One instance refreshes per tick; the others skip it.
  const run = () => tryWithAdvisoryLock('job:sanctionsRefresh', () => sanctions.refresh())
    .catch((err) => logger.error('Scheduled sanctions refresh failed', { error: String(err) }));
  sanctions.status()
    .then((meta) => {
      const stale = !meta || Date.now() - new Date(meta.fetchedAt).getTime() > DAY_MS;
      if (stale) setTimeout(run, 5_000);
    })
    .catch(() => {});
  setInterval(run, DAY_MS).unref();
}

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');
    const sealed = await sealExistingRecords(query);
    if (sealed) logger.info('Encrypted existing KYC records', { sealed });
  } catch (err) {
    logger.warn('PostgreSQL unavailable at startup', { error: String(err) });
  }

  const sanctions = await createSanctionsService(query);
  scheduleSanctionsRefresh(sanctions);

  const validityDays = Number(process.env.KYC_VALIDITY_DAYS) || undefined;
  const app = createApp({
    query, autoApprove: AUTO_APPROVE, sanctions, validityDays,
    inTransaction: (fn) => transaction((client) => fn((sql, params) => client.query(sql, params))),
  });
  const PORT = parseInt(process.env.COMPLIANCE_SERVICE_PORT || '3003', 10);
  assertInternalAuthConfigured();
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Compliance Service running on port ${PORT}${AUTO_APPROVE ? ' [AUTO-APPROVE MODE]' : ''}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
