import express from 'express';
import cookieParser from 'cookie-parser';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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
import { sendRecoveryEmail } from './lib/email.js';
import { initPostgres, runInitialMigrations, initRedis, query, transaction, setJSON, getJSON, deleteKey } from '@funti3r/database';
import { UserRole } from '@funti3r/shared-types';

const logger = createLogger('UserService');
const app = express();

app.use(cookieParser());

// Safe body parser
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB — comfortably above any real payload this service accepts
function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
    req.body = {};
    return next();
  }

  let data = '';
  let bytes = 0;
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      aborted = true;
      res.status(413).json({ error: 'Request body too large' });
      return; // keep draining the stream below without buffering further
    }
    data += chunk;
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      req.body = data ? JSON.parse(data) : {};
    } catch (e) {
      req.body = {};
    }
    next();
  });
  req.on('error', () => {
    if (aborted) return;
    req.body = {};
    next();
  });
}
app.use(parseBody);

const RP_NAME = process.env.RP_NAME || 'Funti3r-Pay';
const RP_ID = process.env.RP_ID || 'localhost';
const RP_ORIGIN = process.env.RP_ORIGIN || 'http://localhost:3100';
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

/**
 * Resolves the `enterprises.id` for a user's active company membership.
 * Multi-tenancy Phase 1: populates the JWT/session `companyId` claim only —
 * not yet read by any authorization logic. Returns null for workers, admins,
 * or enterprise users who haven't created/joined a company yet.
 *
 * Never throws — a lookup failure here (transient DB error, or this node
 * momentarily ahead of migration 007) must not fail login/registration for a
 * claim nothing yet depends on; it just resolves to no company for this token.
 */
