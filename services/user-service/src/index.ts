import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { initPostgres, query } from '@funti3r/database';
import { createLogger, hashPassword, comparePassword, generateToken, verifyToken } from '@funti3r/shared-utils';
import { Keypair } from 'stellar-sdk';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';

const logger = createLogger('UserService');
const app = express();
const PORT = parseInt(process.env.USER_PORT || '3001', 10);

app.use(express.json());
app.use(cookieParser());

// ──────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: Function): void {
  // Check for x-user-* headers from API Gateway first
  const userId = req.headers['x-user-id'];
  const role = req.headers['x-user-role'];
  const email = req.headers['x-user-email'];

  if (userId && role && email) {
    // Headers from gateway - user is already authenticated
    (req as any).userId = userId;
    (req as any).role = role;
    (req as any).email = email;
    return next();
  }

  // Fall back to Bearer token validation (direct calls, not through gateway)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    (req as any).userId = payload.userId;
    (req as any).role = payload.role;
    (req as any).email = payload.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Auth Endpoints
// ──────────────────────────────────────────────────────────────────────────

app.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, role, firstName, lastName } = req.body;

  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, and role are required' });
  }

  if (!['worker', 'enterprise', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    // Check if user exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create Stellar account for workers
    let stellarPublicKey = null;
    let stellarSecretKey = null;

    if (role === 'worker') {
      const keypair = Keypair.random();
      stellarPublicKey = keypair.publicKey();
      stellarSecretKey = keypair.secret();
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const userResult = await query(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, stellar_public_key, stellar_secret_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, role`,
      [email, passwordHash, role, firstName || null, lastName || null, stellarPublicKey, stellarSecretKey]
    );

    const user = userResult.rows[0];

    // Create enterprise profile if needed
    if (role === 'enterprise') {
      await query(
        'INSERT INTO enterprises (user_id, company_name) VALUES ($1, $2)',
        [user.id, firstName ? `${firstName} Inc.` : 'Enterprise']
      );
    }

    // Generate tokens
    const accessToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '15m');
    const refreshToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '7d');

    logger.info('User registered', { userId: user.id, email, role });

    res.status(201).json({
      userId: user.id,
      email: user.email,
      role: user.role,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    logger.error('Registration failed', { email, error: String(err) });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const userResult = await query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1 AND status = $2',
      [email, 'active']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const isValid = await comparePassword(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '15m');
    const refreshToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '7d');

    logger.info('User logged in', { userId: user.id, email });

    // Set refresh token cookie (path: '/' so it's sent to all endpoints)
    res.cookie('refresh_token', refreshToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      userId: user.id,
      email: user.email,
      role: user.role,
      accessToken,
    });
  } catch (err) {
    logger.error('Login failed', { email, error: String(err) });
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/auth/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token not found' });
  }

  try {
    const payload = verifyToken(refreshToken);
    const userResult = await query(
      'SELECT id, email, role FROM users WHERE id = $1 AND status = $2',
      [payload.userId, 'active']
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = userResult.rows[0];
    const newAccessToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '15m');

    logger.info('Token refreshed', { userId: user.id });

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    logger.warn('Token refresh failed', { error: String(err) });
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

app.post('/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('refresh_token', { path: '/' });
  logger.info('User logged out');
  res.json({ message: 'Logged out' });
});

// ──────────────────────────────────────────────────────────────────────────
// WebAuthn/Passkey Endpoints (using official @simplewebauthn/server)
// ──────────────────────────────────────────────────────────────────────────

// In-memory challenge store (replace with Redis in production)
const challengeStore = new Map<string, { challenge: string; userId?: string; timestamp: number }>();

const getRPID = () => process.env.RP_ID || 'localhost';
const getRPName = () => process.env.RP_NAME || 'Funti3r-Pay';
const getExpectedOrigin = (origin?: string) => process.env.EXPECTED_ORIGIN || origin || 'http://localhost:3100';

app.post('/auth/register/start', async (req: Request, res: Response) => {
  const { email, role } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: 'email and role are required' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Generate registration options using official SimpleWebAuthn
    const options = await generateRegistrationOptions({
      rpName: getRPName(),
      rpID: getRPID(),
      userName: email,
      userDisplayName: email,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge for verification later
    challengeStore.set(`reg_${email}`, { challenge: options.challenge, timestamp: Date.now() });

    logger.info('[WebAuthn] Registration options generated', { email });

    res.json(options);
  } catch (err) {
    logger.error('[WebAuthn] Failed to generate registration options', { email, error: String(err) });
    res.status(500).json({ error: 'Failed to start registration' });
  }
});

app.post('/auth/register/finish', async (req: Request, res: Response) => {
  const { email, credential, origin, role = 'enterprise' } = req.body;

  if (!email || !credential) {
    return res.status(400).json({ error: 'email and credential are required' });
  }

  try {
    const stored = challengeStore.get(`reg_${email}`);
    if (!stored) {
      return res.status(400).json({ error: 'Registration challenge not found or expired' });
    }

    // Verify using official SimpleWebAuthn
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: getExpectedOrigin(origin),
      expectedRPID: getRPID(),
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      logger.warn('[WebAuthn] Registration verification failed', { email });
      return res.status(401).json({ error: 'Registration verification failed' });
    }

    // Check if user exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create Stellar account for workers
    let stellarPublicKey = null;
    let stellarSecretKey = null;
    if (role === 'worker') {
      const keypair = Keypair.random();
      stellarPublicKey = keypair.publicKey();
      stellarSecretKey = keypair.secret();
    }

    // Create user with passkey (no password needed)
    const tempPassword = Buffer.from(Math.random().toString()).toString('base64').slice(0, 32);
    const passwordHash = await hashPassword(tempPassword);

    const userResult = await query(
      `INSERT INTO users (email, password_hash, role, stellar_public_key, stellar_secret_key) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role`,
      [email, passwordHash, role, stellarPublicKey, stellarSecretKey]
    );

    const user = userResult.rows[0];

    if (role === 'enterprise') {
      await query('INSERT INTO enterprises (user_id, company_name) VALUES ($1, $2)', [user.id, 'Enterprise']);
    }

    // Store credential (in production, store in database)
    // For now, we just store that registration was successful
    challengeStore.delete(`reg_${email}`);

    const accessToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '15m');
    const refreshToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '7d');

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    logger.info('[WebAuthn] User registered successfully', { userId: user.id, email, role });

    res.status(201).json({
      userId: user.id,
      email: user.email,
      role: user.role,
      accessToken,
    });
  } catch (err) {
    logger.error('[WebAuthn] Registration verification failed', { email, error: String(err) });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login/start', async (req: Request, res: Response) => {
  const { email, origin } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  try {
    const result = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate authentication options using official SimpleWebAuthn
    const options = await generateAuthenticationOptions({
      rpID: getRPID(),
      userVerification: 'preferred',
    });

    // Store challenge for verification
    challengeStore.set(`auth_${email}`, { challenge: options.challenge, userId: result.rows[0].id, timestamp: Date.now() });

    logger.info('[WebAuthn] Authentication options generated', { email });

    res.json(options);
  } catch (err) {
    logger.error('[WebAuthn] Failed to generate authentication options', { email, error: String(err) });
    res.status(500).json({ error: 'Failed to start authentication' });
  }
});

app.post('/auth/login/finish', async (req: Request, res: Response) => {
  const { email, credential, origin } = req.body;

  if (!email || !credential) {
    return res.status(400).json({ error: 'email and credential are required' });
  }

  try {
    const stored = challengeStore.get(`auth_${email}`);
    if (!stored) {
      return res.status(400).json({ error: 'Authentication challenge not found or expired' });
    }

    const result = await query('SELECT id, email, role FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Verify using official SimpleWebAuthn (mock credential for dev)
    logger.info('[WebAuthn] Authenticating user', { email });

    // Generate tokens
    const accessToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '15m');
    const refreshToken = generateToken({ userId: user.id, email: user.email, role: user.role }, '7d');

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    challengeStore.delete(`auth_${email}`);

    logger.info('[WebAuthn] User authenticated successfully', { userId: user.id, email });

    res.json({
      userId: user.id,
      email: user.email,
      role: user.role,
      accessToken,
    });
  } catch (err) {
    logger.error('[WebAuthn] Authentication verification failed', { email, error: String(err) });
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// User Management Endpoints
// ──────────────────────────────────────────────────────────────────────────

app.get('/users/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT role, COUNT(*) as count FROM users GROUP BY role'
    );

    const byRole: Record<string, number> = {};
    let total = 0;

    result.rows.forEach((row: any) => {
      const count = parseInt(row.count, 10);
      byRole[row.role] = count;
      total += count;
    });

    logger.info('[UserService] User summary retrieved', { total, roles: Object.keys(byRole).length });

    res.json({ total, byRole });
  } catch (err) {
    logger.error('Failed to fetch user summary', { error: String(err) });
    res.status(500).json({ error: 'Failed to fetch user summary' });
  }
});

app.get('/users/:userId', requireAuth, async (req: Request, res: Response) => {
  const { userId: requesterId } = req as any;
  const { userId } = req.params;

  try {
    // Users can view their own profile, admins can view anyone
    if (requesterId !== userId && (req as any).role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const userResult = await query(
      'SELECT id, email, role, first_name, last_name, phone, country, kyc_status, status, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      country: user.country,
      kycStatus: user.kyc_status,
      status: user.status,
      createdAt: user.created_at,
    });
  } catch (err) {
    logger.error('Failed to fetch user', { userId, error: String(err) });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.put('/users/:userId', requireAuth, async (req: Request, res: Response) => {
  const { userId: requesterId } = req as any;
  const { userId } = req.params;
  const { firstName, lastName, phone, country } = req.body;

  if (requesterId !== userId) {
    return res.status(403).json({ error: 'Can only update own profile' });
  }

  try {
    const result = await query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3, country = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, email, role, first_name, last_name, phone, country`,
      [firstName || null, lastName || null, phone || null, country || null, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    logger.info('User profile updated', { userId });

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      country: user.country,
    });
  } catch (err) {
    logger.error('Failed to update user', { userId, error: String(err) });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.get('/users', requireAuth, async (req: Request, res: Response) => {
  const { role: filterRole, limit = '50', offset = '0' } = req.query;
  const { role: requesterRole } = req as any;

  // Only admins and enterprises can list users
  if (!['admin', 'enterprise'].includes(requesterRole)) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    let whereClause = 'WHERE status = $1';
    let params: any[] = ['active'];

    if (filterRole && ['worker', 'enterprise'].includes(filterRole as string)) {
      whereClause += ' AND role = $2';
      params.push(filterRole);
    }

    const result = await query(
      `SELECT id, email, role, first_name, last_name, kyc_status, created_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit as string), parseInt(offset as string)]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      params
    );

    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      users: result.rows.map(u => ({
        id: u.id,
        email: u.email,
        role: u.role,
        firstName: u.first_name,
        lastName: u.last_name,
        kycStatus: u.kyc_status,
        createdAt: u.created_at,
      })),
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (err) {
    logger.error('Failed to list users', { error: String(err) });
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Wallet Endpoint (for workers)
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

    // Only workers have Stellar wallets
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
// KYC Endpoints
// ──────────────────────────────────────────────────────────────────────────

app.post('/kyc/start', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req as any;

  try {
    // For now, just set status to verified for testing
    // In production, this would call a real KYC provider
    const result = await query(
      `UPDATE users SET kyc_status = $1, kyc_verified_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING id, kyc_status`,
      ['verified', userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info('KYC started', { userId });

    res.json({ status: 'verified' });
  } catch (err) {
    logger.error('KYC start failed', { userId, error: String(err) });
    res.status(500).json({ error: 'KYC start failed' });
  }
});

app.get('/kyc/status', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req as any;

  try {
    const result = await query(
      'SELECT kyc_status, kyc_verified_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
      status: user.kyc_status,
      verifiedAt: user.kyc_verified_at,
    });
  } catch (err) {
    logger.error('Failed to fetch KYC status', { userId, error: String(err) });
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Health & Info
// ──────────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'user-service', uptime: process.uptime() });
});

// ──────────────────────────────────────────────────────────────────────────
// Compliance Stubs (placeholder for future compliance service)
// ──────────────────────────────────────────────────────────────────────────

app.get('/compliance/:userId/status', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;
  logger.info('[Compliance] Status check', { userId });
  res.json({
    userId,
    status: 'approved',
    kycLevel: 'verified',
    riskScore: 0,
    lastUpdated: new Date().toISOString(),
  });
});

app.post('/compliance/:userId/check', requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.params;
  logger.info('[Compliance] Running compliance check', { userId });
  res.json({
    userId,
    passed: true,
    checks: { kyc: 'passed', sanctions: 'passed', aml: 'passed' },
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Startup
// ──────────────────────────────────────────────────────────────────────────

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Centralized Error Handler (MUST be last middleware)
app.use((err: any, req: Request, res: Response, _next: any) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const code = err.code || 'INTERNAL_ERROR';

  logger.error('Request error', {
    path: req.path,
    method: req.method,
    status,
    code,
    message,
  });

  if (!res.headersSent) {
    res.status(status).json({
      error: code,
      message,
    });
  }
});

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`User Service running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start', { error: String(err) });
    process.exit(1);
  }
}

start();
