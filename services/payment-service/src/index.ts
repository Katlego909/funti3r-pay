import express, { Request, Response } from 'express';
import { initPostgres, query } from '@funti3r/database';
import { createLogger, verifyToken } from '@funti3r/shared-utils';
import * as stellar from './stellar.js';
import { addLog, getLogs, getLogsSummary, clearLogs } from './logs.js';

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
// Stellar Integration Endpoints
// ──────────────────────────────────────────────────────────────────────────

app.post('/payments/:paymentId/submit', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { paymentId } = req.params;

  logger.info('[Payment] Submitting payment to Stellar', { paymentId, userId, role });
  addLog('info', 'Payment', 'Payment submission initiated', { paymentId, role });

  try {
    // Get payment with enterprise details
    logger.info('[Payment] Loading payment from database', { paymentId });
    const paymentResult = await query(
      `SELECT p.*, e.user_id as enterprise_user_id, e.wallet_address
       FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id
       WHERE p.id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      logger.warn('[Payment] Payment not found', { paymentId });
      addLog('warn', 'Payment', 'Payment not found', { paymentId });
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];
    logger.info('[Payment] Payment loaded', {
      paymentId,
      status: payment.status,
      amount: payment.amount,
      destination: payment.stellar_destination,
    });

    // Authorization
    if (role !== 'enterprise' || payment.enterprise_user_id !== userId) {
      logger.warn('[Payment] Unauthorized submission attempt', { paymentId, userId, enterpriseUserId: payment.enterprise_user_id });
      addLog('warn', 'Payment', 'Unauthorized submission', { paymentId });
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check if already submitted
    if (payment.status !== 'initiated') {
      logger.warn('[Payment] Payment not in initiated status', { paymentId, currentStatus: payment.status });
      addLog('warn', 'Payment', 'Payment already submitted', { paymentId, status: payment.status });
      return res.status(409).json({ error: `Payment already ${payment.status}` });
    }

    logger.info('[Payment] Authorization passed, ready for Stellar submission', { paymentId });

    // Get enterprise wallet (for signing)
    // NOTE: In production, this would come from secure vault
    // For now, log that actual submission would happen here
    const enterpriseWalletAddress = payment.wallet_address;

    if (!enterpriseWalletAddress) {
      logger.error('[Payment] Enterprise wallet address not configured', { paymentId });
      addLog('error', 'Payment', 'Enterprise wallet not configured', { paymentId });
      return res.status(400).json({ error: 'Enterprise wallet not configured' });
    }

    // Get enterprise's Stellar keypair for signing (from vault in production)
    logger.info('[Stellar] Loading enterprise signing credentials', { enterpriseId: payment.enterprise_id, paymentId });

    const enterpriseKeysResult = await query(
      'SELECT stellar_secret_key FROM enterprises WHERE id = $1',
      [payment.enterprise_id]
    );

    if (!enterpriseKeysResult.rows[0]?.stellar_secret_key) {
      logger.error('[Stellar] Enterprise signing key not found', { paymentId, enterpriseId: payment.enterprise_id });
      addLog('error', 'Stellar', 'Enterprise signing key missing', { paymentId });
      return res.status(400).json({ error: 'Enterprise signing key not configured' });
    }

    const enterpriseSecretKey = enterpriseKeysResult.rows[0].stellar_secret_key;

    logger.info('[Stellar] Building transaction using official SDK pattern', {
      paymentId,
      destination: payment.stellar_destination,
      amount: payment.amount,
      currency: payment.currency,
    });

    addLog('info', 'Stellar', 'Building payment transaction', {
      paymentId,
      destination: payment.stellar_destination,
      amount: payment.amount,
    });

    try {
      // Build transaction using official Stellar SDK pattern
      const txXdr = await stellar.buildPaymentTransaction({
        sourceSecret: enterpriseSecretKey,
        destinationAddress: payment.stellar_destination,
        amount: payment.amount,
        currency: payment.currency,
        memo: `Payment-${paymentId.substring(0, 8)}`,
      });

      logger.info('[Stellar] Transaction built successfully, submitting to network', {
        paymentId,
        xdrLength: txXdr.length,
      });

      addLog('info', 'Stellar', 'Transaction built, submitting to Horizon', {
        paymentId,
        xdrLength: txXdr.length,
      });

      // Submit transaction to Stellar network
      const result = await stellar.submitTransaction(txXdr);

      logger.info('[Stellar] Transaction submitted successfully', {
        paymentId,
        txHash: result.txHash,
        status: result.status,
      });

      addLog('info', 'Stellar', 'Transaction submitted to network', {
        paymentId,
        txHash: result.txHash,
        ledger: result.xdr ? 'pending' : 'unknown',
      });

      // Update payment with transaction hash
      await query(
        `UPDATE payments
         SET status = $1, stellar_tx_hash = $2, submitted_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        ['submitted', result.txHash, paymentId]
      );

      logger.info('[Payment] Payment status updated to submitted', {
        paymentId,
        txHash: result.txHash,
        nextStep: 'Monitor confirmation via GET /payments/:id/stellar-status',
      });

      addLog('info', 'Payment', 'Payment submitted to Stellar network', {
        paymentId,
        txHash: result.txHash,
        status: 'submitted',
      });

      res.json({
        id: paymentId,
        status: 'submitted',
        stellarTxHash: result.txHash,
        message: 'Payment submitted to Stellar network. Monitor status via GET /payments/:id/stellar-status',
        nextStep: 'Track confirmation using GET endpoint',
      });
    } catch (stellarErr) {
      logger.error('[Stellar] Transaction submission failed', {
        paymentId,
        error: String(stellarErr),
        errorType: stellarErr instanceof Error ? stellarErr.constructor.name : 'Unknown',
        destination: payment.stellar_destination,
        amount: payment.amount,
      });

      addLog('error', 'Stellar', 'Transaction submission failed', {
        paymentId,
        error: String(stellarErr),
      });

      // Mark payment as failed in database
      try {
        await query(
          `UPDATE payments
           SET status = $1, failed_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          ['failed', paymentId]
        );
        logger.info('[Payment] Payment marked as failed due to Stellar error', { paymentId });
      } catch (dbErr) {
        logger.error('[Payment] Failed to mark payment as failed', { paymentId, error: String(dbErr) });
      }

      res.status(500).json({
        error: 'Failed to submit payment to Stellar network',
        details: String(stellarErr),
      });
    }
  } catch (err) {
    logger.error('[Payment] Failed to submit payment', {
      paymentId,
      error: String(err),
      errorType: err instanceof Error ? err.constructor.name : 'Unknown',
    });

    addLog('error', 'Payment', 'Submission failed', {
      paymentId,
      error: String(err),
    });

    // Update payment status to failed
    try {
      await query(
        `UPDATE payments
         SET status = $1, failed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        ['failed', paymentId]
      );
      logger.info('[Payment] Payment marked as failed', { paymentId });
    } catch (dbErr) {
      logger.error('[Payment] Failed to mark payment as failed', { paymentId, error: String(dbErr) });
    }

    res.status(500).json({ error: 'Failed to submit payment', details: String(err) });
  }
});

