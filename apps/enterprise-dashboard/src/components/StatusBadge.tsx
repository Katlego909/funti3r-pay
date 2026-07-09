import { CSSProperties, ReactNode } from 'react';
import { statusClass } from '../lib/status.js';

type Variant = 'completed' | 'failed' | 'pending';

interface StatusBadgeProps {
  /** Raw status string; color derived via statusClass, label defaults to it. */
  status?: string;
  /** Force a color regardless of `status` (for non-payment statuses). */
  variant?: Variant;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
}

export function StatusBadge({ status, variant, style, title, children }: StatusBadgeProps) {
  return (
    <span className={`status ${variant ?? statusClass(status)}`} style={style} title={title}>
      {children ?? status}
    </span>
  );
}

const KYC_BADGES: Record<string, [Variant, string]> = {
  verified: ['completed', 'Verified'],
  rejected: ['failed', 'Rejected'],
  pending: ['pending', 'Pending'],
};

export function KycBadge({ status }: { status?: string }) {
  const [variant, label] = KYC_BADGES[status ?? ''] ?? ['pending', 'None'];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}
