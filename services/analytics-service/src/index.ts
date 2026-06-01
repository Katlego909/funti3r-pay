import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initMongoDB } from '@funti3r/database';

const logger = createLogger('AnalyticsService');

const app = express();
app.use(express.json());

// Placeholder for analytics service endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'analytics-service' });
});

async function start() {
  try {
    await initMongoDB();

    const PORT = process.env.ANALYTICS_SERVICE_PORT || 3004;
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Analytics Service started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start Analytics Service', { error: String(error) });
    process.exit(1);
  }
}

start();
