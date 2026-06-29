import { api } from './client.js';

export interface Payment {
  id: string;
  enterprise_id: string;
  worker_id: string;
  worker_email?: string;
  amount: number;
  currency: string;
  status: string;
  rail: string;
  stellar_tx_hash?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentSummary {
  totalCount: number;
  totalVolume: number;
  completedVolume: number;
  successRate: number;
  byStatus: Record<string, number>;
}

export interface Quote {
  rail: string;
  sourceCurrency: string;
  destinationCurrency: string;
  exchangeRate: number;
  fee: number;
  estimatedDeliveryMinutes: number;
  quoteId?: string;
}

export async function getSummary(): Promise<PaymentSummary> {
  const { data } = await api.get<PaymentSummary>('/payouts/summary');
  return data;
}

export async function getRecentPayments(limit = 10): Promise<Payment[]> {
  const { data } = await api.get<{ payments: Payment[] }>('/payouts/recent', { params: { limit } });
  return data.payments;
}

export async function listPayments(params: {
  enterpriseId?: string;
  workerId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ payments: Payment[]; total: number }> {
  const { data } = await api.get<{ payments: Payment[]; total: number }>('/payouts', { params });
  return data;
}

export async function getQuotes(params: {
  amount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationCountry: string;
}): Promise<Quote[]> {
  const { data } = await api.get<{ quotes: Quote[] }>('/payouts/quotes', { params });
  return data.quotes;
}

export async function initiatePayment(payload: {
  enterpriseId: string;
  workerId: string;
  amount: number;
  currency: string;
  destinationCountry: string;
  idempotencyKey?: string;
  preferFiat?: boolean;
  quoteId?: string;
  recipientName?: string;
  recipientAccount?: string;
}) {
  const { data } = await api.post('/payouts', payload);
  return data;
}

export async function getPayment(id: string): Promise<Payment> {
  const { data } = await api.get<Payment>(`/payouts/${id}`);
  return data;
}