async function resolveActiveCompanyId(userId: string): Promise<string | null> {
  try {
    const r = await query(
      `SELECT enterprise_id FROM enterprise_members WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    return r.rows[0]?.enterprise_id ?? null;
  } catch (err) {
    logger.warn('Failed to resolve active company membership (non-critical)', { userId, error: String(err) });
    return null;
  }
}

/**
 * Links a worker to the company owned by `enterpriseUserId` (a users.id,
 * despite worker_invites/many call sites naming it "enterpriseId"), creating
 * the company's `enterprises`/`enterprise_members` owner row first if the
 * inviting enterprise hasn't saved their profile in Settings yet — an invite
 * can be sent and accepted before that happens, and the link must not be
 * silently dropped in that case.
 */
async function linkWorkerToInviter(enterpriseUserId: string, workerId: string): Promise<void> {
  let companyId: string;
  const entRes = await query(`SELECT id FROM enterprises WHERE user_id = $1`, [enterpriseUserId]);
  if (entRes.rows.length) {
    companyId = entRes.rows[0].id;
  } else {
    const ownerRow = await query(`SELECT first_name FROM users WHERE id = $1`, [enterpriseUserId]);
    const placeholderName = ownerRow.rows[0]?.first_name ? `${ownerRow.rows[0].first_name}'s Company` : 'Company';
    const created = await query(
      `INSERT INTO enterprises (user_id, company_name) VALUES ($1, $2) RETURNING id`,
      [enterpriseUserId, placeholderName],
    );
    companyId = created.rows[0].id;
    await query(
      `INSERT INTO enterprise_members (enterprise_id, user_id, company_role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
      [companyId, enterpriseUserId],
    );
  }

  await query(
    `INSERT INTO enterprise_workers (enterprise_id, worker_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [companyId, workerId],
  );
}

/**
 * Marks a pending, unexpired invite token as accepted and links the worker.
 * Returns false (no exception) if the token is invalid/expired/already used —
 * callers decide whether that should block the caller's own request or not.
 */
async function acceptWorkerInvite(token: string, workerId: string): Promise<boolean> {
  const inv = await query(
    `UPDATE worker_invites SET status = 'accepted'
     WHERE token = $1 AND status = 'pending' AND expires_at > NOW()
     RETURNING enterprise_id`,
    [token],
  );
  if (!inv.rows.length) return false;

  const enterpriseUserId = inv.rows[0].enterprise_id;
  await linkWorkerToInviter(enterpriseUserId, workerId);

  // Notify the enterprise that their invited worker has joined
  try {
    const workerRow = await query('SELECT email FROM users WHERE id = $1', [workerId]);
    const workerEmail = workerRow.rows[0]?.email ?? 'A worker';
    await query(
      `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, 'worker_joined', 'New worker joined', $2, 'worker', $3)`,
      [enterpriseUserId, `${workerEmail} accepted your invite and joined your team.`, workerId],
    );
  } catch (notifErr) {
    logger.warn('Failed to emit worker_joined notification', { error: String(notifErr) });
  }

  return true;
}

/**
 * Resolves the requester's active company membership AND role in one query.
 * Deliberately separate from resolveActiveCompanyId: that helper swallows
 * all errors (must never fail login/registration over a non-critical JWT
 * claim), whereas authorization for company-invite routes must surface a
 * real 500 on a DB failure rather than silently falling through as "no
 * company." Company-role authorization is re-derived here on every request —
 * there is no company_role JWT/session claim by design (see companyAuth
 * notes in the plan); never trust a cached claim for this decision.
 */
async function resolveActiveMembership(userId: string): Promise<{ companyId: string; companyRole: string; ownerUserId: string } | null> {
  const r = await query(
    `SELECT em.enterprise_id AS company_id, em.company_role, e.user_id AS owner_user_id
       FROM enterprise_members em JOIN enterprises e ON e.id = em.enterprise_id
      WHERE em.user_id = $1 AND em.status = 'active'`,
    [userId],
  );
  if (!r.rows.length) return null;
  return { companyId: r.rows[0].company_id, companyRole: r.rows[0].company_role, ownerUserId: r.rows[0].owner_user_id };
}

/**
 * Marks a pending, unexpired company invite as accepted and adds the user to
 * enterprise_members. Diverges from acceptWorkerInvite's "mark accepted, then
 * link" order: linking a worker is unconditionally idempotent (ON CONFLICT DO
 * NOTHING can't fail), but joining a company CAN legitimately fail — the v1
 * "no company-switcher" partial unique index forbids a second active
 * membership. So this checks BEFORE consuming the token: if the token were
 * marked accepted first and the join then failed, it would strand the
 * invitee with a dead link and no way to retry short of a brand-new invite.
 * The whole thing runs in one transaction so a lost race (23505 from a
 * concurrent accept) rolls back the invite-accepted UPDATE too, leaving the
 * token usable for a genuine retry.
 */
async function acceptCompanyInvite(
  token: string,
  userId: string,
): Promise<'accepted' | 'invalid' | 'already_member'> {
  return transaction(async (client) => {
    const invRes = await client.query(
      `SELECT id, enterprise_id, company_role, invited_by
         FROM enterprise_member_invites
        WHERE token = $1 AND status = 'pending' AND expires_at > NOW()
        FOR UPDATE`,
      [token],
    );
    if (!invRes.rows.length) return 'invalid';
    const { id: inviteId, enterprise_id: companyId, company_role: companyRole, invited_by: inviterId } = invRes.rows[0];

    // Must check BEFORE consuming the token — see doc comment above. This
    // catches ANY existing active membership, even in a different company
    // than the one this invite is for — that's the intended v1 boundary.
    const activeRes = await client.query(
      `SELECT 1 FROM enterprise_members WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    if (activeRes.rows.length) return 'already_member';

    await client.query(`UPDATE enterprise_member_invites SET status = 'accepted' WHERE id = $1`, [inviteId]);

    try {
      // ON CONFLICT DO UPDATE (not DO NOTHING) so re-inviting a previously
      // removed member (status='removed') reactivates their existing row
      // instead of hitting the UNIQUE(enterprise_id, user_id) violation a
      // bare INSERT would throw.
      await client.query(
        `INSERT INTO enterprise_members (enterprise_id, user_id, company_role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (enterprise_id, user_id) DO UPDATE
           SET status = 'active', company_role = EXCLUDED.company_role, updated_at = NOW()`,
        [companyId, userId, companyRole],
      );
    } catch (err: any) {
      if (err?.code === '23505') return 'already_member'; // lost a race; transaction rolls back the UPDATE above too
      throw err;
    }

    try {
      const joined = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
      const joinedEmail = joined.rows[0]?.email ?? 'A teammate';
      await client.query(
        `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
         VALUES ($1, 'member_joined', 'New team member joined', $2, 'enterprise_member', $3)`,
        [inviterId, `${joinedEmail} accepted your invite and joined your company.`, userId],
      );
    } catch (notifErr) {
      logger.warn('Failed to emit member_joined notification', { error: String(notifErr) });
    }

    return 'accepted';
  });
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'user-service' });
});

app.post('/auth/register/test', (req, res) => {
  res.json({ test: 'works', challenge: 'test-challenge' });
});

/**
 * Registers an auth handler at every path shape a request for it can arrive
 * on: `/auth/<path>` (what the gateway forwards `/auth/*` as), `/api/auth/<path>`
 * (kept for any direct, pre-rewrite caller), and — for routes that expect one —
 * a bare `/<path>` alias. One call site instead of three per handler, so
 * adding or changing a route can't silently drop one of the variants (as
 * happened with the `/login/dev-login` alias, handled separately below since
 * its bare form doesn't follow this pattern).
 */
function registerAuthRoute(path: string, handler: express.RequestHandler, { bareAlias = true } = {}) {
  app.post(`/auth/${path}`, handler);
  if (bareAlias) app.post(`/${path}`, handler);
  app.post(`/api/auth/${path}`, handler);
}

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
      // A fresh random WebAuthn user handle per registration attempt — deriving
      // it from the email local-part let two different accounts sharing a
      // local-part (e.g. john@companyA.com vs john@companyB.com) collide on
      // the same platform authenticator's resident-credential slot. Login
      // looks credentials up by credential_id, never by this handle, so it
      // doesn't need to be reproducible.
      userID: new Uint8Array(randomBytes(32)),
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

    logger.info('register/start: options generated', { email });

    // Return the FULL options object as-is
    res.status(200).json(options);
  } catch (err) {
    logger.error('register/start error', { error: String(err) });
    res.status(500).json({ error: 'Registration failed: ' + String(err) });
  }
};

registerAuthRoute('register/start', registerStartHandler);

/**
 * POST /auth/register/finish
 * Body: { email, credential: RegistrationResponseJSON }
 * Verifies the WebAuthn credential, creates the user with a classic
 * Stellar account, and returns a JWT.
 */
const registerFinishHandler = async (req: express.Request, res: express.Response) => {
  try {
    const { email, credential, origin, inviteToken, companyInviteToken } = req.body as {
      email: string;
      credential: Record<string, unknown>;
      origin?: string;
      inviteToken?: string;
      companyInviteToken?: string;
    };
    if (!email || !credential) throw new ValidationError('email and credential are required');

    const session = await getJSON<{ challenge: string; role: UserRole }>(`reg:${email}`);
    if (!session) {
      logger.warn('register/finish: challenge not found', { email });
      return res.status(400).json({ error: 'Registration session expired. Please start again.' });
    }

    const clientOrigin = origin || req.headers.origin || RP_ORIGIN;
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: credential as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge: session.challenge,
        expectedOrigin: clientOrigin,
        expectedRPID: RP_ID,
        requireUserVerification: false,
      });
    } catch (verifyErr) {
      // @simplewebauthn/server throws plain Errors (not a distinguishable
      // class) for an expired/mismatched challenge or bad origin — treat any
      // of them as one client-facing validation error instead of guessing
      // the cause from the error message text.
      logger.warn('register/finish: WebAuthn verification threw', { email, error: String(verifyErr) });
      throw new ValidationError('Invalid or expired challenge');
    }

    logger.info('register/finish: credential verified', { email, verified: verification.verified });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Passkey verification failed' });
    }

    const { credentialID, credentialPublicKey, counter, aaguid } =
      verification.registrationInfo;

    // transports come from the client credential response, not registrationInfo in v10
    // For platform authenticators (Windows Hello), transports should be ['internal']
    const transports = (credential as { transports?: string[] }).transports ?? ['internal'];

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

    // Link an invited worker to their employer in the SAME request that
    // creates the account, rather than depending on a separate follow-up
    // call from the browser after registration — that call can be lost to a
    // dropped connection, tab close, etc., leaving the invite stuck pending
    // and the worker registered but never linked, with no retry.
    let inviteLinked: boolean | undefined;
    if (inviteToken && session.role === 'worker') {
      try {
        inviteLinked = await acceptWorkerInvite(inviteToken, userId);
        if (!inviteLinked) logger.warn('register/finish: invite token invalid/expired', { email, inviteToken });
      } catch (err) {
        inviteLinked = false;
        logger.error('register/finish: invite acceptance failed', { email, error: String(err) });
      }
    }

    // Same atomic-linking principle as the worker invite above, for joining
    // an existing company as a teammate.
    let companyInviteLinked: boolean | undefined;
    let companyInviteError: string | undefined;
    if (companyInviteToken && session.role === 'enterprise') {
      try {
        const result = await acceptCompanyInvite(companyInviteToken, userId);
        companyInviteLinked = result === 'accepted';
        if (result === 'already_member') {
          companyInviteError = 'already_member';
          logger.info('register/finish: company invite skipped, already in a company', { email });
        } else if (result === 'invalid') {
          logger.warn('register/finish: company invite token invalid/expired', { email, companyInviteToken });
        }
      } catch (err) {
        companyInviteLinked = false;
        logger.error('register/finish: company invite acceptance failed', { email, error: String(err) });
      }
    }

    await deleteKey(`reg:${email}`);

    const companyId = await resolveActiveCompanyId(userId);
    const accessToken = generateToken(userId, email, session.role, companyId ?? undefined);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId, email, role: session.role, companyId },
      REFRESH_TOKEN_TTL_SEC,
    );

    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      accessToken,
      userId,
      email,
      role: session.role,
      companyId,
      ...(inviteLinked !== undefined ? { inviteLinked } : {}),
      ...(companyInviteLinked !== undefined ? { companyInviteLinked } : {}),
      ...(companyInviteError !== undefined ? { companyInviteError } : {}),
    });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCode = (err as any)?.code;
    logger.error('register/finish failed', { error: errorMsg, code: errorCode, stack: err instanceof Error ? err.stack : undefined });

    if (errorCode === '23505') return res.status(409).json({ error: 'Email already registered' });

    res.status(500).json({ error: process.env.NODE_ENV === 'development' ? errorMsg : 'Internal server error' });
  }
};

