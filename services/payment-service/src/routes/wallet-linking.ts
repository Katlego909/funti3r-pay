import { Router, Request, Response } from 'express';
import { createLogger, ValidationError, NotFoundError } from '@funti3r/shared-utils';
import { query, transaction } from '@funti3r/database';
import { WalletProvider, WalletLinkStatus } from '@funti3r/shared-types';
import { generateChallenge, CHALLENGE_EXPIRY_MS } from '../lib/wallet-kit-integration.js';
import { verifyWalletSignature } from '../lib/wallet-verification.js';
import { randomBytes } from 'crypto';

const logger = createLogger('WalletLinking');
const router: Router = Router();

/**
 * POST /wallets/external/link-request
 * Initiate wallet linking by requesting a verification challenge.
 * Returns a random challenge that the wallet must sign.
 */
router.post('/external/link-request', async (req: Request, res: Response) => {
  const { userId, walletProvider } = req.body as {
    userId: string;
    walletProvider: WalletProvider;
  };

  if (!userId || !walletProvider) {
    return res.status(400).json({ error: 'userId and walletProvider are required' });
  }

  if (!Object.values(WalletProvider).includes(walletProvider)) {
    return res.status(400).json({ error: `Invalid wallet provider: ${walletProvider}` });
  }

  try {
    const challenge = generateChallenge();
    const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MS);

    logger.info('Generated wallet link challenge', { userId, walletProvider });

    res.json({
      challenge,
      walletProvider,
      expiresAt,
      expiresIn: CHALLENGE_EXPIRY_MS,
    });
  } catch (err) {
    logger.error('Failed to generate challenge', { userId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /wallets/external/verify
 * Verify the wallet signature and link the external wallet to the user.
 *
 * Required body:
 * - userId: string
 * - publicKey: string (wallet public key)
 * - challenge: string (from link-request)
 * - signature: string (user's signature of the challenge)
 * - walletProvider: WalletProvider
 */
router.post('/external/verify', async (req: Request, res: Response) => {
  const { userId, publicKey, challenge, signature, walletProvider } = req.body as {
    userId: string;
    publicKey: string;
    challenge: string;
    signature: string;
    walletProvider: WalletProvider;
  };

  if (!userId || !publicKey || !challenge || !signature || !walletProvider) {
    return res.status(400).json({
      error: 'userId, publicKey, challenge, signature, and walletProvider are required',
    });
  }

  try {
    // Step 1: Validate request inputs
    logger.info('Wallet verification endpoint called', {
      userId: userId.substring(0, 8) + '...',
      publicKeyLength: publicKey.length,
      challengeLength: challenge.length,
      signatureLength: signature.length,
      signaturePreview: signature.substring(0, 100),
      walletProvider,
    });

    if (!signature || signature.length === 0) {
      logger.warn('Missing signature in request');
      return res.status(400).json({ error: 'Signature (signed XDR) is required' });
    }

    if (!publicKey || publicKey.length === 0) {
      logger.warn('Missing public key in request');
      return res.status(400).json({ error: 'Public key is required' });
    }

    if (!challenge || challenge.length === 0) {
      logger.warn('Missing challenge in request');
      return res.status(400).json({ error: 'Challenge is required' });
    }

    // Validate signature is base64
    try {
      Buffer.from(signature, 'base64');
    } catch (err) {
      logger.warn('Signature is not valid base64');
      return res.status(400).json({ error: 'Signature must be base64-encoded' });
    }

    logger.info('Request inputs validated successfully');

    // Step 2: Perform comprehensive wallet signature verification
    logger.info('Starting wallet signature verification');
    const verificationResult = verifyWalletSignature(signature, publicKey, challenge);

    if (!verificationResult.isValid) {
      logger.warn('Wallet verification failed', {
        error: verificationResult.error,
        userId: userId.substring(0, 8) + '...',
        publicKey: publicKey.substring(0, 10) + '...',
      });
      return res.status(400).json({ error: verificationResult.error || 'Verification failed' });
    }

    logger.info('Wallet signature verified successfully', {
      userId: userId.substring(0, 8) + '...',
      publicKey: publicKey.substring(0, 10) + '...',
    });

    // Check if wallet is already linked
    const existing = await query(
      `SELECT id FROM wallets
       WHERE public_key = $1 AND is_external = TRUE AND user_id = $2`,
      [publicKey, userId],
    );

    if (existing.rows.length > 0) {
      logger.info('Wallet already linked to user', { userId, publicKey });
      return res.status(409).json({ error: 'This wallet is already linked to your account' });
    }

    // Check if wallet is linked to a different user
    const otherUser = await query(
      `SELECT user_id FROM wallets
       WHERE public_key = $1 AND is_external = TRUE AND user_id != $2`,
      [publicKey, userId],
    );

    if (otherUser.rows.length > 0) {
      logger.warn('Wallet already linked to different user', { publicKey, userId });
      return res.status(409).json({
        error: 'This wallet is already linked to another account',
      });
    }

    // Create or update the external wallet record
    const result = await transaction(async (client) => {
      return client.query(
        `INSERT INTO wallets (
          user_id, wallet_type, public_key, wallet_provider, is_external,
          public_key_verified, verification_signature, verified_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
        ON CONFLICT (user_id, wallet_type, is_external)
        DO UPDATE SET
          public_key = EXCLUDED.public_key,
          wallet_provider = EXCLUDED.wallet_provider,
          public_key_verified = EXCLUDED.public_key_verified,
          verification_signature = EXCLUDED.verification_signature,
          verified_at = NOW(),
          status = EXCLUDED.status
        RETURNING id, public_key, wallet_provider`,
        [userId, 'external', publicKey, walletProvider, true, true, signature, 'active'],
      );
    });

    const walletId = result.rows[0].id;

    // Create wallet metadata record
    await query(
      `INSERT INTO wallet_metadata (wallet_id, connection_status, last_activity_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (wallet_id) DO UPDATE SET
         connection_status = EXCLUDED.connection_status,
         last_activity_at = NOW()`,
      [walletId, WalletLinkStatus.CONNECTED],
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [
        userId,
        'EXTERNAL_WALLET_LINKED',
        JSON.stringify({
          walletProvider,
          publicKey: publicKey.substring(0, 10) + '...',
          timestamp: new Date().toISOString(),
        }),
      ],
    );

    logger.info('External wallet linked successfully', { userId, walletProvider, walletId });

    res.status(201).json({
      walletId,
      publicKey,
      walletProvider,
      status: 'connected',
      message: 'Wallet linked successfully',
    });
  } catch (err) {
    logger.error('Wallet verification failed', { userId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /wallets/external/metadata/:walletId
 * Get metadata for an external wallet
 */
router.get('/external/metadata/:walletId', async (req: Request, res: Response) => {
  const { walletId } = req.params;

  try {
    const result = await query(
      `SELECT w.id, w.user_id, w.public_key, w.wallet_provider, w.verified_at,
              wm.connection_status, wm.last_activity_at, wm.connection_error
       FROM wallets w
       LEFT JOIN wallet_metadata wm ON w.id = wm.wallet_id
       WHERE w.id = $1 AND w.is_external = TRUE`,
      [walletId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    const wallet = result.rows[0];

    res.json({
      walletId: wallet.id,
      publicKey: wallet.public_key,
      walletProvider: wallet.wallet_provider,
      connectionStatus: wallet.connection_status,
      lastActivityAt: wallet.last_activity_at,
      connectionError: wallet.connection_error,
      verifiedAt: wallet.verified_at,
    });
  } catch (err) {
    logger.error('Failed to fetch wallet metadata', { walletId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /wallets/external/disconnect/:walletId
 * Disconnect an external wallet from the user's account
 */
router.put('/external/disconnect/:walletId', async (req: Request, res: Response) => {
  const { walletId } = req.params;
  const { userId } = req.body as { userId: string };

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    // Verify ownership
    const wallet = await query(
      `SELECT user_id FROM wallets WHERE id = $1 AND is_external = TRUE`,
      [walletId],
    );

    if (wallet.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    if (wallet.rows[0].user_id !== userId) {
      logger.warn('Unauthorized wallet disconnect attempt', { walletId, userId });
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update wallet metadata to disconnected
    await query(
      `UPDATE wallet_metadata SET connection_status = $1, last_activity_at = NOW()
       WHERE wallet_id = $2`,
      [WalletLinkStatus.DISCONNECTED, walletId],
    );

    // Optionally delete the wallet (or keep for audit trail)
    await query(
      `UPDATE wallets SET status = $1, updated_at = NOW() WHERE id = $2`,
      ['suspended', walletId],
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [
        userId,
        'EXTERNAL_WALLET_DISCONNECTED',
        JSON.stringify({
          walletId,
          timestamp: new Date().toISOString(),
        }),
      ],
    );

    logger.info('External wallet disconnected', { walletId, userId });

    res.json({ message: 'Wallet disconnected successfully' });
  } catch (err) {
    logger.error('Failed to disconnect wallet', { walletId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /wallets/:userId/external
 * List all external wallets for a user
 */
router.get('/:userId/external', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const result = await query(
      `SELECT w.id, w.public_key, w.wallet_provider, w.status, w.verified_at,
              wm.connection_status, wm.last_activity_at
       FROM wallets w
       LEFT JOIN wallet_metadata wm ON w.id = wm.wallet_id
       WHERE w.user_id = $1 AND w.is_external = TRUE
       ORDER BY w.created_at DESC`,
      [userId],
    );

    res.json({
      wallets: result.rows.map((row) => ({
        id: row.id,
        publicKey: row.public_key,
        walletProvider: row.wallet_provider,
        status: row.status,
        connectionStatus: row.connection_status,
        lastActivityAt: row.last_activity_at,
        verifiedAt: row.verified_at,
      })),
    });
  } catch (err) {
    logger.error('Failed to list external wallets', { userId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
