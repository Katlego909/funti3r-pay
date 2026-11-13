import { isAxiosError } from 'axios';
import { api } from './client.js';
import { listAllPayments } from './payments.js';
import { listEscrows, listWalletCashouts } from './escrows.js';

/** Why the account cannot be closed yet; empty when nothing stops it. */
export async function getClosureBlockers(): Promise<string[]> {
  const { data } = await api.get<{ blockers: string[] }>('/users/me/closure');
  return data.blockers;
}

/** Closes the account for good. Rejects with the server's blockers (409) if something would be lost. */
export async function closeAccount(confirmEmail: string): Promise<void> {
  await api.post('/users/me/close', { confirmEmail });
}

/** A record the user has none of (no KYC submission yet, not a worker) comes back as null rather than failing. */
async function orNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (isAxiosError(err) && [403, 404].includes(err.response?.status ?? 0)) return null;
    throw err;
  }
}

/**
 * Everything the platform holds about the signed-in user, gathered from each service that owns a part of it
 * ("Download my data", POPIA s23 / NDPA access right).
 */
export async function collectMyData(userId: string, role: string) {
  const [account, kyc, kycHistory, payments, escrows, cashouts] = await Promise.all([
    api.get('/users/me/export').then((r) => r.data),
    orNull(() => api.get(`/compliance/${userId}`).then((r) => r.data)),
    orNull(() => api.get(`/compliance/${userId}/events`).then((r) => r.data)),
    listAllPayments(),
    listEscrows(),
    role === 'worker' ? listWalletCashouts() : Promise.resolve([]),
  ]);
  return { exportedAt: new Date().toISOString(), ...account, kyc, kycHistory, payments, escrows, cashouts };
}
