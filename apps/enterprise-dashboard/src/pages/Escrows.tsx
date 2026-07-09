import { useEffect, useState, FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { HiOutlineLockClosed, HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { listEscrows, createEscrow, approveMilestone, refundEscrow, type Escrow } from '../api/escrows.js';
import { getXlmPrice } from '../api/payments.js';
import PageHeader from '../components/PageHeader.js';
import Modal from '../components/Modal.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import SlideOver, { Row, SectionTitle } from '../components/SlideOver.js';
import { StatusBadge } from '../components/StatusBadge.js';

interface WorkerOption { id: string; email: string }
interface MilestoneRow { description: string; amountXlm: string }

const ESCROW_BADGE: Record<Escrow['status'], ['completed' | 'failed' | 'pending', string]> = {
  active: ['completed', 'Active'],
  completed: ['completed', 'Completed'],
  refunded: ['pending', 'Refunded'],
};

const MILESTONE_BADGE: Record<string, ['completed' | 'failed' | 'pending', string]> = {
  pending: ['pending', 'Pending'],
  approved: ['pending', 'Approved — awaiting claim'],
  claimed: ['completed', 'Claimed'],
  refunded: ['failed', 'Refunded'],
};

const txLink = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

function EscrowDetailDrawer({
  escrow, acting, onApprove, onRefund, onClose,
}: {
  escrow: Escrow | null;
  acting: boolean;
  onApprove: (escrow: Escrow, idx: number) => void;
  onRefund: (escrow: Escrow) => void;
  onClose: () => void;
}) {
  // Keep the last non-null escrow so content stays put during SlideOver's
  // slide-out animation (same pattern as ScheduleDetailModal).
  const [current, setCurrent] = useState<Escrow | null>(null);
  useEffect(() => {
    if (escrow) setCurrent(escrow);
  }, [escrow]);
  if (!current) return null;

  const expired = new Date(current.expiresAt) < new Date();
  const hasPending = current.milestones.some((m) => m.status === 'pending');

  return (
    <SlideOver openKey={escrow} title="Escrow Details" onClose={onClose}>
      <div style={{ marginTop: '1rem' }}>
        {/* Headline (same shape as the payment detail drawer) */}
        <div style={{
          background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px',
          padding: '16px', marginBottom: '8px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>
            {current.totalXlm} <span style={{ fontSize: '0.55em' }}>XLM</span>
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '2px' }}>{current.workerEmail}</div>
          <StatusBadge variant={ESCROW_BADGE[current.status][0]} style={{ marginTop: '10px', display: 'inline-block' }}>
            {ESCROW_BADGE[current.status][1]}
          </StatusBadge>
        </div>

        <SectionTitle>Escrow</SectionTitle>
        <Row label="Expires">{new Date(current.expiresAt).toLocaleDateString()}</Row>
        <Row label="On-chain ID">#{current.onchainEscrowId}</Row>
        {current.createTxHash && (
          <Row label="Funding tx">
            <a href={txLink(current.createTxHash)} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              View on Explorer <HiOutlineArrowTopRightOnSquare size={13} />
            </a>
          </Row>
        )}

        <SectionTitle>Milestones</SectionTitle>
        {current.milestones.map((m) => (
          <div key={m.idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{m.description || `Milestone ${m.idx + 1}`}</div>
              <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{m.amountXlm} XLM</div>
            </div>
            {m.status === 'pending' && current.status === 'active' ? (
              <button
                className="btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem', flexShrink: 0 }}
                disabled={acting}
                onClick={() => onApprove(current, m.idx)}
              >
                Approve
              </button>
            ) : m.claimTxHash ? (
              <a href={txLink(m.claimTxHash)} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                <StatusBadge variant={MILESTONE_BADGE[m.status][0]}>{MILESTONE_BADGE[m.status][1]}</StatusBadge>
              </a>
            ) : (
              <StatusBadge variant={MILESTONE_BADGE[m.status][0]} style={{ flexShrink: 0 }}>
                {MILESTONE_BADGE[m.status][1]}
              </StatusBadge>
            )}
          </div>
        ))}

        {current.status === 'active' && hasPending && (
          <button
            className="btn-secondary"
            style={{ marginTop: '16px', width: '100%', color: 'var(--danger)', borderColor: '#fecaca' }}
            disabled={!expired || acting}
            title={expired ? 'Reclaim all unapproved funds' : 'Available after the expiry date'}
            onClick={() => onRefund(current)}
          >
            {expired ? 'Refund unapproved funds' : 'Refund unlocks after expiry'}
          </button>
        )}
      </div>
    </SlideOver>
  );
}

export default function Escrows() {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [xlmUsd, setXlmUsd] = useState(0);

  // Create form
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [workerId, setWorkerId] = useState('');
  const [rows, setRows] = useState<MilestoneRow[]>([{ description: '', amountXlm: '' }]);
  const [expiresAt, setExpiresAt] = useState('');

  // Detail + confirms
  const [selected, setSelected] = useState<Escrow | null>(null);
  const [pendingApprove, setPendingApprove] = useState<{ escrow: Escrow; idx: number } | null>(null);
  const [pendingRefund, setPendingRefund] = useState<Escrow | null>(null);
  const [acting, setActing] = useState(false);

  function load() {
    listEscrows()
      .then((list) => {
        setEscrows(list);
        // Keep the open detail modal in sync after an action.
        setSelected((sel) => (sel ? list.find((e) => e.id === sel.id) ?? null : null));
      })
      .catch(() => toast.error('Failed to load escrows'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get<{ users?: WorkerOption[]; data?: WorkerOption[] }>('/users?role=worker&limit=50')
      .then((res) => setWorkers(res.data.users ?? res.data.data ?? []))
      .catch(() => {});
    getXlmPrice().then(setXlmUsd).catch(() => {});
  }, []);

  const totalXlm = rows.reduce((s, r) => s + (Number(r.amountXlm) || 0), 0);

  function updateRow(i: number, patch: Partial<MilestoneRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function closeForm() {
    setFormOpen(false);
    setWorkerId('');
    setRows([{ description: '', amountXlm: '' }]);
    setExpiresAt('');
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { txHash } = await createEscrow({
        workerId,
        milestones: rows.map((r) => ({ description: r.description || undefined, amountXlm: Number(r.amountXlm) })),
        expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString(),
      });
      toast.success(`Escrow funded on-chain (${txHash.slice(0, 8)}…)`);
      closeForm();
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create escrow');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmApprove() {
    if (!pendingApprove) return;
    setActing(true);
    try {
      await approveMilestone(pendingApprove.escrow.id, pendingApprove.idx);
      toast.success('Milestone approved — the worker can now claim it');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to approve milestone');
    } finally {
      setActing(false);
      setPendingApprove(null);
    }
  }

  async function confirmRefund() {
    if (!pendingRefund) return;
    setActing(true);
    try {
      const { refundedXlm } = await refundEscrow(pendingRefund.id);
      toast.success(`${refundedXlm} XLM refunded to your wallet`);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to refund escrow');
    } finally {
      setActing(false);
      setPendingRefund(null);
    }
  }

  const claimedCount = (e: Escrow) => e.milestones.filter((m) => m.status === 'claimed').length;
  const isExpired = (e: Escrow) => new Date(e.expiresAt) < new Date();

  if (loading) return <div className="loading">Loading escrows…</div>;

  return (
    <div className="dashboard">
      <Helmet>
        <title>Escrows | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <PageHeader
        title="Escrows"
        subtitle="Lock funds on-chain, release them per approved milestone"
        actions={
          <button className="btn-cta" onClick={() => setFormOpen(true)}>
            New Escrow
          </button>
        }
      />

      {escrows.length === 0 ? (
        <section className="section" style={{ textAlign: 'center', padding: '3rem' }}>
          <HiOutlineLockClosed size={40} style={{ color: '#d1d5db', margin: '0 auto 12px' }} />
          <p style={{ color: '#6b7280', marginBottom: '1rem' }}>No escrows yet. Fund milestones for a worker to get started.</p>
          <button className="btn-primary" onClick={() => setFormOpen(true)}>Create your first escrow</button>
        </section>
      ) : (
        <section className="section">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Total</th>
                  <th>Milestones</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {escrows.map((e) => (
                  <tr key={e.id} onClick={() => setSelected(e)} style={{ cursor: 'pointer' }}>
                    <td data-label="Worker">{e.workerEmail}</td>
                    <td data-label="Total">{e.totalXlm} XLM</td>
                    <td data-label="Milestones">{claimedCount(e)}/{e.milestones.length} claimed</td>
                    <td data-label="Status">
                      <StatusBadge variant={ESCROW_BADGE[e.status][0]}>{ESCROW_BADGE[e.status][1]}</StatusBadge>
                    </td>
                    <td data-label="Expires">
                      {isExpired(e) && e.status === 'active'
                        ? <StatusBadge variant="failed">Expired</StatusBadge>
                        : new Date(e.expiresAt).toLocaleDateString()}
                    </td>
                    <td>
                      {e.createTxHash && (
                        <a href={txLink(e.createTxHash)} target="_blank" rel="noopener noreferrer" title="Funding transaction" onClick={(ev) => ev.stopPropagation()}>
                          <HiOutlineArrowTopRightOnSquare size={14} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Create modal */}
      <Modal open={formOpen} onClose={closeForm} title="New Escrow" closeButton maxWidth="540px">
        <form onSubmit={handleCreate} className="payment-form">
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 0 }}>
            The total is locked in the escrow smart contract immediately. You approve milestones as
            work completes; the worker claims each approved amount. Unapproved funds return to you
            after the expiry date.
          </p>
          <label>Worker
            <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} required>
              <option value="">Select a worker…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>{w.email}</option>
              ))}
            </select>
          </label>

          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', marginTop: '4px' }}>
            Milestones (amounts in XLM)
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                style={{ flex: 2, minWidth: 0 }}
                placeholder={`Milestone ${i + 1} — e.g. Design complete`}
                value={row.description}
                onChange={(e) => updateRow(i, { description: e.target.value })}
              />
              <input
                type="number" min="0.0000001" step="any" placeholder="XLM" required
                style={{ width: '110px' }}
                value={row.amountXlm}
                onChange={(e) => updateRow(i, { amountXlm: e.target.value })}
              />
              <button
                type="button"
                disabled={rows.length <= 1}
                onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                style={{ width: '32px', height: '32px', flexShrink: 0, border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#ef4444', cursor: rows.length > 1 ? 'pointer' : 'not-allowed', opacity: rows.length > 1 ? 1 : 0.4 }}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start' }}
            onClick={() => setRows((r) => [...r, { description: '', amountXlm: '' }])}>
            + Add milestone
          </button>

          <label>Expiry date
            <input
              type="date" required
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </label>

          {totalXlm > 0 && (
            <p style={{ margin: '-4px 0 4px', fontSize: '0.85rem', color: '#065f46', fontWeight: 600 }}>
              Total locked: {totalXlm} XLM
              {xlmUsd > 0 && <span style={{ color: '#6b7280', fontWeight: 400 }}> ≈ ${(totalXlm * xlmUsd).toFixed(2)} USD</span>}
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={closeForm}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting || !workerId}>
              {submitting ? 'Funding on-chain…' : `Fund ${totalXlm > 0 ? `${totalXlm} XLM` : 'escrow'}`}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail drawer */}
      <EscrowDetailDrawer
        escrow={selected}
        acting={acting}
        onApprove={(escrow, idx) => setPendingApprove({ escrow, idx })}
        onRefund={(escrow) => setPendingRefund(escrow)}
        onClose={() => setSelected(null)}
      />

      <ConfirmDialog
        open={!!pendingApprove}
        title="Approve milestone"
        message={`Approve milestone ${pendingApprove ? pendingApprove.idx + 1 : ''} (${pendingApprove ? pendingApprove.escrow.milestones[pendingApprove.idx]?.amountXlm : ''} XLM)? This is recorded on-chain and cannot be undone — the worker gains the right to claim these funds.`}
        confirmLabel={acting ? 'Approving…' : 'Approve'}
        onConfirm={confirmApprove}
        onCancel={() => setPendingApprove(null)}
      />

      <ConfirmDialog
        open={!!pendingRefund}
        title="Refund unapproved funds"
        message="All still-pending milestone funds return to your wallet. Milestones you already approved stay claimable by the worker. This cannot be undone."
        confirmLabel={acting ? 'Refunding…' : 'Refund'}
        danger
        onConfirm={confirmRefund}
        onCancel={() => setPendingRefund(null)}
      />
    </div>
  );
}
