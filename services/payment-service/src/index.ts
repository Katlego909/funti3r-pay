import express, { Request, Response } from 'express';
import { initPostgres, query } from '@funti3r/database';
import { createLogger, verifyToken } from '@funti3r/shared-utils';

const logger = createLogger('PaymentService');
const app = express();
const PORT = parseInt(process.env.PAYMENT_PORT || '3002', 10);

app.use(express.json());

// ──────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────

function getAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

function requireAuth(req: Request, res: Response, next: Function): void {
  const token = getAuthToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  try {
    const payload = verifyToken(token);
    (req as any).userId = payload.userId;
    (req as any).role = payload.role;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Payment Endpoints
// ──────────────────────────────────────────────────────────────────────────

app.post('/payments', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { workerId, amount, currency = 'XLM', description, referenceId } = req.body;

  if (!workerId || !amount) {
    return res.status(400).json({ error: 'workerId and amount are required' });
  }

  if (role !== 'enterprise') {
    return res.status(403).json({ error: 'Only enterprises can initiate payments' });
  }

  try {
    // Get enterprise
    const enterpriseResult = await query(
      'SELECT id FROM enterprises WHERE user_id = $1',
      [userId]
    );

    if (enterpriseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Enterprise not found' });
    }

    const enterpriseId = enterpriseResult.rows[0].id;

    // Get worker's Stellar account
    const workerResult = await query(
      'SELECT stellar_public_key FROM users WHERE id = $1 AND role = $2',
      [workerId, 'worker']
    );

    if (workerResult.rows.length === 0 || !workerResult.rows[0].stellar_public_key) {
      return res.status(404).json({ error: 'Worker Stellar account not found' });
    }

    const stellarDestination = workerResult.rows[0].stellar_public_key;

    // Create payment record
    const paymentResult = await query(
      `INSERT INTO payments (enterprise_id, worker_id, amount, currency, stellar_destination, description, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, created_at`,
      [enterpriseId, workerId, amount, currency, stellarDestination, description || null, referenceId || null]
    );

    const payment = paymentResult.rows[0];
    logger.info('Payment initiated', { paymentId: payment.id, enterprise: enterpriseId, worker: workerId, amount });

    res.status(201).json({
      id: payment.id,
      status: payment.status,
      amount,
      currency,
      workerId,
      createdAt: payment.created_at,
    });
  } catch (err) {
    logger.error('Failed to initiate payment', { error: String(err) });
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

app.get('/payments', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { status, limit = '50', offset = '0' } = req.query;

  try {
    let whereClause = '';
    let params: any[] = [];

    if (role === 'enterprise') {
      whereClause = 'WHERE e.user_id = $1';
      params.push(userId);
    } else if (role === 'worker') {
      whereClause = 'WHERE p.worker_id = $1';
      params.push(userId);
    } else {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (status) {
      whereClause += ` AND p.status = $${params.length + 1}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id
       ${whereClause}`,
      params
    );

    const total = parseInt(countResult.rows[0].total, 10);

    const result = await query(
      `SELECT p.id, p.status, p.amount, p.currency, p.worker_id, p.stellar_tx_hash, p.created_at, p.completed_at
       FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit as string), parseInt(offset as string)]
    );

    res.json({
      payments: result.rows.map(p => ({
        id: p.id,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        workerId: p.worker_id,
        stellarTxHash: p.stellar_tx_hash,
        createdAt: p.created_at,
        completedAt: p.completed_at,
      })),
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (err) {
    logger.error('Failed to fetch payments', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Alias: /payouts → /payments
app.get('/payouts', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { status, limit = '50', offset = '0' } = req.query;

  try {
    let whereClause = '';
    let params: any[] = [];

    if (role === 'enterprise') {
      whereClause = 'WHERE e.user_id = $1';
      params.push(userId);
    } else if (role === 'worker') {
      whereClause = 'WHERE p.worker_id = $1';
      params.push(userId);
    } else {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (status) {
      whereClause += ` AND p.status = $${params.length + 1}`;
      params.push(status);
    }

    const countResult = await query(
      `SELECT COUNT(*) as total FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id
       ${whereClause}`,
      params
    );

    const total = parseInt(countResult.rows[0].total, 10);

    const result = await query(
      `SELECT p.id, p.status, p.amount, p.currency, p.worker_id, p.stellar_tx_hash, p.created_at, p.completed_at
       FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit as string), parseInt(offset as string)]
    );

    res.json({
      payments: result.rows.map(p => ({
        id: p.id,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        workerId: p.worker_id,
        stellarTxHash: p.stellar_tx_hash,
        createdAt: p.created_at,
        completedAt: p.completed_at,
      })),
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (err) {
    logger.error('Failed to fetch payouts', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

app.get('/payments/:paymentId', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { paymentId } = req.params;

  try {
    const result = await query(
      `SELECT p.*, e.user_id as enterprise_user_id
       FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id
       WHERE p.id = $1`,
      [paymentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = result.rows[0];

    // Check authorization
    if (role === 'enterprise' && payment.enterprise_user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (role === 'worker' && payment.worker_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      workerId: payment.worker_id,
      stellarDestination: payment.stellar_destination,
      stellarTxHash: payment.stellar_tx_hash,
      description: payment.description,
      referenceId: payment.reference_id,
      createdAt: payment.created_at,
      submittedAt: payment.submitted_at,
      completedAt: payment.completed_at,
      failedAt: payment.failed_at,
    });
  } catch (err) {
    logger.error('Failed to fetch payment', { paymentId, error: String(err) });
    res.status(500).json({ error: 'Failed to fetch payment' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Wallet Endpoint (for workers to view their wallet)
// ──────────────────────────────────────────────────────────────────────────

app.get('/wallets/:userId', requireAuth, async (req: Request, res: Response) => {
  const { userId: requesterId } = req as any;
  const { userId } = req.params;

  if (requesterId !== userId) {
    return res.status(403).json({ error: 'Not authorized to view this wallet' });
  }

  try {
    const userResult = await query(
      'SELECT id, stellar_public_key, role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    if (user.role !== 'worker') {
      return res.status(400).json({ error: 'Only workers have Stellar wallets' });
    }

    if (!user.stellar_public_key) {
      return res.status(500).json({ error: 'Stellar account not initialized' });
    }

    res.json({
      userId: user.id,
      walletType: 'worker',
      stellarPublicKey: user.stellar_public_key,
    });
  } catch (err) {
    logger.error('Failed to fetch wallet', { userId, error: String(err) });
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Health & Info
// ──────────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'payment-service', uptime: process.uptime() });
});

// ──────────────────────────────────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Payment Service running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start', { error: String(err) });
    process.exit(1);
  }
}

start();
