import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres } from '@funti3r/database';

const logger = createLogger('ComplianceService');

const app = express();
app.use(express.json());

// Placeholder for compliance service endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'compliance-service' });
});

async function start() {
  try {
    await initPostgres();

    const PORT = process.env.COMPLIANCE_SERVICE_PORT || 3003;
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Compliance Service started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start Compliance Service', { error: String(error) });
    process.exit(1);
  }
}

start();