registerAuthRoute('register/finish', registerFinishHandler);

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

registerAuthRoute('login/start', loginStartHandler);

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

    const companyId = await resolveActiveCompanyId(userId);
    const accessToken = generateToken(userId, email, role, companyId ?? undefined);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId, email, role, companyId },
      REFRESH_TOKEN_TTL_SEC,
    );

    setRefreshCookie(res, refreshToken);
    res.json({ accessToken, userId, email, role, companyId });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof AuthenticationError) return res.status(401).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    logger.error('login/finish failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

registerAuthRoute('login/finish', loginFinishHandler);

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
    const companyId = await resolveActiveCompanyId(userId);
    const accessToken = generateToken(userId, email, role, companyId ?? undefined);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId, email, role, companyId },
      REFRESH_TOKEN_TTL_SEC,
    );
    setRefreshCookie(res, refreshToken);

    logger.info('dev-login: signed in without passkey', { userId, email, role });
    res.json({ accessToken, userId, email, role, companyId });
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

    const session = await getJSON<{ userId: string; email: string; role: UserRole; companyId?: string | null }>(
      `refresh:${hashRefreshToken(token)}`,
    );
    if (!session) throw new AuthenticationError('Refresh token expired or invalid');

    const accessToken = generateToken(session.userId, session.email, session.role, session.companyId ?? undefined);

    // Rotate refresh token
    await deleteKey(`refresh:${hashRefreshToken(token)}`);
    const newRefresh = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(newRefresh)}`,
      session,
      REFRESH_TOKEN_TTL_SEC,
    );
    setRefreshCookie(res, newRefresh);

    res.json({ accessToken, companyId: session.companyId ?? null });
  } catch (err) {
    if (err instanceof AuthenticationError) return res.status(401).json({ error: err.message });
    logger.error('refresh failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

registerAuthRoute('refresh', refreshHandler);

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

registerAuthRoute('logout', logoutHandler);

// ── Users ─────────────────────────────────────────────────────────────────────

/** Resolves the `enterprises.id` for a user, or null if they have no company profile yet. */
/** True if `workerId` is an active worker of company `companyId` (enterprises.id). */
async function isOwnWorker(companyId: string, workerId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM enterprise_workers WHERE enterprise_id = $1 AND worker_id = $2 AND status = 'active'`,
    [companyId, workerId],
  );
  return r.rows.length > 0;
}

