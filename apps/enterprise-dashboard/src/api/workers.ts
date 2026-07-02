import { api } from './client.js';

export interface Worker {
  id: string;
  email: string;
  role: string;
  status: string;
  country?: string;
  created_at: string;
}

export interface WorkerWallet {
  userId: string;
  walletType: string;
  address?: string;
  status?: string;
  balances?: Array<{ asset_type: string; asset_code?: string; balance: string }>;
}

export interface KYCStatus {
  status: string;
  verified_at?: string;
  submitted_at?: string | null;
  expires_at?: string;
  updated_at?: string;
}

export async function getWorker(id: string): Promise<Worker> {
  const { data } = await api.get<Worker>(`/users/${id}`);
  return data;
}

export async function getUserSummary(): Promise<{ total: number; byRole: Record<string, number> }> {
  const { data } = await api.get('/users/summary');
  return data;
}

export async function getWorkerWallet(userId: string): Promise<WorkerWallet> {
  const { data } = await api.get<WorkerWallet>(`/wallets/${userId}`);
  return data;
}

export async function getKYCStatus(userId: string): Promise<KYCStatus> {
  const { data } = await api.get<KYCStatus>(`/compliance/${userId}/status`);
  return data;
}

export async function submitKYC(payload: {
  userId: string;
  idType: string;
  idNumber: string;
  dateOfBirth?: string;
  country: string;
}) {
  const { data } = await api.post('/compliance/verify', payload);
  return data;
}
