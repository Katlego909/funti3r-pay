import { api } from './client.js';

export interface EscrowMilestone {
  idx: number;
  description: string | null;
  amountXlm: number;
  status: 'pending' | 'approved' | 'claimed' | 'refunded';
  approvedAt: string | null;
  claimedAt: string | null;
  claimTxHash: string | null;
  approveTxHash: string | null;
  refundTxHash: string | null;
  cashoutAt: string | null;
  /** Worker/employer review of the work itself (off-chain). */
  reviewStatus: 'none' | 'submitted' | 'rejected';
  /** Receipt of a completed anchor cash-out; null until paid out. */
  payout: {
    rail: 'anchor' | 'moneygram';
    /** MoneyGram: the number the recipient quotes at the location to collect cash. */
    referenceNumber: string | null;
    destinationCountry: string | null;
    sendUsdc: string | null;
    destination: { name: string | null; email: string | null; bankNumber: string | null; accountLast4: string | null } | null;
    receivedAmount: string | null;
    receivedAsset: string | null;
    fee: string | null;
    feeAsset: string | null;
    anchorDomain: string | null;
    /** True for the SDF test anchor: nothing real is deposited anywhere. */
    sandbox: boolean;
  } | null;
  /** Second leg of a claim: routing the claimed funds through an anchor. */
  cashoutStatus: 'none' | 'pending' | 'action_required' | 'completed' | 'failed';
  /** Which cash-out rail the milestone is on. */
  cashoutRail: 'anchor' | 'moneygram';
  rampsStatus: string | null;
  anchorTxId: string | null;
  anchorSettlementHash: string | null;
  anchorStatus: string | null;
  /** The anchor's own page the worker must visit when action_required. */
  anchorMoreInfoUrl: string | null;
  cashoutError: string | null;
}

export interface ReviewEvent {
  idx: number;
  kind: 'submitted' | 'approved' | 'rejected';
  by: 'worker' | 'enterprise';
  note: string | null;
  links: string[];
  at: string;
}

export interface CashoutResult {
  status: 'completed' | 'failed' | 'action_required';
  anchorTxId?: string;
  settlementHash?: string;
  anchorStatus?: string;
  moreInfoUrl?: string;
  error?: string;
}

export interface Escrow {
  id: string;
  workerId: string;
  workerEmail: string;
  onchainEscrowId: string;
  contractAddress: string;
  tokenCode: string;
  totalXlm: number;
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

export async function createEscrow(payload: {
  workerId: string;
  milestones: Array<{ description?: string; amountXlm: number }>;
  expiresAt: string;
}): Promise<{ id: string; onchainEscrowId: string; txHash: string }> {
  const { data } = await api.post('/escrows', payload);
  return data;
}

export async function approveMilestone(escrowId: string, idx: number): Promise<string> {
  const { data } = await api.post<{ txHash: string }>(`/escrows/${escrowId}/milestones/${idx}/approve`);
  return data.txHash;
}

export async function claimMilestone(
  escrowId: string,
  idx: number,
  opts?: { cashout?: 'anchor' },
): Promise<{ txHash: string; cashout?: CashoutResult }> {
  const { data } = await api.post<{ txHash: string; cashout?: CashoutResult }>(
    `/escrows/${escrowId}/milestones/${idx}/claim`,
    opts ?? {},
  );
  return data;
}

/** Cash out an already-claimed milestone through the anchor (or resume one). */
export async function cashOutMilestone(escrowId: string, idx: number): Promise<CashoutResult> {
  const { data } = await api.post<{ cashout: CashoutResult }>(`/escrows/${escrowId}/milestones/${idx}/cashout`);
  return data.cashout;
}

export async function refundEscrow(escrowId: string): Promise<{ refundedXlm: number; txHash: string }> {
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
  /** The most XLM this cash-out can spend: the milestone's own amount. */
  maxXlm: number;
}

export async function getCashoutOptions(): Promise<{ moneygram: boolean; anchor: boolean }> {
  const { data } = await api.get<{ moneygram: boolean; anchor: boolean }>('/escrows/cashout-options');
  return data;
}

/** Opens a MoneyGram widget session for a claimed milestone. */
export async function startMoneyGramCashout(escrowId: string, idx: number): Promise<MoneyGramSession> {
  const { data } = await api.post<MoneyGramSession>(`/escrows/${escrowId}/milestones/${idx}/ramps/session`);
  return data;
}

/** Pays the deposit MoneyGram's widget asked for; the server verifies it against MoneyGram first. */
export async function submitMoneyGramDeposit(
  escrowId: string,
  idx: number,
  payload: { address: string; memo: string; amount: string },
): Promise<{ txHash: string; status?: string }> {
  const { data } = await api.post<{ txHash: string; status?: string }>(
    `/escrows/${escrowId}/milestones/${idx}/ramps/deposit`,
    payload,
  );
  return data;
}
