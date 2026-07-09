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
 * Always includes HANDLER_ENTERPRISE_MEMBERSHIP last, so every route test
 * gets a working company-context resolution (ENTERPRISE_ID/ADMIN_ID/MEMBER_ID)
 * without having to repeat it in every test's handler list. Unmatched queries
 * return `{ rows: [] }` (safe default for UPDATE/INSERT calls whose return
 * value isn't inspected).
 */
export function createQueryMock(handlers: QueryHandler[]) {
  const allHandlers = [...handlers, HANDLER_ENTERPRISE_MEMBERSHIP];
  // Cast to `any`: app code only ever reads `.rows` off the real pg QueryResult,
  // so faking its other fields (command/rowCount/oid/fields) everywhere would
  // be pure noise with no test value.
  return vi.fn(async (sql: string, params?: unknown[]): Promise<any> => {
    for (const h of allHandlers) {
      if (h.match.test(sql)) return h.handler(params ?? []);
    }
    return { rows: [] };
  });
}

export const WORKER_ID = 'worker-1111-1111-1111-111111111111';
export const ENTERPRISE_ID = 'enterprise-2222-2222-2222-222222222222';
export const ADMIN_ID = 'admin-3333-3333-3333-333333333333';
export const MEMBER_ID = 'member-4444-4444-4444-444444444444';
export const COMPANY_ID = 'company-5555-5555-5555-555555555555';

/**
 * Mocks the payment-service company.ts resolver's query (`FROM
 * enterprise_members em JOIN enterprises e`). ENTERPRISE_ID resolves as the
 * company owner (matching every existing test's pre-Phase-2 assumption that
 * the requester IS the enterprise identity); ADMIN_ID/MEMBER_ID resolve as
 * teammates of that same company, for testing the owner/admin-only
 * money-movement gate.
 */
export const HANDLER_ENTERPRISE_MEMBERSHIP: QueryHandler = {
  match: /FROM enterprise_members em JOIN enterprises e/,
  handler: (params) => {
    const userId = params[0];
    if (userId === ENTERPRISE_ID) return { rows: [{ company_id: COMPANY_ID, company_role: 'owner', owner_user_id: ENTERPRISE_ID }] };
    if (userId === ADMIN_ID) return { rows: [{ company_id: COMPANY_ID, company_role: 'admin', owner_user_id: ENTERPRISE_ID }] };
    if (userId === MEMBER_ID) return { rows: [{ company_id: COMPANY_ID, company_role: 'member', owner_user_id: ENTERPRISE_ID }] };
    return { rows: [] };
  },
};

/** A worker row with a classic Stellar account (not a SmartWallet/passkey user). */
export const WORKER_ROW = {
  stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  stellar_secret_key: 'SWORKERSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  email: 'worker@test.com',
  payout_method: 'stellar',
  payout_details: null,
};

export const HANDLER_NO_EXISTING_IDEMPOTENCY_ROW: QueryHandler = {
  match: /idempotency_key = \$2/,
  handler: () => ({ rows: [] }),
};

export const HANDLER_WORKER_FOUND: QueryHandler = {
  match: /SELECT stellar_public_key, stellar_secret_key, email/,
  handler: () => ({ rows: [WORKER_ROW] }),
};

/**
 * POST /payouts/batch's bulk worker prefetch (SELECT id, ... WHERE id = ANY($1))
 * — needs `id` in each row to build its Map, unlike the single-payout
 * WORKER_ROW above. Defaults every synthesized worker to preferred_currency
 * 'USDC' (rate 1:1, no live FX call needed) — tests that need a specific
 * per-worker currency mix should supply their own handler for this query.
 */
export const HANDLER_WORKER_FOUND_BULK: QueryHandler = {
  match: /SELECT id, stellar_public_key, stellar_secret_key, email, preferred_currency/,
  handler: (params) => ({
    rows: ((params[0] as string[]) ?? []).map((id) => ({ id, ...WORKER_ROW, preferred_currency: 'USDC' })),
  }),
};

export const HANDLER_INSERT_PAYMENT: QueryHandler = {
  match: /INSERT INTO payments/,
  handler: () => ({ rows: [{ id: 'payment-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] }),
};
