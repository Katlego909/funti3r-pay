import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, initRedis, query, transaction, runInitialMigrations } from '@funti3r/database';
import * as stellar from './lib/stellar.js';
import { PaymentStatus, PaymentMethod, ComplianceStatus } from '@funti3r/shared-types';
import axios from 'axios';

const logger = createLogger('PaymentService');
const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://compliance-service:3003';

const app = express();
app.use(express.json());

// Helper to check compliance status
async function checkCompliance(userId: string): Promise<boolean> {
  try {
    const response = await axios.get(`${COMPLIANCE_SERVICE_URL}/${userId}/status`);
    return response.data.status === ComplianceStatus.VERIFIED;
  } catch (error) {
    logger.error('Compliance check failed', { userId, error: String(error) });
    return false;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'payment-service' });
});

/**
 * Create a new Stellar wallet for a user
 */
app.post('/wallets', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const keypair = await stellar.createKeypair();
    
    // In a real app, secret_key would be encrypted
    await query(
      'INSERT INTO wallets (user_id, public_key, secret_key) VALUES ($1, $2, $3)',
      [userId, keypair.publicKey, keypair.secretKey]
    );

    // For testnet, fund it automatically
    await stellar.fundWithFriendbot(keypair.publicKey);

    res.status(201).json({
      userId,
      publicKey: keypair.publicKey,
      message: 'Wallet created and funded on testnet',
    });
  } catch (error) {
    logger.error('Failed to create wallet', { userId, error: String(error) });
    res.status(500).json({ error: 'Failed to create wallet' });
  }
});

/**
 * Get wallet details
 */
app.get('/wallets/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await query('SELECT public_key FROM wallets WHERE user_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const publicKey = result.rows[0].public_key;
    const balances = await stellar.getAccountBalance(publicKey);

    res.json({
      userId,
      publicKey,
      balances,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wallet info' });
  }
});

/**
 * Initiate a payout
 */
app.post('/payouts', async (req, res) => {
  const { enterpriseId, workerId, amount, currency } = req.body;

  if (!enterpriseId || !workerId || !amount || !currency) {
    return res.status(400).json({ error: 'Missing required payout fields' });
  }

  // Compliance Guard
  const isVerified = await checkCompliance(workerId);
  if (!isVerified) {
    return res.status(403).json({ error: 'Worker is not KYC verified' });
  }

  try {
    // 1. Get enterprise wallet (source)
    const entWallet = await query('SELECT secret_key FROM wallets WHERE user_id = $1', [enterpriseId]);
    if (entWallet.rows.length === 0) {
      return res.status(404).json({ error: 'Enterprise wallet not found' });
    }

    // 2. Get worker wallet (destination)
    const workWallet = await query('SELECT public_key FROM wallets WHERE user_id = $1', [workerId]);
    if (workWallet.rows.length === 0) {
      return res.status(404).json({ error: 'Worker wallet not found' });
    }

    const sourceSecret = entWallet.rows[0].secret_key;
    const destPublic = workWallet.rows[0].public_key;

    // 3. Record payment as pending
    const paymentResult = await query(
      `INSERT INTO payments (enterprise_id, worker_id, amount, currency, status, payment_method) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [enterpriseId, workerId, amount, currency, PaymentStatus.PENDING, PaymentMethod.STELLAR]
    );
    
    const paymentId = paymentResult.rows[0].id;

    // 4. Trigger Stellar payment (async-ish)
    // For MVP, we'll wait for it to finish
    try {
      const txHash = await stellar.sendPayment(sourceSecret, destPublic, amount.toString());
      
      await query(
        'UPDATE payments SET status = $1, stellar_tx_hash = $2, updated_at = NOW() WHERE id = $3',
        [PaymentStatus.COMPLETED, txHash, paymentId]
      );

      res.status(201).json({
        paymentId,
        status: PaymentStatus.COMPLETED,
        txHash,
      });
    } catch (paymentError: any) {
      await query(
        'UPDATE payments SET status = $1, failure_reason = $2, updated_at = NOW() WHERE id = $3',
        [PaymentStatus.FAILED, paymentError.message, paymentId]
      );
      
      res.status(502).json({
        paymentId,
        status: PaymentStatus.FAILED,
        error: paymentError.message,
      });
    }

  } catch (error) {
    logger.error('Payout failed', { error: String(error) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function start() {
  try {
    await initPostgres();
    await runInitialMigrations();
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
