/**
 * Every call the admin console makes. All of it goes through the gateway's /admin namespace (admin-only there and
 * again in each service), except the two escrow actions, which live on the escrow routes and are admin-only too.
 */
import { api } from '@funti3r/web-core';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- rows straight from the API
export interface Page { limit: number; offset: number }
export interface ListParams { status?: string; q?: string; limit?: number; offset?: number; frozen?: string; batchId?: string; role?: string }
export interface Counted { total: number }

export interface Readiness {
  status: string;
  httpStatus?: number;
  error?: string;
  checks?: Record<string, { critical: boolean; ok: boolean; ms: number; error?: string }>;
}
export type ChainRead<T> = T | { error: string };
export interface Ops {
  stuckPayments: Row[];
  stuckCashouts: Row[];
  pendingEscrowCreations: Row[];
  failedPayouts24h: { total: number; byReason: { reason: string; count: number }[] };
  sponsor: ChainRead<{ publicKey: string; spendableXlm: number }> | null;
  contract: ChainRead<{ address: string; admin: string; tokenAllowed: boolean }>;
}
export interface AccountDetail { user: Row; memberships: Row[]; employers: Row[]; passkeys: Row[]; invites: Row[] }
export interface CompanyDetail { company: Row; members: Row[]; workers: Row[]; invites: Row[] }
export interface AccountMoney {
  wallet: { address: string | null; balances: Row[] };
  payments: Row[]; escrows: Row[]; cashouts: Row[]; schedules: Row[];
}
export interface AuditQuery { entityType?: string; entityId?: string; actorId?: string; action?: string; limit?: number; offset?: number }

const get = async <T>(url: string, params?: object): Promise<T> => (await api.get<T>(url, { params })).data;
const post = async <T>(url: string, body?: object): Promise<T> => (await api.post<T>(url, body ?? {})).data;

export interface ProfileUpdate { first_name?: string; last_name?: string; phone?: string; country?: string }

/** The signed-in admin edits their own details (the same call the dashboard's account page makes). */
export const updateProfile = async (body: ProfileUpdate) => { await api.patch('/users/me', body); };

export const admin = {
  health: () => get<Record<string, Readiness>>('/admin/health'),
  ops: () => get<Ops>('/admin/ops'),
  search: (q: string) => get<{ users: Row[]; companies: Row[] }>('/admin/search', { q }),
  accounts: (p: ListParams) => get<Page & Counted & { accounts: Row[]; byRole: Record<string, number> }>('/admin/users', p),
  companies: (p: ListParams) => get<Page & Counted & { companies: Row[] }>('/admin/companies', p),
  account: (id: string) => get<AccountDetail>(`/admin/users/${id}`),
  company: (id: string) => get<CompanyDetail>(`/admin/companies/${id}`),
  money: (id: string) => get<AccountMoney>(`/admin/money/${id}`),
  suspend: (id: string, reason: string) => post<Row>(`/admin/users/${id}/suspend`, { reason }),
  reactivate: (id: string, reason: string) => post<Row>(`/admin/users/${id}/reactivate`, { reason }),

  payments: (p: ListParams) => get<Page & { payments: Row[] }>('/admin/payments', p),
  escrows: (p: ListParams) => get<Page & { escrows: Row[] }>('/admin/escrows', p),
  cashouts: (p: ListParams) => get<Page & { cashouts: Row[] }>('/admin/cashouts', p),
  batches: (p: ListParams) => get<Page & { batches: Row[] }>('/admin/batches', p),
  schedules: (p: ListParams) => get<Page & { schedules: Row[] }>('/admin/schedules', p),
  reconcile: (repair: boolean) =>
    post<{ repair: boolean; checked: number; repaired: number; unreadable: number; drift: Row[] }>('/admin/ops/reconcile-escrows', { repair }),
  freeze: (escrowId: string, frozen: boolean, reason: string) => post<{ frozen: boolean; txHash: string }>(`/escrows/${escrowId}/freeze`, { frozen, reason }),
  returnFrozen: (escrowId: string, reason: string) =>
    post<{ returned: number; tokenCode: string; txHash: string }>(`/escrows/${escrowId}/return-frozen`, { reason }),

  audit: (q: AuditQuery) => get<Page & { events: Row[] }>('/admin/audit', q),

  sanctionsStatus: () => get<{ list: { source: string; entryCount: number; fetchedAt: string } | null }>('/admin/compliance/sanctions/status'),
  refreshSanctions: () => post<Row>('/admin/compliance/sanctions/refresh'),
  flagged: () => get<{ flagged: Row[] }>('/admin/compliance/flagged'),
  kycQueue: (p: ListParams) => get<Page & Counted & { queue: Row[]; status: string }>('/admin/compliance/queue', p),
  kyc: (userId: string) => get<Row>(`/admin/compliance/${userId}`),
  /** KYC status for many people at once, from compliance (the only place it is kept). */
  kycStatuses: (userIds: string[]) => post<{ statuses: Record<string, { status: string }> }>('/admin/compliance/status/bulk', { userIds }),
  kycEvents: (userId: string) => get<{ events: Row[] }>(`/admin/compliance/${userId}/events`),
  revealKyc: (userId: string, reason: string) => post<Row>(`/admin/compliance/${userId}/reveal`, { reason }),
  approveKyc: (userId: string, reason: string) => post<{ status: string }>(`/admin/compliance/${userId}/approve`, { reason }),
  rejectKyc: (userId: string, reason: string) => post<{ status: string }>(`/admin/compliance/${userId}/reject`, { reason }),
};

/** A chain read that failed comes back as `{ error }` instead of failing the page. */
export const readFailed = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in v;
