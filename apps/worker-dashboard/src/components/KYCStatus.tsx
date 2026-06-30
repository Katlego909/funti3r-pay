import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client.js';

interface KYCStatusData {
  id?: string;
  status: 'pending' | 'verified' | 'rejected';
  verified_at?: string;
  rejection_reason?: string;
  submitted_at?: string | null;
  updated_at?: string;
}

export function KYCStatus() {
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
      setError('');
    } catch (err: any) {
      // 404 simply means no submission yet (when auto-approve is off).
      if (err?.response?.status === 404) {
        setStatus(null);
      } else {
        console.error('Failed to fetch KYC status:', err);
        setError(err?.response?.data?.error ?? 'Failed to load KYC status');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && !status) {
    return <div style={{ color: '#6b7280' }}>Loading KYC status...</div>;
  }

  if (!status) {
    return (
      <div style={{
        padding: '16px',
        backgroundColor: '#f3f4f6',
        borderRadius: '8px',
        border: '1px solid #d1d5db',
      }}>
        <p style={{ color: '#4b5563', margin: 0 }}>No KYC submission found</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified':
        return { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '✓' };
      case 'pending':
        return { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: '⏳' };
      case 'rejected':
        return { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', icon: '✗' };
      default:
        return { bg: '#f3f4f6', border: '#d1d5db', text: '#374151', icon: '?' };
    }
  };

  const colors = getStatusColor(status.status);
  const submittedDate = status.submitted_at
    ? new Date(status.submitted_at).toLocaleDateString()
    : 'Unknown';
  const verifiedDate = status.verified_at
    ? new Date(status.verified_at).toLocaleDateString()
    : null;

  return (
    <div style={{
      padding: '16px',
      backgroundColor: colors.bg,
      borderRadius: '8px',
      border: `1px solid ${colors.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '24px' }}>{colors.icon}</span>
        <div>
          <h4 style={{ margin: 0, color: colors.text, textTransform: 'capitalize' }}>
            KYC {status.status}
          </h4>
        </div>
      </div>

      <div style={{ fontSize: '14px', color: colors.text, lineHeight: '1.6' }}>
        {status.status === 'pending' && (
          <>
            <p style={{ margin: 0 }}>
              Submitted: {submittedDate}
            </p>
            <p style={{ margin: '8px 0 0' }}>
              Your KYC is under review. This typically takes 1-3 business days.
            </p>
          </>
        )}

        {status.status === 'verified' && (
          <>
            <p style={{ margin: 0 }}>
              Verified: {verifiedDate}
            </p>
            <p style={{ margin: '8px 0 0' }}>
              Your identity has been verified. You can now send and receive payments.
            </p>
          </>
        )}

        {status.status === 'rejected' && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>
              Submission Rejected
            </p>
            {status.rejection_reason && (
              <p style={{ margin: '8px 0 0' }}>
                Reason: {status.rejection_reason}
              </p>
            )}
            <p style={{ margin: '8px 0 0' }}>
              Please review the reason above and resubmit with correct information.
            </p>
          </>
        )}
      </div>

      {error && (
        <p style={{
          color: '#991b1b',
          margin: '12px 0 0',
          fontSize: '14px',
        }}>
          Error: {error}
        </p>
      )}
    </div>
  );
}
