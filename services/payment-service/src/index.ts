import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, initRedis } from '@funti3r/database';

const logger = createLogger('PaymentService');

const app = express();
app.use(express.json());

// Placeholder for payment service endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'payment-service' });
});

async function start() {
  try {
    await initPostgres();
    await initRedis();

    const PORT = parseInt(process.env.PAYMENT_SERVICE_PORT || '3002', 10);
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Payment Service started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start Payment Service', { error: String(error) });
    process.exit(1);
  }
}

start();