/**
 * GET /users/summary — the calling enterprise's own team size, by role.
 * (Not a platform-wide count — every caller here is the enterprise dashboard's
 * own overview stat, so scoping to "my workers" is the correct contract.)
 */
app.get('/users/summary', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) {
    return res.status(403).json({ error: 'Enterprise role required' });
  }

  try {
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.json({ total: 0, byRole: {} });
    const enterpriseId = membership.companyId;

    const total = await query(
      `SELECT COUNT(*) AS total FROM enterprise_workers WHERE enterprise_id = $1 AND status = 'active'`,
      [enterpriseId],
    );
    const byRole = await query(
      `SELECT u.role, COUNT(*) AS count
         FROM enterprise_workers ew JOIN users u ON u.id = ew.worker_id
        WHERE ew.enterprise_id = $1 AND ew.status = 'active'
        GROUP BY u.role`,
      [enterpriseId],
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

/** GET /users — the calling enterprise's own workers (optionally filtered by search). */
app.get('/users', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) {
    return res.status(403).json({ error: 'Enterprise role required' });
  }

  try {
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.json({ users: [], total: 0 });
    const enterpriseId = membership.companyId;

    const search = req.query.search as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    const offset = Number(req.query.offset ?? 0);

    let sql = `SELECT u.id, u.email, u.role, u.status, u.country, u.preferred_currency, u.stellar_public_key, u.created_at
                 FROM enterprise_workers ew JOIN users u ON u.id = ew.worker_id
                WHERE ew.enterprise_id = $1 AND ew.status = 'active'`;
    const params: any[] = [enterpriseId];

    if (search) {
      sql += ` AND (u.email ILIKE $${params.length + 1} OR u.first_name ILIKE $${params.length + 1} OR u.last_name ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    const countSql = sql;
    const countParams = [...params];

    sql += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    const total = await query(`SELECT COUNT(*) AS total FROM (${countSql}) t`, countParams);

    res.json({
      users: result.rows,
      total: Number(total.rows[0].total),
    });
  } catch (err) {
    logger.error('users list failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /users/:id — self-lookup, or an enterprise looking up one of its own workers. */
app.get('/users/:id', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

  try {
    const isSelf = requesterId === req.params.id;
    let membership: { companyId: string; companyRole: string; ownerUserId: string } | null = null;
    if (requesterRole === 'enterprise' && requesterId) {
      membership = await resolveActiveMembership(requesterId);
    }
    let isOwner = false;
    if (!isSelf && membership) {
      isOwner = await isOwnWorker(membership.companyId, req.params.id);
    }
    if (!isSelf && !isOwner) {
      return res.status(403).json({ error: 'Not authorized to view this user' });
    }

    // Company fields are resolved via enterprise_members (not the owner-only
    // enterprises.user_id) so an admin/member teammate's self-lookup sees the
    // same company name as the owner — same fix as the Phase 2 cutover.
    const companyId = isSelf ? (membership?.companyId ?? null) : null;
    const result = await query(
      `SELECT u.id, u.email, u.role, u.status, u.country, u.preferred_currency, u.created_at,
              e.company_name, e.company_registration, e.country AS company_country
         FROM users u
         LEFT JOIN enterprises e ON e.id = $2
        WHERE u.id = $1`,
      [req.params.id, companyId],
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
 * Enterprise: updates company_name/company_registration/company_country in
 * the enterprises table (company_country is the company's country of
 * incorporation — distinct from the account holder's personal `country`).
 * Any role: updates first_name, last_name, phone, country in users.
 */
const patchMeHandler = async (req: express.Request, res: express.Response) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const { company_name, company_registration, company_country, first_name, last_name, phone, country } =
    req.body as Record<string, string | undefined>;

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

    if (company_name !== undefined || company_registration !== undefined || company_country !== undefined) {
      // company_name is NOT NULL on enterprises — resolve it from the request
      // or an existing row before inserting, since this save might only be
      // touching company_registration/company_country.
      const existing = await query('SELECT company_name FROM enterprises WHERE user_id = $1', [userId]);
      const resolvedName = company_name ?? existing.rows[0]?.company_name;
      if (!resolvedName) {
        return res.status(400).json({ error: 'company_name is required before setting other company fields' });
      }
      const enterpriseRow = await query(
        `INSERT INTO enterprises (user_id, company_name, company_registration, country)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           company_name = EXCLUDED.company_name,
           company_registration = COALESCE($3, enterprises.company_registration),
           country = COALESCE($4, enterprises.country),
           updated_at = NOW()
         RETURNING id`,
        [userId, resolvedName, company_registration ?? null, company_country ?? null],
      );

      // This is the lazy company-creation path (registration itself doesn't
      // create one) — without this, resolveActiveCompanyId would stay null
      // forever for every company created from here on, since only migration
      // 007's one-time backfill populates enterprise_members otherwise.
      await query(
        `INSERT INTO enterprise_members (enterprise_id, user_id, company_role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (enterprise_id, user_id) DO NOTHING`,
        [enterpriseRow.rows[0].id, userId],
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

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// ── Worker invites ────────────────────────────────────────────────────────────

app.post('/invites', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  const requesterRole = req.headers['x-user-role'] as string;
  if (requesterRole !== 'enterprise') return res.status(403).json({ error: 'Enterprise role required' });

  const { email } = req.body as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const normalizedEmail = email.toLowerCase();

  try {
    // worker_invites.enterprise_id stores the company OWNER's users.id, not
    // the requester's own id — resolve membership first so an invited
    // admin/member teammate (not just the owner) can invite workers too.
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.status(403).json({ error: 'You do not belong to a company' });
    const ownerUserId = membership.ownerUserId;

    // Don't re-invite someone already an active worker of THIS enterprise —
    // a worker can legitimately work for multiple companies, so this is
    // scoped to the requester's company, not a global "already a worker" check.
    const existingWorker = await query(
      `SELECT 1 FROM enterprise_workers ew
         JOIN enterprises e ON e.id = ew.enterprise_id
         JOIN users u ON u.id = ew.worker_id
        WHERE e.user_id = $1 AND u.email = $2 AND ew.status = 'active'`,
      [ownerUserId, normalizedEmail],
    );
    if (existingWorker.rows.length > 0) {
      return res.status(409).json({ error: 'This person is already part of your team' });
    }

    // Reuse/refresh an existing pending invite instead of piling up duplicate
    // rows for the same email — a re-invite reads as "resend", so old copies
    // of the link correctly stop working once the token is regenerated.
    const existingInvite = await query(
      `SELECT id FROM worker_invites WHERE enterprise_id = $1 AND email = $2 AND status = 'pending'`,
      [ownerUserId, normalizedEmail],
    );

    const token = randomBytes(32).toString('hex');
    if (existingInvite.rows.length > 0) {
      await query(
        `UPDATE worker_invites SET token = $1, expires_at = NOW() + INTERVAL '7 days' WHERE id = $2`,
        [token, existingInvite.rows[0].id],
      );
    } else {
      await query(
        `INSERT INTO worker_invites (enterprise_id, email, token) VALUES ($1, $2, $3)`,
        [ownerUserId, normalizedEmail, token],
      );
    }

    const baseUrl = process.env.APP_URL || 'http://localhost:3100';
    const inviteUrl = `${baseUrl}/register?role=worker&invite=${token}&email=${encodeURIComponent(email)}`;
    return res.status(201).json({ token, inviteUrl });
  } catch (err) {
    logger.error('Create invite failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

app.get('/invites', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  const requesterRole = req.headers['x-user-role'] as string;
  if (requesterRole !== 'enterprise') return res.status(403).json({ error: 'Enterprise role required' });

  try {
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.json({ invites: [] });

    // Exclude invites whose email is already an active worker of this
    // enterprise, regardless of the invite row's own `status` — an older
    // invite can be left 'pending' in the DB even after the person joined
    // through a separate, later invite. Ground truth is enterprise_workers,
    // not this row's status column.
    const result = await query(
      `SELECT wi.id, wi.email, wi.status, wi.created_at, wi.expires_at
         FROM worker_invites wi
        WHERE wi.enterprise_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM enterprise_workers ew
              JOIN enterprises e ON e.id = ew.enterprise_id
              JOIN users u ON u.id = ew.worker_id
             WHERE e.user_id = wi.enterprise_id AND u.email = wi.email AND ew.status = 'active'
          )
        ORDER BY wi.created_at DESC`,
      [membership.ownerUserId],
    );
    return res.json({ invites: result.rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list invites' });
  }
});

app.get('/invites/:token', async (req, res) => {
  try {
    const result = await query(
      `SELECT wi.id, wi.enterprise_id, wi.email, wi.status, wi.expires_at, e.company_name
         FROM worker_invites wi
         LEFT JOIN enterprises e ON e.user_id = wi.enterprise_id
        WHERE wi.token = $1`,
      [req.params.token],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invite not found' });
    const invite = result.rows[0];
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite has expired or already been used' });
    }
    return res.json({ email: invite.email, enterpriseId: invite.enterprise_id, companyName: invite.company_name });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to validate invite' });
  }
});

// Kept for a worker who already has an account (invited to a second company,
// or the registration-time atomic accept below couldn't run for some reason).
// The primary path is now inviteToken passed directly to /auth/register/finish.
app.post('/invites/:token/accept', async (req, res) => {
  const workerId = req.headers['x-user-id'] as string;
  if (!workerId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const accepted = await acceptWorkerInvite(req.params.token, workerId);
    if (!accepted) return res.status(410).json({ error: 'Invite expired or already used' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Accept invite failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// ── Company invites ───────────────────────────────────────────────────────────

app.post('/company/invites', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  if (!requesterId) return res.status(401).json({ error: 'Not authenticated' });

  const { email, companyRole = 'member' } = req.body as { email?: string; companyRole?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!['admin', 'member'].includes(companyRole)) {
    return res.status(400).json({ error: "companyRole must be 'admin' or 'member'" });
  }
  const normalizedEmail = email.toLowerCase();

  try {
    // Diverges from worker invites: authorization here is NOT the platform
    // x-user-role header (any logged-in enterprise user could send worker
    // invites) — it's a fresh enterprise_members lookup, since only
    // owner/admin may invite, and company_role is never cached in the JWT.
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.status(403).json({ error: 'You do not belong to a company' });
    if (!['owner', 'admin'].includes(membership.companyRole)) {
      return res.status(403).json({ error: 'Only company owners and admins can invite teammates' });
    }
    const { companyId } = membership;

    const existingMember = await query(
      `SELECT 1 FROM enterprise_members em
         JOIN users u ON u.id = em.user_id
        WHERE em.enterprise_id = $1 AND u.email = $2 AND em.status = 'active'`,
      [companyId, normalizedEmail],
    );
    if (existingMember.rows.length > 0) {
      return res.status(409).json({ error: 'This person is already part of your company' });
    }

    const existingInvite = await query(
      `SELECT id FROM enterprise_member_invites WHERE enterprise_id = $1 AND email = $2 AND status = 'pending'`,
      [companyId, normalizedEmail],
    );

    const token = randomBytes(32).toString('hex');
    if (existingInvite.rows.length > 0) {
      // Also refresh company_role — a re-invite with a different intended
      // role must not silently keep the stale one (no equivalent concern in
      // the worker flow, which has no per-invite role).
      await query(
        `UPDATE enterprise_member_invites
            SET token = $1, company_role = $2, expires_at = NOW() + INTERVAL '7 days'
          WHERE id = $3`,
        [token, companyRole, existingInvite.rows[0].id],
      );
    } else {
      await query(
        `INSERT INTO enterprise_member_invites (enterprise_id, invited_by, email, company_role, token)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, requesterId, normalizedEmail, companyRole, token],
      );
    }

    const baseUrl = process.env.APP_URL || 'http://localhost:3100';
    const inviteUrl = `${baseUrl}/register?role=enterprise&teamInvite=${token}&email=${encodeURIComponent(email)}`;
    return res.status(201).json({ token, inviteUrl });
  } catch (err) {
    logger.error('Create company invite failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

app.get('/company/invites', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  if (!requesterId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.status(403).json({ error: 'You do not belong to a company' });
    if (!['owner', 'admin'].includes(membership.companyRole)) {
      return res.status(403).json({ error: 'Only company owners and admins can view invites' });
    }

    // Same "ground truth is the members table, not this row's own status"
    // pattern as GET /invites.
    const result = await query(
      `SELECT emi.id, emi.email, emi.company_role, emi.status, emi.created_at, emi.expires_at
         FROM enterprise_member_invites emi
        WHERE emi.enterprise_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM enterprise_members em
              JOIN users u ON u.id = em.user_id
             WHERE em.enterprise_id = emi.enterprise_id AND u.email = emi.email AND em.status = 'active'
          )
        ORDER BY emi.created_at DESC`,
      [membership.companyId],
    );
    return res.json({ invites: result.rows });
  } catch (err) {
    logger.error('List company invites failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to list invites' });
  }
});

