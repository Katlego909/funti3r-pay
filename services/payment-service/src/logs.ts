import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('PaymentLogs');

export interface PaymentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  action: string;
  paymentId?: string;
  txHash?: string;
  status?: string;
  details?: any;
}

// In-memory log store (in production, use database or logging service)
const logs: PaymentLog[] = [];
const MAX_LOGS = 1000;

export function addLog(
  level: 'info' | 'warn' | 'error',
  component: string,
  action: string,
  details?: any
): void {
  const log: PaymentLog = {
    timestamp: new Date().toISOString(),
    level,
    component,
    action,
    details,
  };

  // Extract payment ID if in details
  if (details?.paymentId) {
    log.paymentId = details.paymentId;
  }
  if (details?.txHash) {
    log.txHash = details.txHash;
  }
  if (details?.status) {
    log.status = details.status;
  }

  logs.push(log);

  // Keep only last N logs
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  // Also log via logger
  logger[level](action, details);
}

export function getLogs(options?: {
  paymentId?: string;
  component?: string;
  level?: string;
  limit?: number;
}): PaymentLog[] {
  let filtered = [...logs];

  if (options?.paymentId) {
    filtered = filtered.filter(l => l.paymentId === options.paymentId);
  }

  if (options?.component) {
    filtered = filtered.filter(l => l.component === options.component);
  }

  if (options?.level) {
    filtered = filtered.filter(l => l.level === options.level);
  }

  // Most recent first
  filtered.reverse();

  if (options?.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

export function getLogsSummary(): {
  total: number;
  byComponent: Record<string, number>;
  byLevel: Record<string, number>;
  recent: PaymentLog[];
} {
  const byComponent: Record<string, number> = {};
  const byLevel: Record<string, number> = {};

  logs.forEach(log => {
    byComponent[log.component] = (byComponent[log.component] || 0) + 1;
    byLevel[log.level] = (byLevel[log.level] || 0) + 1;
  });

  return {
    total: logs.length,
    byComponent,
    byLevel,
    recent: getLogs({ limit: 20 }),
  };
}

export function clearLogs(): void {
  logs.length = 0;
  logger.info('Logs cleared');
}
