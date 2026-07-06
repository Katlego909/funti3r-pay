import { vi } from 'vitest';

/** Minimal shape of pg's QueryResult that the app code actually reads. */
export interface MockQueryResult {
  rows: any[];
}

export interface QueryHandler {
  match: RegExp;
  handler: (params: unknown[]) => MockQueryResult;
}

/**
 * Routes the mocked `query()` by matching against the SQL text, so tests read
 * as "when the code runs this kind of query, return this" rather than a
 * brittle positional sequence tied to executePayout's internal call order.
 * Unmatched queries return `{ rows: [] }` (safe default for UPDATE/INSERT
 * calls whose return value isn't inspected).
 */
export function createQueryMock(handlers: QueryHandler[]) {
  // Cast to `any`: app code only ever reads `.rows` off the real pg QueryResult,
  // so faking its other fields (command/rowCount/oid/fields) everywhere would
  // be pure noise with no test value.
  return vi.fn(async (sql: string, params?: unknown[]): Promise<any> => {
    for (const h of handlers) {
      if (h.match.test(sql)) return h.handler(params ?? []);
    }
    return { rows: [] };
  });
}

export const WORKER_ID = 'worker-1111-1111-1111-111111111111';
export const ENTERPRISE_ID = 'enterprise-2222-2222-2222-222222222222';

/** A worker row with a classic Stellar account (not a SmartWallet/passkey user). */
export const WORKER_ROW = {
  stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  stellar_secret_key: 'SWORKERSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  email: 'worker@test.com',
};

export const HANDLER_NO_EXISTING_IDEMPOTENCY_ROW: QueryHandler = {
  match: /idempotency_key = \$2/,
  handler: () => ({ rows: [] }),
};

export const HANDLER_WORKER_FOUND: QueryHandler = {
  match: /SELECT stellar_public_key, stellar_secret_key, email FROM users/,
  handler: () => ({ rows: [WORKER_ROW] }),
};

export const HANDLER_INSERT_PAYMENT: QueryHandler = {
  match: /INSERT INTO payments/,
  handler: () => ({ rows: [{ id: 'payment-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] }),
};
