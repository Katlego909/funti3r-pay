import { useEffect, useState, FormEvent } from 'react';
import { getWorkerWallet, getKYCStatus, submitKYC, type Worker, type WorkerWallet, type KYCStatus } from '../api/workers.js';
import { api } from '../api/client.js';

interface WorkerRow extends Worker {
  wallet?: WorkerWallet;
  kyc?: KYCStatus;
}

function kycBadge(status?: string) {
  if (status === 'verified') return <span className="status completed">Verified</span>;
  if (status === 'rejected') return <span className="status failed">Rejected</span>;
  if (status === 'pending') return <span className="status pending">Pending</span>;
  return <span className="status pending">None</span>;
}

export default function Workers() {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WorkerRow | null>(null);
  const [kycForm, setKycForm] = useState(false);
  const [kycLoading, setKycLoading] = useState(false);
  const [kycError, setKycError] = useState('');

  // KYC form fields
  const [idType, setIdType] = useState('passport');
  const [idNumber, setIdNumber] = useState('');
  const [dob, setDob] = useState('');
  const [country, setCountry] = useState('');

  useEffect(() => {
    api.get<{ users?: Worker[]; data?: Worker[] }>('/users?role=worker&limit=50')
      .then(async (res) => {
        const list: Worker[] = res.data.users ?? res.data.data ?? [];
        const enriched = await Promise.all(
          list.map(async (w) => {
            const [wallet, kyc] = await Promise.allSettled([
              getWorkerWallet(w.id),
              getKYCStatus(w.id),
            ]);
            return {
              ...w,
              wallet: wallet.status === 'fulfilled' ? wallet.value : undefined,
              kyc: kyc.status === 'fulfilled' ? kyc.value : undefined,
            };
          }),
        );
        setWorkers(enriched);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleKYCSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setKycError('');
    setKycLoading(true);
    try {
      await submitKYC({ userId: selected.id, idType, idNumber, dateOfBirth: dob || undefined, country });
      setKycForm(false);
      // Refresh KYC status for this worker
      const kyc = await getKYCStatus(selected.id);
      setWorkers((prev) => prev.map((w) => w.id === selected.id ? { ...w, kyc } : w));
    } catch (err: unknown) {
      setKycError(err instanceof Error ? err.message : 'KYC submission failed');
    } finally {
      setKycLoading(false);
    }
  }

  if (loading) return <div className="loading">Loading workers…</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Workers</h2>
          <p className="subtitle">Registered workers, wallets, and KYC status</p>
        </div>
      </div>

      <section className="section">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>KYC</th>
              <th>Wallet</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No workers registered yet.</td></tr>
            ) : workers.map((w) => (
              <tr key={w.id}>
                <td>{w.email}</td>
                <td><span className={`status ${w.status === 'active' ? 'completed' : 'pending'}`}>{w.status}</span></td>
                <td>{kycBadge(w.kyc?.status)}</td>
                <td>
                  {w.wallet?.address
                    ? <a href={`https://stellar.expert/explorer/testnet/account/${w.wallet.address}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {w.wallet.address.slice(0, 8)}…
                      </a>
                    : <span className="status pending">{w.wallet?.status ?? 'None'}</span>}
                </td>
                <td>{new Date(w.created_at).toLocaleDateString()}</td>
                <td>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem' }}
                    onClick={() => { setSelected(w); setKycForm(true); setKycError(''); setIdNumber(''); setDob(''); setCountry(w.country ?? ''); }}
                  >
                    Submit KYC
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {kycForm && selected && (
        <div className="modal-overlay" onClick={() => setKycForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Submit KYC — {selected.email}</h3>
            <form onSubmit={handleKYCSubmit} className="payment-form">
              <label>ID Type
                <select value={idType} onChange={(e) => setIdType(e.target.value)}>
                  <option value="passport">Passport</option>
                  <option value="national_id">National ID</option>
                  <option value="drivers_license">Driver's Licence</option>
                </select>
              </label>
              <label>ID Number
                <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required />
              </label>
              <label>Date of Birth
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </label>
              <label>Country (ISO-2)
                <input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} required placeholder="NG" />
              </label>
              {kycError && <p className="auth-error">{kycError}</p>}
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setKycForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={kycLoading}>{kycLoading ? 'Submitting…' : 'Submit'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
