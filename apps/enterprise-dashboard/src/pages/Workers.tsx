import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore.js';
import { getKYCStatusBulk, getInvites, deleteInvite, type Worker, type KYCStatus, type WorkerInvite } from '../api/workers.js';
import { api } from '../api/client.js';
import WorkerDetailDrawer from '../components/WorkerDetailDrawer.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import Modal from '../components/Modal.js';
import InviteLinkModal from '../components/InviteLinkModal.js';
import PageHeader from '../components/PageHeader.js';
import ExportButtons from '../components/ExportButtons.js';
import { StatusBadge, KycBadge } from '../components/StatusBadge.js';
import { exportWorkersCSV, exportWorkersPDF } from '../utils/export.js';

interface WorkerRow extends Worker {
  kyc?: KYCStatus;
}

interface SanctionsMatch {
  candidateName: string;
  matchedName: string;
  program: string;
  list: string;
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
  sanctions_status?: string;
  sanctions_matches?: SanctionsMatch[];
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
  const [invites, setInvites] = useState<WorkerInvite[]>([]);
  const [inviteToDelete, setInviteToDelete] = useState<WorkerInvite | null>(null);

  function loadInvites() {
    getInvites().then(setInvites).catch(() => {});
  }

  async function createInvite(email: string): Promise<string> {
    const res = await api.post<{ inviteUrl: string }>('/invites', { email });
    loadInvites();
    return res.data.inviteUrl;
  }

  async function confirmDeleteInvite() {
    if (!inviteToDelete) return;
    try {
      await deleteInvite(inviteToDelete.id);
      setInvites((prev) => prev.filter((i) => i.id !== inviteToDelete.id));
      toast.success('Invite deleted');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to delete invite');
    } finally {
      setInviteToDelete(null);
    }
  }

  useEffect(() => {
    api.get<{ users?: Worker[]; data?: Worker[] }>('/users?role=worker&limit=50')
      .then(async (res) => {
        const list: Worker[] = res.data.users ?? res.data.data ?? [];
        const statuses = await getKYCStatusBulk(list.map((w) => w.id)).catch(() => ({} as Record<string, KYCStatus>));
        setWorkers(list.map((w) => ({ ...w, kyc: statuses[w.id] })));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    loadInvites();
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
      setSelectedKYC({ ...selectedKYC, status: 'verified', sanctions_status: 'clear' });
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
      <PageHeader
        title="Workers"
        subtitle="Registered workers, wallets, and KYC status"
        actions={
          <>
            <ExportButtons onCSV={() => exportWorkersCSV(workers)} onPDF={() => exportWorkersPDF(workers)} />
            <button className="btn-cta" onClick={() => setInviteOpen(true)}>
              Invite Worker
            </button>
          </>
        }
      />

      <InviteLinkModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Worker"
        description="Enter the worker's email. They'll receive a registration link pre-linked to your account."
        emailLabel="Worker email"
        emailPlaceholder="worker@example.com"
        onSubmit={createInvite}
      />

      {invites.some((i) => i.status === 'pending') && (
        <section className="section" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Pending Invites</h3>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Sent</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites
                  .filter((i) => i.status === 'pending')
                  .map((i) => {
                    const expired = new Date(i.expires_at) < new Date();
                    return (
                      <tr key={i.id}>
                        <td data-label="Email">{i.email}</td>
                        <td data-label="Sent">{new Date(i.created_at).toLocaleDateString()}</td>
                        <td data-label="Expires">
                          {expired
                            ? <StatusBadge variant="failed">Expired</StatusBadge>
                            : new Date(i.expires_at).toLocaleDateString()}
                        </td>
                        <td data-label="Actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem', color: 'var(--danger)', borderColor: '#fecaca' }}
                            onClick={() => setInviteToDelete(i)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
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
                  <td data-label="Status"><StatusBadge variant={w.status === 'active' ? 'completed' : 'pending'}>{w.status}</StatusBadge></td>
                  <td data-label="KYC"><KycBadge status={w.kyc?.status} /></td>
                  <td data-label="Wallet">
                    {w.stellar_public_key
                      ? <a href={`https://stellar.expert/explorer/testnet/account/${w.stellar_public_key}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {w.stellar_public_key.slice(0, 8)}…
                        </a>
                      : <StatusBadge variant="pending">None</StatusBadge>}
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
                      <StatusBadge variant="pending">No submission</StatusBadge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedKYC && (
        <Modal open={kycModalOpen} onClose={() => setKycModalOpen(false)} title="KYC Details" maxWidth="500px">
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: '#666', margin: '0 0 0.25rem 0' }}>Status</p>
                <p style={{ margin: 0, fontWeight: 600 }}><KycBadge status={selectedKYC.status} /></p>
              </div>
              {selectedKYC.sanctions_status === 'flagged' && (
                <div style={{
                  marginBottom: '1rem', padding: '0.75rem', borderRadius: '6px',
                  backgroundColor: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b',
                }}>
                  <p style={{ margin: '0 0 0.35rem 0', fontWeight: 600 }}>⚠ Sanctions list match</p>
                  {(selectedKYC.sanctions_matches ?? []).map((m, i) => (
                    <p key={i} style={{ margin: 0, fontSize: '0.85rem' }}>
                      "{m.candidateName}" ≈ "{m.matchedName}" ({m.list} — {m.program})
                    </p>
                  ))}
                </div>
              )}
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
                {(selectedKYC.status === 'pending' || selectedKYC.sanctions_status === 'flagged') && (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={approveKYC}
                      disabled={approving || rejecting}
                      style={{ backgroundColor: '#10b981' }}
                      title={selectedKYC.sanctions_status === 'flagged' ? 'Manually clear as a false positive' : undefined}
                    >
                      {approving ? 'Approving…' : selectedKYC.sanctions_status === 'flagged' ? 'Clear match & approve' : 'Approve'}
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
        </Modal>
      )}

      <WorkerDetailDrawer workerId={selectedWorker} onClose={() => setSelectedWorker(null)} />

      <ConfirmDialog
        open={!!inviteToDelete}
        title="Delete invite"
        message={`Delete the invite for ${inviteToDelete?.email}? Their invite link will stop working.`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteInvite}
        onCancel={() => setInviteToDelete(null)}
      />
    </div>
  );
}
