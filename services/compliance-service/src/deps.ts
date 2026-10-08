export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** What the app needs from the outside world; tests pass fakes. */
export interface Deps {
  query: Query;
  /** COMPLIANCE_AUTO_APPROVE: testnet marks every clean submission approved at once. */
  autoApprove: boolean;
}
