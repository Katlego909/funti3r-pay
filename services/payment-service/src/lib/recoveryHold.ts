import type { Request, Response, NextFunction } from 'express';
import { query } from '@funti3r/database';
import { AppError } from '@funti3r/shared-utils';

/**
 * How long after an email recovery the account may not move money out. Recovery skips the passkey, so anyone who
 * gets into the user's inbox gets a session; the hold gives the real owner time to notice before funds can leave.
 */
export const RECOVERY_HOLD_MS = 48 * 60 * 60 * 1000;

export class RecoveryHoldError extends AppError {
  constructor(until: Date) {
    super(
      403,
      `For your security, sending and cashing out money is paused until ${until.toUTCString()} because this account was recently recovered by email.`,
      'recovery_hold',
    );
    this.name = 'RecoveryHoldError';
  }
}

/** The end of the user's hold, or null when there is none. */
export async function recoveryHoldUntil(userId: string, now = Date.now()): Promise<Date | null> {
  const r = await query('SELECT recovered_at FROM users WHERE id = $1', [userId]);
  const recoveredAt = r.rows[0]?.recovered_at as Date | string | null | undefined;
  if (!recoveredAt) return null;
  const until = new Date(new Date(recoveredAt).getTime() + RECOVERY_HOLD_MS);
  return until.getTime() > now ? until : null;
}

/**
 * Put in front of every route that moves money out of the caller's account. Requests without an identity pass
 * through to the route's own auth check; a database error blocks the request rather than skipping the hold.
 */
export async function recoveryHold(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const userId = req.headers['x-user-id'];
  if (typeof userId !== 'string' || !userId) return next();
  try {
    const until = await recoveryHoldUntil(userId);
    next(until ? new RecoveryHoldError(until) : undefined);
  } catch (err) {
    next(err);
  }
}
