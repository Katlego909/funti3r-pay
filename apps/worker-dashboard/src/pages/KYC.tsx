import { useState, useEffect } from 'react';
import { HiOutlineCheckCircle } from 'react-icons/hi2';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../api/client.js';

interface KYCDetail {
  status: string;
  created_at: string;
  verified_at: string | null;
}

export default function KYC() {
  const user = useAuthStore((s) => s.user);
  const [kycData, setKycData] = useState<KYCDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    idType: 'passport',
    idNumber: '',
    dob: '',
    country: ''
  });

  useEffect(() => {
    if (!user?.userId) return;
    api.get<KYCDetail>(`/compliance/${user.userId}`)
      .then((res) => setKycData(res.data))
      .catch(() => setKycData(null))
      .finally(() => setLoading(false));
  }, [user?.userId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.userId) return;
    setError('');
    setSubmitting(true);
    try {
      await api.post('/compliance/verify', {
        userId: user.userId,
        idType: formData.idType,
        idNumber: formData.idNumber,
        dateOfBirth: formData.dob || undefined,
        country: formData.country,
      });
      setFormOpen(false);
      const res = await api.get<KYCDetail>(`/compliance/${user.userId}`);
      setKycData(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ padding: '20px', textAlign: 'center' }}>Loading KYC status…</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Know Your Customer (KYC)</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Complete verification to receive payments</p>

      {kycData?.status === 'verified' && (
        <div style={{
          padding: '16px',
          backgroundColor: '#d1fae5',
          borderRadius: '8px',
          border: '1px solid #6ee7b7',
          marginBottom: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center'
        }}>
          <HiOutlineCheckCircle size={24} style={{ color: '#059669' }} />
          <div>
            <p style={{ fontWeight: 600, margin: 0, color: '#065f46' }}>Verified</p>
            <p style={{ fontSize: '12px', color: '#047857', margin: '4px 0 0 0' }}>Your account is ready to receive payments</p>
            {kycData.verified_at && (
              <p style={{ fontSize: '11px', color: '#047857', margin: '4px 0 0 0' }}>
                Verified on {new Date(kycData.verified_at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
      )}

      {kycData?.status === 'pending' && (
        <div style={{
          padding: '16px',
          backgroundColor: '#fef3c7',
          borderRadius: '8px',
          border: '1px solid #fcd34d',
          marginBottom: '20px'
        }}>
          <p style={{ fontWeight: 600, margin: 0, color: '#92400e' }}>Under Review</p>
          <p style={{ fontSize: '12px', color: '#b45309', margin: '4px 0 0 0' }}>Your verification is being reviewed. This typically takes 24-48 hours.</p>
          {kycData.created_at && (
            <p style={{ fontSize: '11px', color: '#b45309', margin: '4px 0 0 0' }}>
              Submitted on {new Date(kycData.created_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {kycData?.status === 'rejected' && (
        <div style={{
          padding: '16px',
          backgroundColor: '#fee2e2',
          borderRadius: '8px',
          border: '1px solid #fecaca',
          marginBottom: '20px'
        }}>
          <p style={{ fontWeight: 600, margin: 0, color: '#991b1b' }}>Rejected</p>
          <p style={{ fontSize: '12px', color: '#7f1d1d', margin: '4px 0 0 0' }}>Your KYC submission was rejected. Please contact support.</p>
        </div>
      )}

      {(!kycData || kycData?.status === 'rejected') && (
        <>
          {!kycData && (
            <div style={{
              padding: '16px',
              backgroundColor: '#f3f4f6',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              marginBottom: '20px'
            }}>
              <p style={{ fontWeight: 600, margin: 0 }}>Not Yet Verified</p>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '4px 0 0 0' }}>You need to complete KYC to receive payments</p>
            </div>
          )}

          {!formOpen && (
            <button
              onClick={() => setFormOpen(true)}
              style={{
                padding: '10px 16px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 600
              }}
            >
              {kycData?.status === 'rejected' ? 'Resubmit' : 'Start Verification'}
            </button>
          )}
        </>
      )}

      {formOpen && (
        <form onSubmit={handleSubmit} style={{
          display: 'grid',
          gap: '16px',
          padding: '16px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>ID Type</label>
            <select
              value={formData.idType}
              onChange={(e) => setFormData({ ...formData, idType: e.target.value })}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            >
              <option value="passport">Passport</option>
              <option value="driver_license">Driver's License</option>
              <option value="national_id">National ID</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>ID Number</label>
            <input
              type="text"
              value={formData.idNumber}
              onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
              disabled={submitting}
              required
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>Date of Birth</label>
            <input
              type="date"
              value={formData.dob}
              onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>Country</label>
            <input
              type="text"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder="e.g. NG"
              disabled={submitting}
              required
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>

          {error && <p style={{ color: '#dc2626', margin: '0' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: submitting ? 0.5 : 1
              }}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#e5e7eb',
                color: '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: submitting ? 0.5 : 1
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
