import { api } from './client.js';

export interface EscrowMilestone {
  idx: number;
  description: string | null;
  /** In the escrow's token (see Escrow.tokenCode). */
  amount: number;
  status: 'pending' | 'approved' | 'claimed' | 'refunded';
  approvedAt: string | null;
  claimedAt: string | null;
  claimTxHash: string | null;
  approveTxHash: string | null;
  refundTxHash: string | null;
  /** Worker/employer review of the work itself (off-chain). */
  reviewStatus: 'none' | 'submitted' | 'rejected';
}

export interface ReviewEvent {
  idx: number;
  kind: 'submitted' | 'approved' | 'rejected';
  by: 'worker' | 'enterprise';
  note: string | null;
  links: string[];
  at: string;
}

export interface Escrow {
  id: string;
  workerId: string;
  workerEmail: string;
  onchainEscrowId: string;
  contractAddress: string;
  /** What the escrow locked: USDC for new escrows, XLM for earlier ones. Every amount on it is in this token. */
  tokenCode: string;
  total: number;
  status: 'active' | 'completed' | 'refunded';
  /** Compliance hold: the contract blocks approve, claim and refund. */
  frozen: boolean;
  expiresAt: string;
  createTxHash: string | null;
  createdAt: string;
  milestones: EscrowMilestone[];
  reviewEvents: ReviewEvent[];
}

export async function listEscrows(): Promise<Escrow[]> {
  const { data } = await api.get<{ escrows: Escrow[] }>('/escrows');
  return data.escrows;
}

export interface OnchainClearance {
  cleared: boolean;
  expiry: number | null; // unix seconds
  attestation: string | null; // hex hash of the screening record the contract holds
}

/** The worker's own compliance clearance as the escrow contract sees it. */
export async function getMyClearance(): Promise<OnchainClearance> {
  const { data } = await api.get<OnchainClearance>('/escrows/my-clearance');
  return data;
}

export interface CreateEscrowPayload {
  workerId: string;
  /** In USDC, so each milestone is its dollar value. */
  milestones: Array<{ description?: string; amount: string }>;
  expiresAt: string;
  /** Same key on a retry of the same escrow: the server replays it instead of locking the money twice. */
  idempotencyKey: string;
}

/**
 * 201: funded and recorded. 202 (`status: 'submitted'`): sent, but the network has not confirmed it yet; the escrow
 * appears in the list once it does (the server settles it from the chain within a few minutes).
 */
export type CreateEscrowResult =
  | { status?: undefined; id: string; onchainEscrowId: string; txHash: string; replayed?: boolean }
  | { status: 'submitted'; creationId: string; txHash: string };

export async function createEscrow(payload: CreateEscrowPayload): Promise<CreateEscrowResult> {
  const { data } = await api.post<CreateEscrowResult>('/escrows', payload);
  return data;
}

export async function approveMilestone(escrowId: string, idx: number): Promise<string> {
  const { data } = await api.post<{ txHash: string }>(`/escrows/${escrowId}/milestones/${idx}/approve`);
  return data.txHash;
}

export async function claimMilestone(escrowId: string, idx: number): Promise<string> {
  const { data } = await api.post<{ txHash: string }>(`/escrows/${escrowId}/milestones/${idx}/claim`);
  return data.txHash;
}

export async function refundEscrow(escrowId: string): Promise<{ refunded: number; tokenCode: string; txHash: string }> {
  const { data } = await api.post(`/escrows/${escrowId}/refund`);
  return data;
}

/** Worker hands a pending milestone in for the employer to review. */
export async function submitMilestoneWork(
  escrowId: string,
  idx: number,
  payload: { note: string; links: string[] },
): Promise<void> {
  await api.post(`/escrows/${escrowId}/milestones/${idx}/submit`, payload);
}

/** Employer sends submitted work back with a reason (nothing happens on-chain). */
export async function rejectMilestone(escrowId: string, idx: number, reason: string): Promise<void> {
  await api.post(`/escrows/${escrowId}/milestones/${idx}/reject`, { reason });
}

export interface MoneyGramSession {
  sessionToken: string;
  widgetUrl: string;
  publicKey: string;
  walletAddress: string;
  /** What the wallet can spare right now: its USDC is sent as is, its XLM converted for whatever USDC lacks. */
  maxUsdc: number;
  maxXlm: number;
}

export async function getCashoutOptions(): Promise<{ moneygram: boolean }> {
  const { data } = await api.get<{ moneygram: boolean }>('/escrows/cashout-options');
  return data;
}

/** Opens a MoneyGram widget session to cash out of the wallet balance. */
export async function startMoneyGramCashout(): Promise<MoneyGramSession> {
  const { data } = await api.post<MoneyGramSession>('/cashouts/moneygram/session');
  return data;
}

/** Pays the deposit MoneyGram's widget asked for; the server verifies it against MoneyGram first. */
export async function submitMoneyGramDeposit(
  payload: { address: string; memo: string; amount: string },
): Promise<{ txHash: string; status?: string }> {
  const { data } = await api.post<{ txHash: string; status?: string }>('/cashouts/moneygram/deposit', payload);
  return data;
}

/** One cash-out from the wallet through MoneyGram. */
export interface WalletCashout {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  mgStatus: string | null;
  /** Our USDC payment to MoneyGram. */
  settlementHash: string | null;
  xlmSpent: number | null;
  sendUsdc: string | null;
  /** The number the recipient quotes at the location to collect cash. */
  referenceNumber: string | null;
  destinationCountry: string | null;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  fee: string | null;
  feeCurrency: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  /** True on the MoneyGram sandbox: no real cash is dispensed. */
  sandbox: boolean;
}

export async function listWalletCashouts(): Promise<WalletCashout[]> {
  const { data } = await api.get<{ cashouts: WalletCashout[] }>('/cashouts');
  return data.cashouts;
}

/**
 * Escrow money, one row per token (USDC, and XLM for earlier escrows). Never add rows together as they are: convert
 * each with useDisplayCurrency first.
 */
export interface EscrowSummary {
  totals: Array<{ tokenCode: string; locked: number; claimed: number; refunded: number }>;
}

export async function getEscrowSummary(): Promise<EscrowSummary> {
  const { data } = await api.get<EscrowSummary>('/escrows/summary');
  return data;
}