// Public (see api-gateway PUBLIC_GET_PATTERNS) — same possession-of-token
// authorization model as GET /invites/:token.
app.get('/company/invites/:token', async (req, res) => {
  try {
    // INNER JOIN, not LEFT — enterprise_member_invites.enterprise_id
    // correctly FKs enterprises.id from day one, unlike worker_invites'
    // LEFT JOIN which exists only to tolerate its users.id/enterprises.id
    // naming mismatch.
    const result = await query(
      `SELECT emi.email, emi.enterprise_id, emi.company_role, emi.status, emi.expires_at, e.company_name
         FROM enterprise_member_invites emi
         JOIN enterprises e ON e.id = emi.enterprise_id
        WHERE emi.token = $1`,
      [req.params.token],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invite not found' });
    const invite = result.rows[0];
    if (invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite has expired or already been used' });
    }
    return res.json({
      email: invite.email,
      companyId: invite.enterprise_id,
      companyName: invite.company_name,
      companyRole: invite.company_role,
    });
  } catch (err) {
    logger.error('Validate company invite failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to validate invite' });
  }
});

// Kept for an already-registered enterprise user accepting a standalone
// invite (edge case, not the primary path). Same gateway-authenticated
// x-user-id pattern as POST /invites/:token/accept (worker).
app.post('/company/invites/:token/accept', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  if (!requesterId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await acceptCompanyInvite(req.params.token, requesterId);
    if (result === 'invalid') return res.status(410).json({ error: 'Invite expired or already used' });
    if (result === 'already_member') return res.status(409).json({ error: 'This account already belongs to a company' });
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Accept company invite failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// One endpoint serves both "show the team list" and "know my own role" —
// deliberately avoids adding a company_role JWT/session claim for v1.
app.get('/company/members', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  if (!requesterId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.json({ members: [], myRole: null });

    const result = await query(
      `SELECT em.user_id, u.email, em.company_role, em.created_at
         FROM enterprise_members em
         JOIN users u ON u.id = em.user_id
        WHERE em.enterprise_id = $1 AND em.status = 'active'
        ORDER BY em.created_at ASC`,
      [membership.companyId],
    );
    return res.json({
      members: result.rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        companyRole: r.company_role,
        joinedAt: r.created_at,
      })),
      myRole: membership.companyRole,
    });
  } catch (err) {
    logger.error('List company members failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to list members' });
  }
});

