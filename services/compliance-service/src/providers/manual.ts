import type { KycProvider } from './types.js';

/**
 * Self-declared details, decided by a reviewer; or approved at once when auto-approve is on (testnet).
 * A sanctions match is rejected either way.
 */
export function createManualProvider({ autoApprove }: { autoApprove: boolean }): KycProvider {
  return {
    name: 'manual',
    async submit({ sanctionsFlagged }) {
      if (sanctionsFlagged) return { status: 'rejected' };
      return { status: autoApprove ? 'approved' : 'pending' };
    },
  };
}
