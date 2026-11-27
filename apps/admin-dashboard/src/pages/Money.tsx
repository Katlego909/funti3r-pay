import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { AccountLink, Card, Id, LoadState, Pill, Table, Tx } from '../components/bits';
import ReasonDialog, { type ReasonAction } from '../components/ReasonDialog';
import { money, when } from '../format';

type Tab = 'payments' | 'escrows' | 'cashouts';
const STATUSES: Record<Tab, string[]> = {
  payments: ['initiated', 'submitted', 'completed', 'pending_claim', 'failed'],
  escrows: ['active', 'completed', 'refunded'],
  cashouts: ['pending', 'completed', 'failed'],
};
const PAGE = 50;

/**
 * Money platform-wide: payments, escrows and cash-outs, filtered and paged. The only actions are compliance holds on
 * an escrow (freeze, unfreeze, return a frozen escrow to the employer) and bringing the database in line with the
 * contract. An admin never sends, retries or claims anyone's money.
 */
export default function Money() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'payments';
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';
  const frozenOnly = params.get('frozen') === 'true';
  const offset = Number(params.get('offset') ?? 0);
  const [draft, setDraft] = useState(q);
  const [action, setAction] = useState<ReasonAction | null>(null);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('offset' in patch)) next.delete('offset');
    setParams(next);
  };

  const list = useLoad(async () => {
    const p = { status: status || undefined, q: q || undefined, limit: PAGE, offset };
    if (tab === 'escrows') return (await admin.escrows({ ...p, frozen: frozenOnly ? 'true' : undefined })).escrows;
    if (tab === 'cashouts') return (await admin.cashouts(p)).cashouts;
    return (await admin.payments(p)).payments;
  }, [tab, status, q, frozenOnly, offset]);

  function search(e: FormEvent) {
    e.preventDefault();
    set({ q: draft.trim() || null });
  }

  const escrowActions = (x: Row) => {
    if (x.status !== 'active') return null;
    const freeze: ReasonAction = x.frozen
      ? {
        title: 'Lift the hold on this escrow?', message: 'The worker can claim approved milestones again. This sends a transaction to the contract.',
        confirmLabel: 'Unfreeze',
        run: async (reason) => { const r = await admin.freeze(x.id, false, reason); return `Unfrozen (tx ${r.txHash.slice(0, 8)}…)`; },
      }
      : {
        title: 'Freeze this escrow?', message: 'Nothing can be claimed, approved or refunded while it is frozen. This sends a transaction to the contract.',
        confirmLabel: 'Freeze', danger: true,
        run: async (reason) => { const r = await admin.freeze(x.id, true, reason); return `Frozen (tx ${r.txHash.slice(0, 8)}…)`; },
      };
    const returnIt: ReasonAction = {
      title: 'Return this frozen escrow to the employer?',
      message: 'Every milestone the worker has not claimed goes back to the employer, and the escrow ends. This cannot be undone.',
      confirmLabel: 'Return to employer', danger: true,
      run: async (reason) => { const r = await admin.returnFrozen(x.id, reason); return `Returned ${r.returned} ${r.tokenCode} to the employer`; },
    };
    return (
      <div className="admin-row-actions">
        <button className="btn-secondary" onClick={() => setAction(freeze)}>{x.frozen ? 'Unfreeze' : 'Freeze'}</button>
        {x.frozen && <button className="btn-secondary admin-danger" onClick={() => setAction(returnIt)}>Return</button>}
      </div>
    );
  };

  const columns = {
    payments: [
      { label: 'Created', render: (p: Row) => when(p.created_at) },
      { label: 'From', render: (p: Row) => <AccountLink id={p.enterprise_id} email={p.enterprise_email} /> },
      { label: 'To', render: (p: Row) => <AccountLink id={p.worker_id} email={p.worker_email} /> },
      { label: 'Amount', render: (p: Row) => money(p.amount, p.currency) },
      { label: 'Status', render: (p: Row) => <Pill value={p.status} /> },
      { label: 'Why it failed', render: (p: Row) => p.failure_reason ?? '—' },
      { label: 'Tx', render: (p: Row) => <Tx hash={p.stellar_tx_hash} /> },
      { label: 'Id', render: (p: Row) => <Id value={p.id} /> },
    ],
    escrows: [
      { label: 'Created', render: (x: Row) => when(x.created_at) },
      { label: 'Employer', render: (x: Row) => <AccountLink id={x.enterprise_id} email={x.enterprise_email} /> },
      { label: 'Worker', render: (x: Row) => <AccountLink id={x.worker_id} email={x.worker_email} /> },
      { label: 'Amount', render: (x: Row) => money(x.total_amount, x.token_code) },
      { label: 'Milestones', render: (x: Row) => `${x.claimed}/${x.milestones} claimed` },
      { label: 'Status', render: (x: Row) => <>{<Pill value={x.status} />} {x.frozen && <Pill value="frozen" />}</> },
      { label: 'Expires', render: (x: Row) => when(x.expires_at) },
      { label: '', render: escrowActions },
    ],
    cashouts: [
      { label: 'Created', render: (c: Row) => when(c.created_at) },
      { label: 'Worker', render: (c: Row) => <AccountLink id={c.worker_id} email={c.worker_email} /> },
      { label: 'USDC', render: (c: Row) => money(c.send_usdc) },
      { label: 'Receives', render: (c: Row) => money(c.receive_amount, c.receive_currency) },
      { label: 'Status', render: (c: Row) => <Pill value={c.status} /> },
      { label: 'MoneyGram', render: (c: Row) => <Pill value={c.mg_status} /> },
      { label: 'Error', render: (c: Row) => c.error ?? '—' },
      { label: 'Settlement', render: (c: Row) => <Tx hash={c.settlement_hash} /> },
    ],
  }[tab];

  return (
    <div className="dashboard">
      <PageHeader title="Money" subtitle="Payments, escrows and cash-outs across the platform" />

      <div className="payments-status-tabs">
        {(['payments', 'escrows', 'cashouts'] as Tab[]).map((t) => (
          <button key={t} className={`status-tab${tab === t ? ' active' : ''}`} onClick={() => setParams({ tab: t })}>
            {t === 'cashouts' ? 'Cash-outs' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="admin-filters">
        <select value={status} onChange={(e) => set({ status: e.target.value || null })} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES[tab].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        {tab === 'escrows' && (
          <label className="admin-check-label">
            <input type="checkbox" checked={frozenOnly} onChange={(e) => set({ frozen: e.target.checked ? 'true' : null })} /> Frozen only
          </label>
        )}
        <form onSubmit={search} className="admin-filter-search">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tab === 'payments' ? 'Payment id, account id or tx hash' : 'Id or account id'}
          />
          <button className="btn-secondary" type="submit">Filter</button>
          {q && <button className="btn-secondary" type="button" onClick={() => { setDraft(''); set({ q: null }); }}>Clear</button>}
        </form>
      </div>

      <Card>
        <LoadState loading={list.loading && !list.data} error={list.error} />
        {list.data && <Table<Row> rows={list.data} empty="Nothing matches." rowKey={(r) => r.id} columns={columns} />}
        <div className="admin-pager">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => set({ offset: String(Math.max(offset - PAGE, 0)) })}>Newer</button>
          <span className="admin-muted">{offset + 1}–{offset + (list.data?.length ?? 0)}</span>
          <button className="btn-secondary" disabled={(list.data?.length ?? 0) < PAGE} onClick={() => set({ offset: String(offset + PAGE) })}>Older</button>
        </div>
      </Card>

      {tab === 'escrows' && <Reconcile onRepaired={list.reload} />}

      <ReasonDialog action={action} onClose={() => setAction(null)} onDone={list.reload} />
    </div>
  );
}

/** Compares every active escrow with the contract: a dry run shows the drift, then the admin chooses to repair it. */
function Reconcile({ onRepaired }: { onRepaired: () => void }) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof admin.reconcile>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(repair: boolean) {
    setBusy(true);
    setError(null);
    try {
      setReport(await admin.reconcile(repair));
      if (repair) onRepaired();
    } catch {
      setError('The contract could not be read. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Escrows against the contract"
      actions={(
        <>
          <button className="btn-secondary" onClick={() => run(false)} disabled={busy}>{busy ? 'Checking…' : 'Check (dry run)'}</button>
          {report && !report.repair && report.drift.length > 0 && (
            <button className="btn-primary" onClick={() => run(true)} disabled={busy}>Repair {report.drift.length}</button>
          )}
        </>
      )}
    >
      <p className="admin-muted">The contract is the source of truth: a repair only ever brings the database in line with it, and is audited.</p>
      {error && <div className="error-banner">{error}</div>}
      {report && (
        <>
          <p>
            {report.repair ? 'Repaired' : 'Checked'} {report.checked} active escrows: {report.drift.length} differ from the contract
            {report.repair ? `, ${report.repaired} repaired` : ''}{report.unreadable ? `, ${report.unreadable} unreadable` : ''}.
          </p>
          <Table<Row> rows={report.drift} empty="Database and contract agree." rowKey={(d, i) => `${d.escrowId ?? i}`} columns={[
            { label: 'Escrow', render: (d) => <Id value={d.escrowId ?? d.id} /> },
            { label: 'Difference', render: (d) => <code className="admin-detail">{JSON.stringify(d)}</code> },
          ]} />
        </>
      )}
    </Card>
  );
}
