import type { SanctionsService } from './sanctions/service.js';

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** What the app needs from the outside world; tests pass fakes. */
export interface Deps {
  query: Query;
  /** COMPLIANCE_AUTO_APPROVE: testnet marks every clean submission approved at once. */
  autoApprove: boolean;
  sanctions: SanctionsService;
  /** How long an approval stays valid before the person must be re-verified. */
  validityDays?: number;
}
