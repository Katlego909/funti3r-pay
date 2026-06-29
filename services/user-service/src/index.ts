import express from 'express';
import cookieParser from 'cookie-parser';
import { randomBytes, createHash, randomUUID } from 'crypto';
import axios from 'axios';
import { Keypair } from '@stellar/stellar-sdk';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { decode as cborDecode } from 'cbor-x';
import {
  createLogger,
  generateToken,
  ValidationError,
  AuthenticationError,
  NotFoundError,
} from '@funti3r/shared-utils';
import { initPostgres, runInitialMigrations, initRedis, query, setJSON, getJSON, deleteKey } from '@funti3r/database';
import { UserRole } from '@funti3r/shared-types';

const logger = createLogger('UserService');
const app = express();

app.use(cookieParser());

// Safe body parser
function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
    req.body = {};
    return next();
  }

  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    try {
      req.body = data ? JSON.parse(data) : {};
    } catch (e) {
      req.body = {};
    }
    next();
  });
  req.on('error', () => {
    req.body = {};
    next();
  });
}
app.use(parseBody);

const RP_NAME = process.env.RP_NAME || 'Funti3r-Pay';
const RP_ID = process.env.RP_ID || 'localhost';
const RP_ORIGIN = process.env.RP_ORIGIN || 'http://localhost:3100';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002';
const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const CHALLENGE_TTL_SEC = 600; // 10 minutes
// Access token TTL is controlled by JWT_EXPIRATION env var (default 24h; set to 15m for production)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Ensure user has a Stellar account - create one if they don't have it
 * Called for every user to guarantee they have a Stellar public key
 */
async function ensureUserHasStellarAccount(userId: string): Promise<string> {
  // Check if user already has a Stellar account
  const result = await query(
    'SELECT stellar_public_key FROM users WHERE id = $1',
    [userId],
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  if (result.rows[0].stellar_public_key) {
    return result.rows[0].stellar_public_key;
  }

  // Generate new Stellar account
  const keypair = Keypair.random();
  const stellarPublicKey = keypair.publicKey();
  const stellarSecretKey = keypair.secret();

  // Store in database
  await query(
    'UPDATE users SET stellar_public_key = $1, stellar_secret_key = $2 WHERE id = $3',
    [stellarPublicKey, stellarSecretKey, userId],
  );

  logger.info('Generated Stellar account', { userId, stellarKey: stellarPublicKey.substring(0, 10) });
  return stellarPublicKey;
}

/**
 * Extracts the raw 65-byte uncompressed P-256 public key (04 ‖ x ‖ y) from a
 * COSE-encoded credential public key returned by @simplewebauthn/server.
 */
function extractP256UncompressedKey(coseKey: Uint8Array): Buffer {
  const map = cborDecode(Buffer.from(coseKey)) as Map<number, Uint8Array>;
  const x = map instanceof Map ? map.get(-2) : (map as Record<number, Uint8Array>)[-2];
  const y = map instanceof Map ? map.get(-3) : (map as Record<number, Uint8Array>)[-3];
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error('Credential is not a P-256 key');
  }
  // Uncompressed SEC1 format: 04 ‖ x ‖ y
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(x), Buffer.from(y)]);
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function setRefreshCookie(res: express.Response, token: string): void {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
    path: '/auth',
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'user-service' });
});

app.post('/auth/register/test', (req, res) => {
  res.json({ test: 'works', challenge: 'test-challenge' });
});

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * POST /auth/register/start
 * Body: { email, role }
 * Returns WebAuthn registration options and stores the challenge in Redis.
 */
const registerStartHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { email, role = 'worker', origin } = req.body;
    const clientOrigin = origin || req.headers.origin || RP_ORIGIN;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: email,
      userID: new Uint8Array(Buffer.from(email.split('@')[0])), // Unique user ID based on email prefix
      userDisplayName: email.split('@')[0] || 'User',
      attestationType: 'none',
      authenticatorSelection: {
        // Only platform authenticators: Windows Hello, Touch ID, etc
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
      supportedAlgorithmIDs: [-7, -257], // ES256, RS256 (ES256 is best for platform authenticators)
    });

    // Store the challenge for verification during register/finish
    await setJSON(`reg:${email}`, { challenge: options.challenge, role }, CHALLENGE_TTL_SEC);

    console.log('[registerStart] Generated options for', email, '- Challenge:', options.challenge);

    // Return the FULL options object as-is
    res.status(200).json(options);
  } catch (err) {
    console.error('[registerStart] Error:', err);
    logger.error('register/start error', { error: String(err) });
    res.status(500).json({ error: 'Registration failed: ' + String(err) });
  }
};

app.post('/auth/register/start', registerStartHandler);
app.post('/register/start', registerStartHandler);
app.post('/api/auth/register/start', registerStartHandler);

/**
 * POST /auth/register/finish
 * Body: { email, credential: RegistrationResponseJSON }
 * Verifies the WebAuthn credential, creates the user, deploys their
 * Soroban SmartWallet, and returns a JWT.
 */
const registerFinishHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { email, credential, origin } = req.body as {
      email: string;
      credential: Record<string, unknown>;
      origin?: string;
    };
    if (!email || !credential) throw new ValidationError('email and credential are required');

    const session = await getJSON<{ challenge: string; role: UserRole }>(`reg:${email}`);
    if (!session) {
      console.log('[registerFinish] Challenge not found for email:', email);
      return res.status(400).json({ error: 'Registration session expired. Please start again.' });
    }

    console.log('[registerFinish] Challenge found, verifying credential...');
    const clientOrigin = origin || req.headers.origin || RP_ORIGIN;
    const verification = await verifyRegistrationResponse({
      response: credential as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: session.challenge,
      expectedOrigin: clientOrigin,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });

    console.log('[registerFinish] Verification result:', { verified: verification.verified, hasInfo: !!verification.registrationInfo });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    const { credentialID, credentialPublicKey, counter, aaguid } =
      verification.registrationInfo;

    // transports come from the client credential response, not registrationInfo in v10
    // For platform authenticators (Windows Hello), transports should be ['internal']
    const transports = (credential as { transports?: string[] }).transports ?? ['internal'];

    console.log('[registerFinish] Credential transports:', transports);

    // Extract raw P-256 public key for Soroban contract init
    const passkeyPkBuffer = extractP256UncompressedKey(credentialPublicKey);

    // Check if user already exists
    const existingUserRow = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );

    let userId: string;
    if (existingUserRow.rows.length > 0) {
      // User exists, check if they already have a credential for this origin
      userId = existingUserRow.rows[0].id;
      const existingCredentialRow = await query(
        `SELECT id FROM user_credentials WHERE user_id = $1 AND origin = $2`,
        [userId, clientOrigin],
      );
      if (existingCredentialRow.rows.length > 0) {
        return res.status(409).json({ error: 'You already have a credential registered for this browser/origin' });
      }
    } else {
      // New user, create them with a Stellar account
      userId = randomUUID();

      // Generate regular Stellar account (ed25519) for payments
      const keypair = Keypair.random();
      const stellarPublicKey = keypair.publicKey();
      const stellarSecretKey = keypair.secret();

      await query(
        `INSERT INTO users (id, email, role, stellar_public_key, stellar_secret_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, email, session.role, stellarPublicKey, stellarSecretKey],
      );

      logger.info('User created with Stellar account', { userId, email, stellarKey: stellarPublicKey.substring(0, 10) });
    }

    // Create credential
    // Store credentialID as base64 string for consistent retrieval
    const credentialIDBase64 = Buffer.from(credentialID).toString('base64');
    await query(
      `INSERT INTO user_credentials
         (user_id, credential_id, public_key, counter, transports, aaguid, origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        credentialIDBase64,
        Buffer.from(credentialPublicKey).toString('base64'),
        counter,
        transports,
        aaguid,
        clientOrigin,
      ],
    );

    // Deploy SmartWallet asynchronously (non-blocking)
    // Worker wallet deploys in background; polling endpoint checks status
    if (session.role === 'worker') {
      setImmediate(async () => {
        try {
          const credIdBase64 = credentialID.replace(/-/g, '+').replace(/_/g, '/') + '==';
          const credIdHex = Buffer.from(credIdBase64, 'base64').toString('hex');

          const deployRes = await axios.post(`${PAYMENT_SERVICE_URL}/wallets/worker`, {
            userId,
            passkeyPkHex: passkeyPkBuffer.toString('hex'),
            credentialIdHex: credIdHex,
          }, { timeout: 300000 }); // 5 minute timeout

          const contractAddress = deployRes.data.contractAddress;
          await query(
            `INSERT INTO wallets (user_id, wallet_type, contract_address, status, deployed_at, updated_at)
             VALUES ($1, 'worker', $2, 'active', NOW(), NOW())`,
            [userId, contractAddress],
          );
          logger.info('SmartWallet deployed async', { userId, contractAddress });
        } catch (err) {
          logger.error('SmartWallet deployment failed (async)', { userId, error: String(err) });
        }
      });
    }

    await deleteKey(`reg:${email}`);

    const accessToken = generateToken(userId, email, session.role);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId, email, role: session.role },
      REFRESH_TOKEN_TTL_SEC,
    );

    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      accessToken,
      userId,
      email,
      role: session.role
    });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCode = (err as any)?.code;
    logger.error('register/finish failed', { error: errorMsg, code: errorCode, stack: err instanceof Error ? err.stack : undefined });

    // Return specific error for debugging
    if (errorCode === '23505') return res.status(409).json({ error: 'Email already registered' });
    if (errorMsg.includes('challenge')) return res.status(400).json({ error: 'Invalid or expired challenge' });
    if (errorMsg.includes('verification')) return res.status(400).json({ error: 'Passkey verification failed: ' + errorMsg });

    res.status(500).json({ error: errorMsg || 'Internal server error' });
  }
};