// Soft-delete only — never a hard delete, matches the invite-status pattern
// and keeps a history/audit trail. Permission matrix mirrors common SaaS
// conventions: owners can remove anyone but themselves/other owners, admins
// can remove members but not other admins (prevents admins removing each
// other). Self-removal ("leave a company") is a distinct feature, not this one.
app.delete('/company/members/:userId', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string;
  if (!requesterId) return res.status(401).json({ error: 'Not authenticated' });

  const targetUserId = req.params.userId;
  if (targetUserId === requesterId) {
    return res.status(400).json({ error: 'You cannot remove yourself' });
  }

  try {
    const membership = await resolveActiveMembership(requesterId);
    if (!membership) return res.status(403).json({ error: 'You do not belong to a company' });
    if (!['owner', 'admin'].includes(membership.companyRole)) {
      return res.status(403).json({ error: 'Only company owners and admins can remove teammates' });
    }

    const targetRes = await query(
      `SELECT company_role FROM enterprise_members
        WHERE enterprise_id = $1 AND user_id = $2 AND status = 'active'`,
      [membership.companyId, targetUserId],
    );
    if (!targetRes.rows.length) {
      return res.status(404).json({ error: 'This person is not part of your company' });
    }
    const targetRole = targetRes.rows[0].company_role;

    if (targetRole === 'owner') {
      return res.status(403).json({ error: 'The company owner cannot be removed' });
    }
    if (membership.companyRole === 'admin' && targetRole === 'admin') {
      return res.status(403).json({ error: 'Only the owner can remove another admin' });
    }

    await query(
      `UPDATE enterprise_members SET status = 'removed', updated_at = NOW()
        WHERE enterprise_id = $1 AND user_id = $2`,
      [membership.companyId, targetUserId],
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Remove company member failed', { error: String(err) });
    return res.status(500).json({ error: 'Failed to remove teammate' });
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

app.get('/notifications', async (req, res) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const limit = Math.min(Number(req.query.limit ?? 30), 100);
  const offset = Number(req.query.offset ?? 0);

  try {
    const [rows, unread] = await Promise.all([
      query(
        `SELECT id, type, title, body, entity_type, entity_id, read_at, created_at
           FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      query(
        `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      ),
    ]);
    res.json({ notifications: rows.rows, unreadCount: Number(unread.rows[0].count) });
  } catch (err) {
    logger.error('Failed to fetch notifications', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Must be registered before /:id/read to avoid being captured by the param route
app.patch('/notifications/read-all', async (req, res) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    await query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/notifications/:id/read', async (req, res) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const result = await query(
      `UPDATE notifications SET read_at = NOW()
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL
        RETURNING id`,
      [req.params.id, userId],
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Account recovery (magic link) ────────────────────────────────────────────

const RECOVERY_TTL_SEC = 15 * 60; // 15 minutes

/**
 * POST /auth/recovery/start
 * Body: { email }
 * Sends a magic sign-in link to the user's email for re-enrolling a passkey
 * on a new device. Always responds 200 even if the email is unknown (prevents
 * email enumeration).
 */
const recoveryStartHandler = async (req: express.Request, res: express.Response) => {
  const { email } = req.body as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  try {
    const result = await query(
      'SELECT id, role FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    // Always return 200 — don't reveal whether the account exists
    if (!result.rows.length) {
      return res.json({ ok: true });
    }

    const { id: userId, role } = result.rows[0];
    const token = randomBytes(32).toString('hex');
    const tokenHash = hashRefreshToken(token); // reuse sha256 helper

    await setJSON(
      `recovery:${tokenHash}`,
      { userId, email: email.toLowerCase(), role },
      RECOVERY_TTL_SEC,
    );

    const appUrl = process.env.APP_URL || 'http://localhost:3100';
    const link = `${appUrl}/recovery/verify?token=${token}`;

    await sendRecoveryEmail(email.toLowerCase(), link);

    return res.json({ ok: true });
  } catch (err) {
    logger.error('recovery/start failed', { error: String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

registerAuthRoute('recovery/start', recoveryStartHandler, { bareAlias: false });

/**
 * POST /auth/recovery/verify
 * Body: { token }
 * Verifies the magic link token, issues an access + refresh token pair,
 * and deletes the recovery token (single-use).
 */
const recoveryVerifyHandler = async (req: express.Request, res: express.Response) => {
  const { token } = req.body as { token?: string };
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const tokenHash = hashRefreshToken(token);
    const session = await getJSON<{ userId: string; email: string; role: UserRole }>(
      `recovery:${tokenHash}`,
    );

    if (!session) {
      return res.status(410).json({ error: 'Link has expired or already been used' });
    }

    // Single-use: delete immediately
    await deleteKey(`recovery:${tokenHash}`);

    const companyId = await resolveActiveCompanyId(session.userId);
    const accessToken = generateToken(session.userId, session.email, session.role, companyId ?? undefined);
    const refreshToken = randomBytes(64).toString('hex');
    await setJSON(
      `refresh:${hashRefreshToken(refreshToken)}`,
      { userId: session.userId, email: session.email, role: session.role, companyId },
      REFRESH_TOKEN_TTL_SEC,
    );

    setRefreshCookie(res, refreshToken);

    logger.info('recovery/verify: session issued', { userId: session.userId });
    return res.json({
      accessToken,
      userId: session.userId,
      email: session.email,
      role: session.role,
      companyId,
    });
  } catch (err) {
    logger.error('recovery/verify failed', { error: String(err) });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

registerAuthRoute('recovery/verify', recoveryVerifyHandler, { bareAlias: false });

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    await runInitialMigrations(join(__dirname, '../../database/migrations'));
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

start();
