/**
 * Worker accounts are created on chain the first time money is sent to them, not at sign-up (a slow network must never
 * fail a registration). The platform sponsor pays every reserve, so a worker needs no XLM of their own: the account
 * itself, plus a USDC trustline, since escrows pay in USDC.
 */
import { activateAccount } from './stellar.js';
import { getCurrency } from './currencies.js';

export async function activateWorkerAccount(workerSecret: string): Promise<{ created: boolean; hash?: string }> {
  const usdc = getCurrency('USDC');
  return activateAccount(workerSecret, usdc?.issuer ? [{ code: usdc.code, issuer: usdc.issuer }] : []);
}
