import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { initPostgres, query } from '@funti3r/database';
import { createLogger, hashPassword, comparePassword, generateToken, verifyToken } from '@funti3r/shared-utils';
import { Keypair } from 'stellar-sdk';

const logger = createLogger('UserService');
const app = express();
const PORT = parseInt(process.env.USER_PORT || '3001', 10);

app.use(express.json());
app.use(cookieParser());

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
// User Management Endpoints
// ──────────────────────────────────────────────────────────────────────────

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
// Startup
// ──────────────────────────────────────────────────────────────────────────

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
