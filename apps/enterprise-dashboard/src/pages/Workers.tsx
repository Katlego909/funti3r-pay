import { useEffect, useState, FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { HiOutlineArrowDownTray, HiOutlineEnvelope, HiOutlineClipboard, HiCheck, HiOutlineXMark } from 'react-icons/hi2';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore.js';
import { getWorkerWallet, getKYCStatus, type Worker, type WorkerWallet, type KYCStatus } from '../api/workers.js';
import { api } from '../api/client.js';
import WorkerDetailDrawer from '../components/WorkerDetailDrawer.js';
import { exportWorkersCSV, exportWorkersPDF } from '../utils/export.js';

interface WorkerRow extends Worker {
  wallet?: WorkerWallet;
  kyc?: KYCStatus;
}

interface KYCDetail {
  id: string;
  user_id: string;
  status: string;
  id_type: string;
  id_number: string;
  date_of_birth: string | null;
  country: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

function kycBadge(status?: string) {
  if (status === 'verified') return <span className="status completed">Verified</span>;
  if (status === 'rejected') return <span className="status failed">Rejected</span>;
  if (status === 'pending') return <span className="status pending">Pending</span>;
  return <span className="status pending">None</span>;
}

export default function Workers() {
  const user = useAuthStore((s) => s.user);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [selectedKYC, setSelectedKYC] = useState<KYCDetail | null>(null);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Invite state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteSending(true);
    setInviteLink('');
    try {
      const res = await api.post<{ inviteUrl: string }>('/invites', { email: inviteEmail });
      setInviteLink(res.data.inviteUrl);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create invite');
    } finally {
      setInviteSending(false);
    }
  }

  function copyLink() {
    navigator.clipboard?.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function closeInvite() {
    setInviteOpen(false);
    setInviteEmail('');
    setInviteLink('');
    setCopied(false);
  }

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

  async function viewKYC(workerId: string) {
    try {
      const data = await api.get<KYCDetail>(`/compliance/${workerId}`);
      setSelectedKYC(data.data);
      setKycModalOpen(true);
    } catch (err: any) {
      const status = err?.response?.status;
      toast.error(status === 404 ? 'No KYC documents on file for this worker.' : (err?.response?.data?.error ?? 'Failed to load KYC details'));
    }
  }

  async function approveKYC() {
    if (!selectedKYC) return;
    setApproving(true);
    try {
      await api.post(`/compliance/${selectedKYC.user_id}/approve`, {});
      setSelectedKYC({ ...selectedKYC, status: 'verified' });
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === selectedKYC.user_id
            ? { ...w, kyc: { ...w.kyc!, status: 'verified' } }
            : w,
        ),
      );
      toast.success('KYC approved');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve KYC');
    } finally {
      setApproving(false);
    }
  }

  async function rejectKYC() {
    if (!selectedKYC) return;
    setRejecting(true);
    try {
      await api.post(`/compliance/${selectedKYC.user_id}/reject`, { reason: 'Rejected by enterprise' });
      setSelectedKYC({ ...selectedKYC, status: 'rejected' });
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === selectedKYC.user_id
            ? { ...w, kyc: { ...w.kyc!, status: 'rejected' } }
            : w,
        ),
      );
      toast.success('KYC rejected');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject KYC');
    } finally {
      setRejecting(false);
    }
  }

  if (loading) return <div className="loading">Loading workers…</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="dashboard">
      <Helmet>
        <title>Workers | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="dashboard-header">
        <div>
          <h2>Workers</h2>
          <p className="subtitle">Registered workers, wallets, and KYC status</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="export-btn-group">
            <button className="btn-export" onClick={() => exportWorkersCSV(workers)}>
              <HiOutlineArrowDownTray size={14} /> CSV
            </button>
            <button className="btn-export" onClick={() => exportWorkersPDF(workers)}>
              <HiOutlineArrowDownTray size={14} /> PDF
            </button>
          </div>
          <button className="btn-cta" onClick={() => setInviteOpen(true)}>
            Invite Worker
          </button>
        </div>
      </div>

      {inviteOpen && (
        <div className="modal-overlay" onClick={closeInvite}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Invite Worker</h3>
              <button onClick={closeInvite} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                <HiOutlineXMark size={20} />
              </button>
            </div>
            {!inviteLink ? (
              <form onSubmit={handleInvite} className="payment-form">
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
                  Enter the worker's email. They'll receive a registration link pre-linked to your account.
                </p>
                <label>Worker email
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="worker@example.com"
                    required
                  />
                </label>
                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={closeInvite}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={inviteSending}>
                    {inviteSending ? 'Generating…' : 'Generate invite link'}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#065f46', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px', margin: 0 }}>
                  Invite link generated for <strong>{inviteEmail}</strong>. Send it to them — it expires in 7 days.
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={inviteLink}
                    style={{ flex: 1, fontSize: '0.78rem', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb', fontFamily: 'monospace' }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button className="btn-secondary" onClick={copyLink} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {copied ? <><HiCheck size={14} /> Copied</> : <><HiOutlineClipboard size={14} /> Copy</>}
                  </button>
                </div>
                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => { setInviteLink(''); setInviteEmail(''); }}>Invite another</button>
                  <button className="btn-primary" onClick={closeInvite}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="section">
        <div className="table-responsive">
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
                <tr key={w.id} onClick={() => setSelectedWorker(w.id)} style={{ cursor: 'pointer' }}>
                  <td data-label="Email">{w.email}</td>
                  <td data-label="Status"><span className={`status ${w.status === 'active' ? 'completed' : 'pending'}`}>{w.status}</span></td>
                  <td data-label="KYC">{kycBadge(w.kyc?.status)}</td>
                  <td data-label="Wallet">
                    {w.wallet?.address
                      ? <a href={`https://stellar.expert/explorer/testnet/account/${w.wallet.address}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {w.wallet.address.slice(0, 8)}…
                        </a>
                      : <span className="status pending">{w.wallet?.status ?? 'None'}</span>}
                  </td>
                  <td data-label="Joined">{new Date(w.created_at).toLocaleDateString()}</td>
                  <td data-label="Actions">
                    {w.kyc?.submitted_at ? (
                      <button
                        className="btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem' }}
                        onClick={(e) => { e.stopPropagation(); viewKYC(w.id); }}
                      >
                        View KYC
                      </button>
                    ) : (
                      <span className="status pending">No submission</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {kycModalOpen && selectedKYC && (
        <div className="modal-overlay" onClick={() => setKycModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <h3>KYC Details</h3>
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>Status</p>
                <p style={{ margin: 0, fontWeight: 600 }}>{kycBadge(selectedKYC.status)}</p>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>ID Type</p>
                <p style={{ margin: 0 }}>{selectedKYC.id_type}</p>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>ID Number</p>
                <p style={{ margin: 0, fontFamily: 'monospace' }}>{selectedKYC.id_number}</p>
              </div>
              {selectedKYC.date_of_birth && (
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>Date of Birth</p>
                  <p style={{ margin: 0 }}>{new Date(selectedKYC.date_of_birth).toLocaleDateString()}</p>
                </div>
              )}
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>Country</p>
                <p style={{ margin: 0 }}>{selectedKYC.country}</p>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>Submitted</p>
                <p style={{ margin: 0 }}>{new Date(selectedKYC.created_at).toLocaleString()}</p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setKycModalOpen(false)}
                  disabled={approving || rejecting}
                >
                  Close
                </button>
                {selectedKYC.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={approveKYC}
                      disabled={approving || rejecting}
                      style={{ backgroundColor: '#10b981' }}
                    >
                      {approving ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={rejectKYC}
                      disabled={approving || rejecting}
                      style={{ backgroundColor: '#ef4444' }}
                    >
                      {rejecting ? 'Rejecting…' : 'Reject'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <WorkerDetailDrawer workerId={selectedWorker} onClose={() => setSelectedWorker(null)} />
    </div>
  );
}
