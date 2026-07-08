import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cron from 'node-cron';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, runInitialMigrations, query } from '@funti3r/database';

const logger = createLogger('AnalyticsService');
const app = express();
app.use(express.json());

/** Parses a query-string value as a non-negative integer, or null if invalid. */
function parseIntParam(value: unknown, max?: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return max !== undefined ? Math.min(n, max) : n;
}

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
 *
 * Not yet wired up to any caller — when it is, callers must treat this as
 * fire-and-forget (don't await it on a payment/auth critical path); a slow or
 * down analytics-service must never block a real request.
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
    await query(
      `INSERT INTO events (type, user_id, data, timestamp, received_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [type, userId ?? null, data ?? {}, timestamp ? new Date(timestamp) : new Date()],
    );

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
  const days = parseIntParam(req.query.days ?? 30, 365);
  if (days === null) {
    return res.status(400).json({ error: 'days must be a non-negative integer' });
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'user.registered')  AS registrations,
         COUNT(*) FILTER (WHERE type = 'payment.completed') AS payments_completed,
         COUNT(*) FILTER (WHERE type = 'payment.failed')    AS payments_failed,
         COUNT(*) FILTER (WHERE type = 'user.login')        AS login_count
       FROM events
       WHERE timestamp >= $1`,
      [since],
    );

    const row = result.rows[0];
    const registrations = Number(row.registrations);
    const paymentsCompleted = Number(row.payments_completed);
    const paymentsFailed = Number(row.payments_failed);
    const loginCount = Number(row.login_count);

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
  const limitNum = parseIntParam(limit, 100);
  const offsetNum = parseIntParam(offset);
  if (limitNum === null || offsetNum === null) {
    return res.status(400).json({ error: 'limit and offset must be non-negative integers' });
  }

  try {
    const result = await query(
      `SELECT id, type, user_id, data, timestamp, received_at, COUNT(*) OVER() AS total
         FROM events
        WHERE ($1::varchar IS NULL OR type = $1)
          AND ($2::uuid IS NULL OR user_id = $2)
        ORDER BY timestamp DESC
        LIMIT $3 OFFSET $4`,
      [type ? String(type) : null, userId ? String(userId) : null, limitNum, offsetNum],
    );

    const total = result.rows.length > 0 ? Number(result.rows[0].total) : 0;
    const events = result.rows.map(({ total: _total, ...rest }) => rest);

    res.json({ events, total });
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
  const daysNum = parseIntParam(days);
  if (daysNum === null) {
    return res.status(400).json({ error: 'days must be a non-negative integer' });
  }
  const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);
  const truncUnit = granularity === 'hour' ? 'hour' : 'day';

  try {
    const result = await query(
      `SELECT date_trunc($1, timestamp) AS bucket, COUNT(*) AS count
         FROM events
        WHERE timestamp >= $2
          AND ($3::varchar IS NULL OR type = $3)
        GROUP BY bucket
        ORDER BY bucket ASC`,
      [truncUnit, since, type ? String(type) : null],
    );

    const series = result.rows.map((r) => ({ timestamp: r.bucket, count: Number(r.count) }));

    res.json({ series, granularity: truncUnit, type: type ?? 'all' });
  } catch (err) {
    logger.error('Timeseries failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Partition maintenance ─────────────────────────────────────────────────────
// events is RANGE-partitioned by month (see migrations/008_analytics_events.sql).
// This keeps future partitions provisioned ahead of time; the migration's
// `events_default` partition is the safety net if this ever falls behind.

async function ensureFuturePartitions(monthsAhead = 3): Promise<void> {
  const now = new Date();
  for (let i = 0; i < monthsAhead; i++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const suffix = `${start.getUTCFullYear()}m${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    await query(
      `CREATE TABLE IF NOT EXISTS events_y${suffix} PARTITION OF events
       FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')`,
    );
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  await initPostgres();
  logger.info('PostgreSQL connected');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  await runInitialMigrations(join(__dirname, '../../database/migrations'));

  await ensureFuturePartitions();
  cron.schedule('0 0 1 * *', () => {
    ensureFuturePartitions().catch((err) => logger.error('Partition maintenance failed', { error: String(err) }));
  });

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
