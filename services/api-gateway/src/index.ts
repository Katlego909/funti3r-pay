import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, initRedis, initMongoDB } from '@funti3r/database';

const logger = createLogger('APIGateway');

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Status endpoint with database checks
app.get('/status', async (req, res) => {
  try {
    // Check PostgreSQL
    await initPostgres();

    // Check Redis
    await initRedis();

    // Check MongoDB
    await initMongoDB();

    res.json({
      status: 'operational',
      services: {
        postgres: 'connected',
        redis: 'connected',
        mongodb: 'connected',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      error: String(error),
      timestamp: new Date().toISOString(),
    });
  }
});

// Initialize and start server
async function start() {
  try {
    // Initialize database connections
    await initPostgres();
    await initRedis();
    await initMongoDB();

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`API Gateway started on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start API Gateway', { error: String(error) });
    process.exit(1);
  }
}

start();