app.post('/auth/register/finish', registerFinishHandler);
app.post('/register/finish', registerFinishHandler);
app.post('/api/auth/register/finish', registerFinishHandler);

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * POST /auth/login/start
 * Body: { email }
 * Returns WebAuthn authentication options.
 */
const loginStartHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { email, origin } = req.body as { email: string; origin?: string };
    if (!email) throw new ValidationError('email is required');

    const clientOrigin = origin || req.headers.origin as string || RP_ORIGIN;

    const userRow = await query(
      `SELECT u.id, uc.credential_id, uc.transports
         FROM users u
         JOIN user_credentials uc ON uc.user_id = u.id
        WHERE u.email = $1 AND uc.origin = $2`,
      [email, clientOrigin],
    );
    if (userRow.rows.length === 0) throw new NotFoundError('User or credential for this origin');

    const { id: userId, credential_id, transports } = userRow.rows[0];

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'required',
      allowCredentials: [
        {
          id: credential_id,
          transports: transports ?? ['internal'],
        },
      ],
    });

    await setJSON(`auth:${userId}`, { challenge: options.challenge }, CHALLENGE_TTL_SEC);

    res.json(options);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    logger.error('login/start failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/auth/login/start', loginStartHandler);
app.post('/login/start', loginStartHandler);
app.post('/api/auth/login/start', loginStartHandler);

/**
 * POST /auth/login/finish
 * Body: { email, credential: AuthenticationResponseJSON }
 * Verifies the WebAuthn assertion and returns a JWT.
 */
const loginFinishHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { email, credential, origin } = req.body as {
      email: string;
      credential: Record<string, unknown>;
      origin?: string;
    };
    if (!email || !credential) throw new ValidationError('email and credential are required');

    const clientOrigin = origin || req.headers.origin || RP_ORIGIN;

    const userRow = await query(
      `SELECT u.id, u.role, uc.credential_id, uc.public_key, uc.counter, uc.transports
         FROM users u
         JOIN user_credentials uc ON uc.user_id = u.id
        WHERE u.email = $1 AND uc.origin = $2`,
      [email, clientOrigin],
    );
    if (userRow.rows.length === 0) throw new NotFoundError('User or credential for this origin');

    const { id: userId, role, credential_id, public_key, counter, transports } =
      userRow.rows[0];

    const session = await getJSON<{ challenge: string }>(`auth:${userId}`);
    if (!session) {
      return res.status(400).json({ error: 'Authentication session expired. Please start again.' });
    }
    const verification = await verifyAuthenticationResponse({
      response: credential as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: session.challenge,
      expectedOrigin: clientOrigin,
      expectedRPID: RP_ID,
      requireUserVerification: false,
      authenticator: {
        credentialID: credential_id,
        credentialPublicKey: Buffer.from(public_key, 'base64'),
        counter,
      },
    });

    if (!verification.verified) throw new AuthenticationError('Passkey verification failed');

    // Update the signature counter (replay-attack prevention)
    await query(
      'UPDATE user_credentials SET counter = $1 WHERE user_id = $2',
      [verification.authenticationInfo.newCounter, userId],
    );

    await deleteKey(`auth:${userId}`);

    const accessToken = generateToken(userId, email, role);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId, email, role },
      REFRESH_TOKEN_TTL_SEC,
    );

    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, userId, email, role });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof AuthenticationError) return res.status(401).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    logger.error('login/finish failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/auth/login/finish', loginFinishHandler);
app.post('/login/finish', loginFinishHandler);
app.post('/api/auth/login/finish', loginFinishHandler);

/**
 * POST /auth/refresh
 * Uses the httpOnly refresh_token cookie to issue a new access token.
 */
