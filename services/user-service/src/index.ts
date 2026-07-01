import express from 'express';
import cookieParser from 'cookie-parser';
import { randomBytes, createHash, randomUUID } from 'crypto';
import axios from 'axios';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { decode as cborDecode } from 'cbor-x';
import { Keypair } from '@stellar/stellar-sdk';
import {
  createLogger,
  generateToken,
  encryptToString,
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

/**
 * Fund a freshly-created account on the Stellar testnet via Friendbot so it
 * exists on-chain (a keypair alone does not — the account is created by its
 * first funding payment). Best-effort: never throws.
 */
async function fundTestnetAccount(publicKey: string): Promise<void> {
  if ((process.env.STELLAR_NETWORK || 'TESTNET').toUpperCase() !== 'TESTNET') return;
  try {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (res.ok) {
      logger.info('Funded testnet account via Friendbot', { publicKey });
    } else {
      logger.warn('Friendbot funding non-OK', { publicKey, status: res.status });
    }
  } catch (err) {
    logger.warn('Friendbot funding failed (account still usable once funded)', { publicKey, error: String(err) });
  }
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
      // New user, create them with a classic Stellar ed25519 account.
      // Workers receive payments to this address; enterprises get one too (harmless).
      userId = randomUUID();
      const stellarKeypair = Keypair.random();
      // Encrypt the secret key at rest (AES-256-GCM via MASTER_ENCRYPTION_KEY).
      const encryptedSecret = encryptToString(stellarKeypair.secret());
      await query(
        `INSERT INTO users (id, email, role, stellar_public_key, stellar_secret_key)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, email, session.role, stellarKeypair.publicKey(), encryptedSecret],
      );
      // Create the account on-chain (testnet) so it exists and has a balance.
      // Best-effort and awaited so the balance is ready on first dashboard load.
      await fundTestnetAccount(stellarKeypair.publicKey());
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

    // Note: workers use their classic Stellar account (created above) for payments.
    // No Soroban SmartWallet deployment — that path was removed.

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
 * POST /auth/dev-login  (DEVELOPMENT ONLY)
 * Body: { email }
 * Signs a user in by email with no passkey. Disabled when NODE_ENV=production.
 * Exists so local testing doesn't require re-registering a passkey every time
 * (passkeys are device/browser/origin-scoped and wiped on DB resets).
 */
const devLoginHandler = async (req: express.Request, res: express.Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const { email } = req.body as { email: string };
    if (!email) throw new ValidationError('email is required');

    const result = await query(
      'SELECT id, email, role FROM users WHERE email = $1',
      [email],
    );
    if (result.rows.length === 0) throw new NotFoundError('User');

    const { id: userId, role } = result.rows[0];
    const accessToken = generateToken(userId, email, role);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId, email, role },
      REFRESH_TOKEN_TTL_SEC,
    );
    setRefreshCookie(res, refreshToken);

    logger.info('[DevLogin] Signed in without passkey', { userId, email, role });
    res.json({ accessToken, userId, email, role });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: 'No account with that email' });
    logger.error('dev-login failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/auth/dev-login', devLoginHandler);
app.post('/login/dev-login', devLoginHandler);
app.post('/api/auth/dev-login', devLoginHandler);

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

    let sql = 'SELECT id, email, role, status, country, preferred_currency, created_at FROM users';
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
    const result = await query(
      `SELECT u.id, u.email, u.role, u.status, u.country, u.preferred_currency, u.created_at,
              e.company_name
         FROM users u
         LEFT JOIN enterprises e ON e.user_id = u.id
        WHERE u.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) throw new NotFoundError('User');
    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /users/me/preferred-currency — the authenticated worker chooses the
 * currency they are paid in. Body: { currency }.
 */
const ALLOWED_PAYOUT_CURRENCIES = ['USDC', 'NGN', 'KES', 'GHS', 'ZAR', 'UGX'];
const setPreferredCurrencyHandler = async (req: express.Request, res: express.Response) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const currency = String((req.body as any)?.currency || '').toUpperCase();
  if (!ALLOWED_PAYOUT_CURRENCIES.includes(currency)) {
    return res.status(400).json({ error: `Unsupported currency. Allowed: ${ALLOWED_PAYOUT_CURRENCIES.join(', ')}` });
  }
  try {
    const result = await query(
      'UPDATE users SET preferred_currency = $1, updated_at = NOW() WHERE id = $2 RETURNING preferred_currency',
      [currency, userId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ preferredCurrency: result.rows[0].preferred_currency });
  } catch (err) {
    logger.error('Failed to set preferred currency', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};
app.put('/users/me/preferred-currency', setPreferredCurrencyHandler);
app.put('/api/users/me/preferred-currency', setPreferredCurrencyHandler);

/**
 * PATCH /users/me — update mutable profile fields for the authenticated user.
 * Enterprise: updates company_name in the enterprises table.
 * Any role: updates first_name, last_name, phone, country in users.
 */
const patchMeHandler = async (req: express.Request, res: express.Response) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { company_name, first_name, last_name, phone, country } = req.body as Record<string, string | undefined>;

  try {
    const userCols: string[] = [];
    const userVals: unknown[] = [];
    if (first_name !== undefined) { userCols.push(`first_name = $${userCols.length + 1}`); userVals.push(first_name); }
    if (last_name  !== undefined) { userCols.push(`last_name = $${userCols.length + 1}`);  userVals.push(last_name); }
    if (phone      !== undefined) { userCols.push(`phone = $${userCols.length + 1}`);       userVals.push(phone); }
    if (country    !== undefined) { userCols.push(`country = $${userCols.length + 1}`);     userVals.push(country); }

    if (userCols.length > 0) {
      await query(
        `UPDATE users SET ${userCols.join(', ')}, updated_at = NOW() WHERE id = $${userCols.length + 1}`,
        [...userVals, userId],
      );
    }

    if (company_name !== undefined) {
      await query(
        `INSERT INTO enterprises (user_id, company_name)
         VALUES ($2, $1)
         ON CONFLICT (user_id) DO UPDATE SET company_name = EXCLUDED.company_name, updated_at = NOW()`,
        [company_name, userId],
      );
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to update profile', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};
app.patch('/users/me', patchMeHandler);
app.patch('/api/users/me', patchMeHandler);

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
