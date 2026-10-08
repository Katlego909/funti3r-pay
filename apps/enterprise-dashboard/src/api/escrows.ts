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
  /** Second leg of a claim: routing the claimed funds through an anchor. */
  cashoutStatus: 'none' | 'pending' | 'action_required' | 'completed' | 'failed';
  anchorTxId: string | null;
  anchorSettlementHash: string | null;
  anchorStatus: string | null;
  /** The anchor's own page the worker must visit when action_required. */
  anchorMoreInfoUrl: string | null;
  cashoutError: string | null;
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
