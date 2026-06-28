import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initMongoDB, getCollection } from '@funti3r/database';

const logger = createLogger('AnalyticsService');
const app = express();
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'analytics-service' });
});

// ── Event ingestion ───────────────────────────────────────────────────────────

/**
 * POST /events
 * Ingests a business event emitted by any other service.
 * Body: { type, userId?, data, timestamp? }
 *
 * Event types (non-exhaustive):
 *   user.registered, user.login
 *   payment.initiated, payment.completed, payment.failed
 *   kyc.submitted, kyc.approved, kyc.rejected
 */
app.post('/events', async (req, res) => {
  const { type, userId, data, timestamp } = req.body as {
    type: string;
    userId?: string;
    data?: Record<string, unknown>;
    timestamp?: string;
  };

  if (!type) return res.status(400).json({ error: 'event type is required' });

  try {
    const events = await getCollection('events');
    await events.insertOne({
      type,
      userId: userId ?? null,
      data: data ?? {},
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      receivedAt: new Date(),
    });

    res.status(201).json({ received: true });
  } catch (err) {
    logger.error('Event ingestion failed', { type, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Dashboard aggregates ──────────────────────────────────────────────────────

/**
 * GET /dashboard
 * Returns event-based aggregate stats for the last N days.
 */
app.get('/dashboard', async (req, res) => {
  const days = Math.min(Number(req.query.days ?? 30), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const events = await getCollection('events');

    const [registrations, paymentsCompleted, paymentsFailed, loginCount] = await Promise.all([
      events.countDocuments({ type: 'user.registered', timestamp: { $gte: since } }),
      events.countDocuments({ type: 'payment.completed', timestamp: { $gte: since } }),
      events.countDocuments({ type: 'payment.failed', timestamp: { $gte: since } }),
      events.countDocuments({ type: 'user.login', timestamp: { $gte: since } }),
    ]);

    const totalPayments = paymentsCompleted + paymentsFailed;
    const successRate = totalPayments > 0
      ? Math.round((paymentsCompleted / totalPayments) * 1000) / 10
      : 0;

    res.json({
      period: { days, since },
      registrations,
      paymentsCompleted,
      paymentsFailed,
      loginCount,
      paymentSuccessRate: successRate,
    });
  } catch (err) {
    logger.error('Dashboard aggregation failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /events?type=&userId=&limit=&offset=
 * Query the event stream with optional filters.
 */
app.get('/events', async (req, res) => {
  const { type, userId, limit = '20', offset = '0' } = req.query;
  const filter: Record<string, unknown> = {};
  if (type) filter['type'] = String(type);
  if (userId) filter['userId'] = String(userId);

  try {
    const events = await getCollection('events');
    const [docs, total] = await Promise.all([
      events
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(Number(offset))
        .limit(Math.min(Number(limit), 100))
        .toArray(),
      events.countDocuments(filter),
    ]);

    res.json({ events: docs, total });
  } catch (err) {
    logger.error('Event query failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /events/timeseries?type=&days=&granularity=day|hour
 * Returns a time-bucketed count of events for charting.
 */
app.get('/events/timeseries', async (req, res) => {
  const { type, days = '30', granularity = 'day' } = req.query;
  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = { timestamp: { $gte: since } };
  if (type) filter['type'] = String(type);

  const truncUnit = granularity === 'hour' ? 'hour' : 'day';

  try {
    const events = await getCollection('events');
    const series = await events
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              $dateTrunc: { date: '$timestamp', unit: truncUnit },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, timestamp: '$_id', count: 1 } },
      ])
      .toArray();

    res.json({ series, granularity: truncUnit, type: type ?? 'all' });
  } catch (err) {
    logger.error('Timeseries failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  await initMongoDB();
  logger.info('MongoDB connected');

  // Ensure index on common query fields
  const events = await getCollection('events');
  await events.createIndex({ type: 1, timestamp: -1 });
  await events.createIndex({ userId: 1, timestamp: -1 });

  const PORT = parseInt(process.env.ANALYTICS_SERVICE_PORT || '3004', 10);
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Analytics Service running on port ${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} already in use`, { port: PORT });
    } else {
      logger.error('Server error', { error: String(err) });
    }
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
