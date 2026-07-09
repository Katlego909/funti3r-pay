import { api } from './client.js';

export interface EscrowMilestone {
  idx: number;
  description: string | null;
  amountXlm: number;
  status: 'pending' | 'approved' | 'claimed' | 'refunded';
  approvedAt: string | null;
  claimedAt: string | null;
  claimTxHash: string | null;
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

export async function claimMilestone(escrowId: string, idx: number): Promise<string> {
  const { data } = await api.post<{ txHash: string }>(`/escrows/${escrowId}/milestones/${idx}/claim`);
  return data.txHash;
}

export async function refundEscrow(escrowId: string): Promise<{ refundedXlm: number; txHash: string }> {
  const { data } = await api.post(`/escrows/${escrowId}/refund`);
  return data;
}
