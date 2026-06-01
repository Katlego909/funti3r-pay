import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres } from '@funti3r/database';

const logger = createLogger('UserService');

const app = express();
app.use(express.json());

// Placeholder for user service endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'user-service' });
});

async function start() {
  try {
    try {
      await initPostgres();
      logger.info('PostgreSQL connected');
    } catch (error) {
      logger.warn('PostgreSQL unavailable', { error: String(error) });
    }

    const PORT = parseInt(process.env.USER_SERVICE_PORT || '3001', 10);
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`User Service started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start User Service', { error: String(error) });
    process.exit(1);
  }
}

start();
