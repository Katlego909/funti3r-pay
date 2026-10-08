/** What an identity-verification provider decides about one submission. */
export interface KycDecision {
  status: 'approved' | 'rejected' | 'pending';
  /** The provider's own id for the check, kept in kyc_records.provider_request_id. */
  providerRef?: string;
}

/**
 * Where "is this person who they say they are" gets decided. Today that is `manual` (a reviewer, or
 * auto-approve on testnet). A real provider (document + selfie checks) implements this interface and
 * is passed to createApp; nothing else in the service, the schema or the contract changes.
 * Sanctions screening is not the provider's job: it runs first and a match always forces rejection.
 */
export interface KycProvider {
  name: string;
  submit(input: { userId: string; details: Record<string, unknown>; sanctionsFlagged: boolean }): Promise<KycDecision>;
}
