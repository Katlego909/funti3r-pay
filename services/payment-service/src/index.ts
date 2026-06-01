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
    try {
      await initPostgres();
      logger.info('PostgreSQL connected');
    } catch (error) {
      logger.warn('PostgreSQL unavailable', { error: String(error) });
    }

    try {
      await initRedis();
      logger.info('Redis connected');
    } catch (error) {
      logger.warn('Redis unavailable', { error: String(error) });
    }

    const PORT = parseInt(process.env.PAYMENT_SERVICE_PORT || '3002', 10);
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Payment Service started on port ${PORT}`);
    });

    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} already in use`);
        process.exit(1);
      } else {
        logger.error('Server error', { error: String(error) });
        process.exit(1);
      }
    });
  } catch (error) {
    logger.error('Failed to start Payment Service', { error: String(error) });
    process.exit(1);
  }
}

start();
