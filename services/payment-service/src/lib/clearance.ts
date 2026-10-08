/**
 * Keeps a worker's on-chain escrow clearance in lockstep with the compliance
 * service's KYC + sanctions verdict.
 *
 * The escrow contract is the enforcement point: create/approve/claim revert
 * unless the worker holds a live clearance. This module is the bridge — it is
 * called right before each of those operations, so a worker flagged after
 * their last clearance is revoked on-chain BEFORE any money can move, and a
 * newly verified worker is cleared without a separate manual step.
 *
 * Fails closed: if the compliance service can't be reached, nothing is cleared.
 */
import axios from 'axios';
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';
import {
  attestationHash,
  isCleared,
  revokeClearance,
  setClearance,
} from './escrow.js';

const logger = createLogger('Clearance');

const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';
/** How long an on-chain clearance lives. Short, so a stale one self-expires. */
const CLEARANCE_TTL_SECONDS = Number(process.env.ESCROW_CLEARANCE_TTL_SECONDS) || 24 * 60 * 60;

/** The compliance verdict says this worker may not receive escrow funds. */
export class ComplianceBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComplianceBlockedError';
  }
}

interface ComplianceVerdict {
  status?: string;
  verified_at?: string | null;
  sanctions_status?: string;
  sanctions_checked_at?: string | null;
}

async function fetchVerdict(workerId: string): Promise<ComplianceVerdict> {
  try {
    const resp = await axios.get<ComplianceVerdict>(
      `${COMPLIANCE_SERVICE_URL}/${workerId}/status`,
      { timeout: 5000 },
    );
    return resp.data;
  } catch (err) {
    logger.error('Compliance lookup failed — blocking escrow movement', {
      workerId, error: String(err),
    });
    throw new ComplianceBlockedError('Compliance service unavailable');
  }
}

export interface ClearanceSync {
  cleared: boolean;
  /** Set when this call changed on-chain state (a clearance or a revocation). */
  txHash?: string;
}

/**
 * Brings the on-chain clearance for `workerPublic` in line with the current
 * verdict. Resolves when the worker is cleared on-chain; throws
 * ComplianceBlockedError when they are not (after revoking any stale clearance).
 */
export async function ensureCleared(workerId: string, workerPublic: string): Promise<ClearanceSync> {
  const verdict = await fetchVerdict(workerId);
  const eligible = verdict.status === 'verified' && (verdict.sanctions_status ?? 'clear') === 'clear';
  const onchain = await isCleared(workerPublic);

  if (eligible) {
    if (onchain) return { cleared: true };
    const expiry = Math.floor(Date.now() / 1000) + CLEARANCE_TTL_SECONDS;
    const txHash = await setClearance(
      workerPublic,
      expiry,
      attestationHash({
        workerId,
        status: verdict.status,
        verified_at: verdict.verified_at ?? null,
        sanctions_status: verdict.sanctions_status ?? 'clear',
        sanctions_checked_at: verdict.sanctions_checked_at ?? null,
      }),
    );
    logger.info('Worker cleared on-chain', { workerId, expiry, txHash });
    return { cleared: true, txHash };
  }

  const reason = verdict.sanctions_status === 'flagged'
    ? 'Worker is blocked pending compliance review (sanctions match)'
    : 'Worker KYC not verified';
  if (onchain) {
    const txHash = await revokeClearance(workerPublic);
    logger.warn('Worker clearance revoked on-chain', { workerId, reason, txHash });
  }
  throw new ComplianceBlockedError(reason);
}

/**
 * The employer funding an escrow is screened against the sanctions list too, not just the worker:
 * the company's registered name and its owner's name. Fails closed like the worker check.
 */
export async function screenEmployer(ownerUserId: string): Promise<void> {
  const r = await query(
    `SELECT e.company_name, u.first_name, u.last_name
       FROM users u LEFT JOIN enterprises e ON e.user_id = u.id WHERE u.id = $1`,
    [ownerUserId],
  );
  const row = r.rows[0];
  const names = [row?.company_name, [row?.first_name, row?.last_name].filter(Boolean).join(' ')]
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  if (names.length === 0) return;

  let matches: unknown[];
  try {
    const resp = await axios.post<{ matches: unknown[] }>(`${COMPLIANCE_SERVICE_URL}/screen`, { names }, { timeout: 5000 });
    matches = resp.data.matches ?? [];
  } catch (err) {
    logger.error('Employer screening failed — blocking escrow funding', { ownerUserId, error: String(err) });
    throw new ComplianceBlockedError('Compliance service unavailable');
  }
  if (matches.length > 0) {
    logger.warn('Employer blocked by sanctions screening', { ownerUserId, matchCount: matches.length });
    throw new ComplianceBlockedError('Your company is blocked pending compliance review (sanctions match)');
  }
}
