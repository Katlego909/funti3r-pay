import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client.js';
import { StatusBadge } from './StatusBadge.js';

interface KYCStatusData {
  id?: string;
  status: 'pending' | 'verified' | 'rejected';
  verified_at?: string;
  rejection_reason?: string;
  submitted_at?: string | null;
  updated_at?: string;
}

const BADGES: Record<string, ['completed' | 'failed' | 'pending', string]> = {
  verified: ['completed', 'KYC verified'],
  rejected: ['failed', 'KYC rejected'],
  pending: ['pending', 'KYC pending review'],
};

export function KYCStatus({ onStatusChange }: { onStatusChange?: (status: KYCStatusData['status'] | null) => void }) {
  const { user } = useAuthStore();
  const [status, setStatus] = useState<KYCStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.userId) {
      setLoading(false);
      return;
    }

    fetchKYCStatus();
    const interval = setInterval(fetchKYCStatus, 5000);
    return () => clearInterval(interval);
  }, [user?.userId]);

  const fetchKYCStatus = async () => {
    try {
      if (!user?.userId) return;

      const { data } = await api.get<KYCStatusData>(`/compliance/${user.userId}/status`);
      setStatus(data);
      onStatusChange?.(data.status);
      setError('');
    } catch (err: any) {
      // 404 simply means no submission yet (when auto-approve is off).
      if (err?.response?.status === 404) {
        setStatus(null);
        onStatusChange?.(null);
      } else {
        console.error('Failed to fetch KYC status:', err);
        setError(err?.response?.data?.error ?? 'Failed to load KYC status');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && !status) {
    return <div style={{ color: 'var(--gray-600)', fontSize: '0.88rem' }}>Loading KYC status...</div>;
  }

  if (!status) {
    return <p style={{ color: 'var(--gray-600)', fontSize: '0.88rem', margin: 0 }}>No KYC submission found.</p>;
  }

  const [variant, label] = BADGES[status.status] ?? BADGES.pending;
  const submittedDate = status.submitted_at ? new Date(status.submitted_at).toLocaleDateString() : 'Unknown';
  const verifiedDate = status.verified_at ? new Date(status.verified_at).toLocaleDateString() : null;
  const line = { margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--gray-600)' } as const;

  return (
    <div>
      <StatusBadge variant={variant}>{label}</StatusBadge>

      {status.status === 'pending' && (
        <>
          <p style={line}>Submitted {submittedDate}.</p>
          <p style={line}>Your KYC is under review. This typically takes 1-3 business days.</p>
        </>
      )}

      {status.status === 'verified' && (
        <>
          {verifiedDate && <p style={line}>Verified {verifiedDate}.</p>}
          <p style={line}>Your identity has been verified. You can now send and receive payments.</p>
        </>
      )}

      {status.status === 'rejected' && (
        <>
          {status.rejection_reason && <div className="error-banner" style={{ margin: '12px 0 0' }}>{status.rejection_reason}</div>}
          <p style={line}>Please review the reason above and resubmit with correct information.</p>
        </>
      )}

      {error && <div className="error-banner" style={{ margin: '12px 0 0' }}>{error}</div>}
    </div>
  );
}
