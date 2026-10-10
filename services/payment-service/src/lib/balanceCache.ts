import { deleteKey } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('BalanceCache');

/** Redis key under which an account's balances are cached (see getAccountBalance in stellar.ts). */
export const balanceCacheKey = (publicKey: string): string => `stellar:balance:${publicKey}`;

/**
 * Drops cached balances so the next read comes from the network. Called right after money moves, so a user
 * never sees the old figure after their own payment, claim or cash-out. Redis is only a cache: a failure here
 * is logged and never fails the payment that already happened.
 */
export async function forgetBalances(...publicKeys: Array<string | null | undefined>): Promise<void> {
  const keys = [...new Set(publicKeys.filter((k): k is string => typeof k === 'string' && k.length > 0))];
  const results = await Promise.allSettled(keys.map((k) => deleteKey(balanceCacheKey(k))));
  results.forEach((r, i) => {
    if (r.status === 'rejected') logger.warn('Could not clear a cached balance', { account: keys[i], error: String(r.reason) });
  });
}

/**
 * Every account whose balance a transaction can change: the source, each operation's source and destination, and,
 * for a fee-bump, the fee payer and the wrapped transaction's accounts.
 */
export function accountsTouchedBy(tx: any): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && /^G[A-Z2-7]{55}$/.test(v)) out.add(v); };
  const walk = (t: any) => {
    if (!t) return;
    if (t.innerTransaction) { add(t.feeSource); walk(t.innerTransaction); return; }
    add(t.source);
    for (const op of t.operations ?? []) { add(op.source); add(op.destination); }
  };
  walk(tx);
  return [...out];
}
