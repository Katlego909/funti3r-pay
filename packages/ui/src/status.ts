/** Maps a payment/KYC status string to the CSS status-pill class used across the dashboard. */
export function statusClass(s?: string): 'completed' | 'failed' | 'pending' {
  if (s === 'completed' || s === 'verified' || s === 'approved') return 'completed';
  if (s === 'failed' || s === 'rejected') return 'failed';
  return 'pending';
}

/** Payment-history status filter tabs, shared by the Payments and PaymentHistory pages. */
export const STATUS_TABS = ['all', 'completed', 'failed', 'pending_claim', 'initiated'] as const;