const refreshHandler = async (req: express.Request, res: express.Response) => {
  try {
    const token: string | undefined = req.cookies?.refresh_token;
    if (!token) throw new AuthenticationError('No refresh token');

    const session = await getJSON<{ userId: string; email: string; role: UserRole }>(
      `refresh:${hashRefreshToken(token)}`,
    );
    if (!session) throw new AuthenticationError('Refresh token expired or invalid');

    const accessToken = generateToken(session.userId, session.email, session.role);

    // Rotate refresh token
    await deleteKey(`refresh:${hashRefreshToken(token)}`);
    const newRefresh = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(newRefresh)}`,
      session,
      REFRESH_TOKEN_TTL_SEC,
    );
    setRefreshCookie(res, newRefresh);

    res.json({ accessToken });
  } catch (err) {
    if (err instanceof AuthenticationError) return res.status(401).json({ error: err.message });
    logger.error('refresh failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/auth/refresh', refreshHandler);
app.post('/refresh', refreshHandler);
app.post('/api/auth/refresh', refreshHandler);

/**
 * POST /auth/logout
 * Clears the refresh token from Redis and the cookie.
 */
const logoutHandler = async (req: express.Request, res: express.Response) => {
  const token: string | undefined = req.cookies?.refresh_token;
  if (token) await deleteKey(`refresh:${hashRefreshToken(token)}`);
  res.clearCookie('refresh_token', { path: '/auth' });
  res.json({ message: 'Logged out' });
};

app.post('/auth/logout', logoutHandler);
app.post('/logout', logoutHandler);
app.post('/api/auth/logout', logoutHandler);

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/users/summary', async (_req, res) => {
  try {
    const total = await query('SELECT COUNT(*) AS total FROM users');
    const byRole = await query(
      `SELECT role, COUNT(*) AS count FROM users GROUP BY role`,
    );
    res.json({
      total: Number(total.rows[0].total),
      byRole: Object.fromEntries(byRole.rows.map((r) => [r.role, Number(r.count)])),
    });
  } catch (err) {
    logger.error('users/summary failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const role = req.query.role as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    const offset = Number(req.query.offset ?? 0);

    let sql = 'SELECT id, email, role, status, country, created_at FROM users';
    const params: any[] = [];

    if (role) {
      sql += ' WHERE role = $1';
      params.push(role);
    }

    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await query(sql, params);
    const total = await query(
      role ? 'SELECT COUNT(*) AS total FROM users WHERE role = $1' : 'SELECT COUNT(*) AS total FROM users',
      role ? [role] : [],
    );

    res.json({
      users: result.rows,
      total: Number(total.rows[0].total),
    });
  } catch (err) {
    logger.error('users list failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    // Ensure user has Stellar account (auto-creates if missing)
    const stellarPublicKey = await ensureUserHasStellarAccount(userId);

    const result = await query(
      'SELECT id, email, role, status, country, created_at FROM users WHERE id = $1',
      [userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('User');

    res.json({
      ...result.rows[0],
      stellarPublicKey,
    });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /wallets/:userId
 * Get user's Stellar wallet public key
 * Auto-creates a Stellar account if user doesn't have one yet
 */
app.get('/wallets/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Ensure user has a Stellar account (creates one if missing)
    const stellarPublicKey = await ensureUserHasStellarAccount(userId);

    const result = await query(
      'SELECT id, email FROM users WHERE id = $1',
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      userId: user.id,
      email: user.email,
      stellarPublicKey,
    });
  } catch (err) {
    logger.error('Failed to get wallet', { error: String(err) });
    res.status(500).json({ error: 'Failed to get wallet' });
  }
});

// ── Wallet Deployment ────────────────────────────────────────────────────────

/**
 * POST /wallets/deploy
 * Trigger SmartWallet deployment for current user or a specific user (admin only).
 * Can be called by:
 * - A user for their own wallet (if they don't have one yet)
 * - An admin to deploy for another user
 */
const deployWalletHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { userId: targetUserId } = req.body as { userId?: string };
    const requestingUserId = (req as any).headers['x-user-id'] as string;
    const requestingRole = (req as any).headers['x-user-role'] as string;

    // Determine which user to deploy for
    const userId = targetUserId || requestingUserId;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required or must be authenticated' });
    }

    // Authorization: user can deploy for themselves, or admin can deploy for anyone
    if (userId !== requestingUserId && requestingRole !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to deploy wallet for this user' });
    }

    logger.info('Triggering wallet deployment', { userId, requestedBy: requestingUserId });

    // Call Payment Service to deploy
    const deployRes = await axios.post(
      `${PAYMENT_SERVICE_URL}/wallets/deploy-for-existing-user`,
      { userId },
      { timeout: 60000 }
    );

    res.status(201).json(deployRes.data);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return res.status(404).json({ error: 'User not found or user credentials missing' });
    }
    logger.error('Wallet deployment failed', { error: String(err) });
    res.status(500).json({ error: 'Wallet deployment failed' });
  }
};

app.post('/wallets/deploy', deployWalletHandler);
app.post('/api/wallets/deploy', deployWalletHandler);

/**
 * GET /wallets/:userId/deployment-status
 * Check worker wallet deployment progress (polls Payment Service)
 */
app.get('/wallets/:userId/deployment-status', async (req: express.Request, res: express.Response) => {
  try {
    const { userId } = req.params;

    // Query Payment Service for deployment status
    const statusRes = await axios.get(
      `${PAYMENT_SERVICE_URL}/wallets/${userId}/deployment-status`,
      { timeout: 5000 }
    );

    res.json(statusRes.data);
  } catch (err) {
    logger.warn('Failed to get deployment status from Payment Service', {
      userId: req.params.userId,
      error: String(err)
    });
    // Return "still deploying" if Payment Service unreachable
    res.json({
      status: 'deploying',
      contractAddress: null,
      deployedAt: null
    });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');
    await runInitialMigrations();
    await initRedis();
    logger.info('Redis connected');
  } catch (err) {
    logger.error('DB startup failed', { error: String(err) });
    process.exit(1);
  }

  const PORT = parseInt(process.env.USER_SERVICE_PORT || '3001', 10);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`User Service running on port ${PORT}`);
  });
}

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error', { error: String(err), path: req.path });
  if (!res.headersSent) {
    res.status(500).json({ error: String(err) });
  }
});

start();
