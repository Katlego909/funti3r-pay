import { useState } from 'react';
import { HiOutlineCheckCircle } from 'react-icons/hi2';

export default function KYC() {
  const [status, setStatus] = useState<'none' | 'pending' | 'verified'>('none');
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    idType: 'passport',
    idNumber: '',
    dob: '',
    country: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Submit KYC data to /api/compliance/verify
    setStatus('pending');
    setFormOpen(false);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Know Your Customer (KYC)</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Complete verification to receive payments</p>

      {status === 'verified' && (
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
          </div>
        </div>
      )}

      {status === 'pending' && (
        <div style={{
          padding: '16px',
          backgroundColor: '#fef3c7',
          borderRadius: '8px',
          border: '1px solid #fcd34d',
          marginBottom: '20px'
        }}>
          <p style={{ fontWeight: 600, margin: 0, color: '#92400e' }}>Under Review</p>
          <p style={{ fontSize: '12px', color: '#b45309', margin: '4px 0 0 0' }}>Your verification is being reviewed. This typically takes 24-48 hours.</p>
        </div>
      )}

      {status === 'none' && (
        <>
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
              Start Verification
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
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            >
              <option>passport</option>
              <option>driver_license</option>
              <option>national_id</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>ID Number</label>
            <input
              type="text"
              value={formData.idNumber}
              onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
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
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Submit
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#e5e7eb',
                color: '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 600
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