app.post('/payments/:paymentId/confirm-stellar', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { paymentId } = req.params;
  const { signedXdr } = req.body;

  if (!signedXdr) {
    logger.warn('[Payment] Missing signedXdr in request', { paymentId });
    return res.status(400).json({ error: 'signedXdr is required' });
  }

  logger.info('[Payment] Confirming Stellar transaction', {
    paymentId,
    userId,
    role,
    xdrLength: signedXdr.length,
  });

  try {
    // Get payment
    const paymentResult = await query(
      `SELECT p.*, e.user_id as enterprise_user_id FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id WHERE p.id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      logger.warn('[Payment] Payment not found', { paymentId });
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];

    // Authorization
    if (role !== 'enterprise' || payment.enterprise_user_id !== userId) {
      logger.warn('[Payment] Unauthorized confirmation', { paymentId, userId });
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (payment.status !== 'pending_signature') {
      logger.warn('[Payment] Payment not pending signature', { paymentId, status: payment.status });
      return res.status(409).json({ error: 'Payment not pending signature' });
    }

    logger.info('[Stellar] Submitting signed transaction', { paymentId });

    try {
      const result = await stellar.submitTransaction(signedXdr);

      logger.info('[Stellar] Transaction submitted successfully', {
        paymentId,
        txHash: result.txHash,
      });

      // Update payment with tx hash
      await query(
        'UPDATE payments SET status = $1, stellar_tx_hash = $2, submitted_at = NOW(), updated_at = NOW() WHERE id = $3',
        ['submitted', result.txHash, paymentId]
      );

      logger.info('[Payment] Payment status updated to submitted', {
        paymentId,
        txHash: result.txHash,
      });

      res.json({
        id: paymentId,
        status: 'submitted',
        stellarTxHash: result.txHash,
        message: 'Payment submitted to Stellar network',
      });
    } catch (stellarErr) {
      logger.error('[Stellar] Transaction submission failed', {
        paymentId,
        error: String(stellarErr),
      });

      // Update payment status to failed
      await query(
        'UPDATE payments SET status = $1, failed_at = NOW(), updated_at = NOW() WHERE id = $2',
        ['failed', paymentId]
      );

      logger.info('[Payment] Payment marked as failed', { paymentId });

      res.status(400).json({
        error: 'Failed to submit to Stellar',
        details: String(stellarErr),
      });
    }
  } catch (err) {
    logger.error('[Payment] Failed to process Stellar confirmation', {
      paymentId,
      error: String(err),
    });
    res.status(500).json({ error: 'Failed to process confirmation' });
  }
});

app.get('/payments/:paymentId/stellar-status', requireAuth, async (req: Request, res: Response) => {
  const { userId, role } = req as any;
  const { paymentId } = req.params;

  logger.info('[Stellar:Confirmation] Checking transaction status', { paymentId, userId, role });
  addLog('info', 'Stellar', 'Confirmation status check initiated', { paymentId });

  try {
    // Get payment
    const paymentResult = await query(
      `SELECT p.*, e.user_id as enterprise_user_id FROM payments p
       JOIN enterprises e ON p.enterprise_id = e.id WHERE p.id = $1`,
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      logger.warn('[Stellar:Confirmation] Payment not found', { paymentId });
      addLog('warn', 'Stellar', 'Payment not found for status check', { paymentId });
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];

    // Authorization
    if (
      (role === 'enterprise' && payment.enterprise_user_id !== userId) ||
      (role === 'worker' && payment.worker_id !== userId)
    ) {
      logger.warn('[Stellar:Confirmation] Unauthorized status check', { paymentId, userId, enterpriseUserId: payment.enterprise_user_id });
      addLog('warn', 'Stellar', 'Unauthorized confirmation status check', { paymentId });
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!payment.stellar_tx_hash) {
      logger.info('[Stellar:Confirmation] No transaction hash - payment not submitted yet', {
        paymentId,
        status: payment.status,
      });
      addLog('info', 'Stellar', 'Payment awaiting submission', { paymentId, status: payment.status });
      return res.json({
        paymentId,
        status: payment.status,
        stellarStatus: 'not_submitted',
        message: 'Payment not yet submitted to Stellar network',
      });
    }

    logger.info('[Stellar:Confirmation] Polling Horizon for transaction status', {
      txHash: payment.stellar_tx_hash,
      paymentId,
    });

    addLog('info', 'Stellar', 'Polling Horizon for confirmation', {
      paymentId,
      txHash: payment.stellar_tx_hash,
    });

    const stellarStatus = await stellar.getTransactionStatus(payment.stellar_tx_hash);

    logger.info('[Stellar:Confirmation] Transaction status retrieved from Horizon', {
      txHash: payment.stellar_tx_hash,
      status: stellarStatus.status,
      ledger: stellarStatus.ledger,
      resultCode: stellarStatus.resultCode,
      timestamp: stellarStatus.timestamp,
      paymentId,
    });

    addLog('info', 'Stellar', 'Transaction status from Horizon', {
      paymentId,
      txHash: payment.stellar_tx_hash,
      status: stellarStatus.status,
      ledger: stellarStatus.ledger,
    });

    // Update payment status if confirmed
    if (stellarStatus.status === 'confirmed' && payment.status !== 'completed') {
      logger.info('[Stellar:Confirmation] Transaction confirmed, updating payment status', {
        paymentId,
        txHash: payment.stellar_tx_hash,
        ledger: stellarStatus.ledger,
        resultCode: stellarStatus.resultCode,
      });

      await query(
        `UPDATE payments
         SET status = $1, completed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        ['completed', paymentId]
      );

      logger.info('[Payment] Payment completed successfully', {
        paymentId,
        txHash: payment.stellar_tx_hash,
        ledger: stellarStatus.ledger,
      });

      addLog('info', 'Payment', 'Payment completed', {
        paymentId,
        txHash: payment.stellar_tx_hash,
        ledger: stellarStatus.ledger,
      });
    } else if (stellarStatus.status === 'failed') {
      logger.warn('[Stellar:Confirmation] Transaction failed', {
        paymentId,
        txHash: payment.stellar_tx_hash,
        resultCode: stellarStatus.resultCode,
      });

      addLog('warn', 'Stellar', 'Transaction failed on network', {
        paymentId,
        txHash: payment.stellar_tx_hash,
        resultCode: stellarStatus.resultCode,
      });

      // Update payment status to failed
      if (payment.status !== 'failed') {
        await query(
          `UPDATE payments
           SET status = $1, failed_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          ['failed', paymentId]
        );

        logger.info('[Payment] Payment marked as failed due to Stellar transaction failure', {
          paymentId,
          resultCode: stellarStatus.resultCode,
        });
      }
    }

    res.json({
      paymentId,
      status: payment.status,
      stellarStatus: stellarStatus.status,
      stellarTxHash: payment.stellar_tx_hash,
      stellarLedger: stellarStatus.ledger,
      stellarTimestamp: stellarStatus.timestamp,
      stellarResultCode: stellarStatus.resultCode,
      message: stellarStatus.status === 'confirmed' ? 'Payment confirmed on Stellar network' : 'Payment pending confirmation',
    });
  } catch (err) {
    logger.error('[Stellar:Confirmation] Failed to check transaction status', {
      paymentId,
      error: String(err),
      errorType: err instanceof Error ? err.constructor.name : 'Unknown',
    });

    addLog('error', 'Stellar', 'Failed to check confirmation status', {
      paymentId,
      error: String(err),
    });

    res.status(500).json({ error: 'Failed to check Stellar transaction status' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Health & Info
// ──────────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'payment-service', uptime: process.uptime() });
});

app.get('/health/stellar', async (_req: Request, res: Response) => {
  logger.info('[Health] Checking Stellar connectivity');

  try {
    const isConnected = await stellar.testConnection();

    if (isConnected) {
      logger.info('[Health] Stellar connection OK');
      res.json({
        status: 'healthy',
        service: 'payment-service',
        stellar: 'connected',
      });
    } else {
      logger.warn('[Health] Stellar connection failed');
      res.status(503).json({
        status: 'degraded',
        service: 'payment-service',
        stellar: 'disconnected',
      });
    }
  } catch (err) {
    logger.error('[Health] Error checking Stellar connection', { error: String(err) });
    res.status(503).json({
      status: 'degraded',
      service: 'payment-service',
      stellar: 'error',
      error: String(err),
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Logging & Monitoring Endpoints
// ──────────────────────────────────────────────────────────────────────────

app.get('/logs', (_req: Request, res: Response) => {
  const { paymentId, component, level, limit } = _req.query;

  const options: any = {};
  if (paymentId) options.paymentId = paymentId;
  if (component) options.component = component;
  if (level) options.level = level;
  if (limit) options.limit = parseInt(limit as string);

  const logs = getLogs(options);

  res.json({
    count: logs.length,
    logs,
  });
});

app.get('/logs/summary', (_req: Request, res: Response) => {
  const summary = getLogsSummary();
  res.json(summary);
});

app.get('/logs/payment/:paymentId', (_req: Request, res: Response) => {
  const { paymentId } = _req.params;

  const logs = getLogs({ paymentId, limit: 100 });

  res.json({
    paymentId,
    count: logs.length,
    logs,
  });
});

app.post('/logs/clear', (_req: Request, res: Response) => {
  clearLogs();
  res.json({ message: 'Logs cleared' });
});

// ──────────────────────────────────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────────────────────────────────

async function start() {
  try {
    logger.info('[StartUp] Initializing Payment Service');

    // Initialize PostgreSQL
    logger.info('[StartUp] Connecting to PostgreSQL');
    await initPostgres();
    logger.info('[StartUp] ✓ PostgreSQL connected');
    addLog('info', 'startup', 'PostgreSQL connected');

    // Test Stellar connectivity
    logger.info('[StartUp] Testing Stellar network connectivity');
    const stellarConnected = await stellar.testConnection();
    if (stellarConnected) {
      logger.info('[StartUp] ✓ Stellar network connected');
      addLog('info', 'startup', 'Stellar network connected');
    } else {
      logger.warn('[StartUp] ⚠ Stellar network NOT connected (will retry on first payment)');
      addLog('warn', 'startup', 'Stellar network connection failed');
    }

    // Start HTTP server
    logger.info('[StartUp] Starting HTTP server on port', { port: PORT });
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`[StartUp] ✓ Payment Service running on port ${PORT}`);
      addLog('info', 'startup', `Payment Service listening on port ${PORT}`);
      console.log('');
      console.log('╔════════════════════════════════════════════════════════╗');
      console.log('║         Funti3r-Pay Payment Service Started            ║');
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log(`║ Port: ${PORT}                                              ║`);
      console.log(`║ Database: ✓ Connected                                  ║`);
      console.log(`║ Stellar: ${stellarConnected ? '✓ Connected' : '⚠ Pending'}                                  ║`);
      console.log('╠════════════════════════════════════════════════════════╣');
      console.log('║ Available Endpoints:                                   ║');
      console.log('║ - POST   /payments (create payment)                    ║');
      console.log('║ - GET    /payments (list payments)                     ║');
      console.log('║ - GET    /payments/:id (get payment)                   ║');
      console.log('║ - POST   /payments/:id/submit (to Stellar)             ║');
      console.log('║ - POST   /payments/:id/confirm-stellar (with sig)      ║');
      console.log('║ - GET    /payments/:id/stellar-status (check tx)       ║');
      console.log('║ - GET    /health (service health)                      ║');
      console.log('║ - GET    /health/stellar (Stellar connectivity)        ║');
      console.log('║ - GET    /logs (view all logs)                         ║');
      console.log('║ - GET    /logs/summary (log summary)                   ║');
      console.log('║ - GET    /logs/payment/:id (payment logs)              ║');
      console.log('╚════════════════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (err) {
    logger.error('[StartUp] Failed to start Payment Service', { error: String(err) });
    addLog('error', 'startup', `Startup failed: ${String(err)}`);
    console.error('');
    console.error('❌ Payment Service startup FAILED');
    console.error(String(err));
    console.error('');
    process.exit(1);
  }
}

start();
