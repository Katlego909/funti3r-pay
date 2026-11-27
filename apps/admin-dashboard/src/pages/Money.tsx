import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useListParams } from '../listParams';
import { AccountLink, Card, FilterInput, Id, LoadState, Pager, Pill, Table, Tabs, Tx } from '../components/bits';
import { useDrawers, type DrawerKind } from '../components/drawers';
import { money, when } from '../format';

type Tab = 'payments' | 'escrows' | 'cashouts' | 'batches' | 'schedules';
const TABS: { key: Tab; label: string }[] = [
  { key: 'payments', label: 'Payments' }, { key: 'escrows', label: 'Escrows' }, { key: 'cashouts', label: 'Cash-outs' },
  { key: 'batches', label: 'Batches' }, { key: 'schedules', label: 'Schedules' },
];
const STATUSES: Record<Tab, string[]> = {
  payments: ['initiated', 'submitted', 'completed', 'pending_claim', 'failed'],
  escrows: ['active', 'completed', 'refunded'],
  cashouts: ['pending', 'completed', 'failed'],
  batches: ['processing', 'completed', 'partial', 'failed'],
  schedules: ['active', 'paused'],
};
const PLACEHOLDER: Record<Tab, string> = {
  payments: 'Payment id, account id or tx hash', escrows: 'Escrow id or account id', cashouts: 'Cash-out id or worker id',
  batches: 'Batch id or employer id', schedules: 'Schedule id or employer id',
};
const PAGE = 50;
const DRAWER: Record<Tab, DrawerKind> = { payments: 'payment', escrows: 'escrow', cashouts: 'cashout', batches: 'batch', schedules: 'schedule' };

/**
 * Money platform-wide: payments, escrows, cash-outs, payout batches and payroll schedules, filtered and paged. The only
 * actions are compliance holds on an escrow (freeze, unfreeze, return a frozen escrow to the employer) and bringing the
 * database in line with the contract. An admin never sends, retries or claims anyone's money.
 */
export default function Money() {
  const params = useListParams();
  const tab = (params.get('tab') as Tab) || 'payments';
  const status = params.get('status');
  const q = params.get('q');
  const batchId = params.get('batchId');
  const frozenOnly = params.get('frozen') === 'true';
  const { offset, set } = params;

  const list = useLoad(async (): Promise<Row[]> => {
    const p = { status: status || undefined, q: q || undefined, limit: PAGE, offset };
    if (tab === 'escrows') return (await admin.escrows({ ...p, frozen: frozenOnly ? 'true' : undefined })).escrows;
    if (tab === 'cashouts') return (await admin.cashouts(p)).cashouts;
    if (tab === 'batches') return (await admin.batches(p)).batches;
    if (tab === 'schedules') return (await admin.schedules(p)).schedules;
    return (await admin.payments({ ...p, batchId: batchId || undefined })).payments;
  }, [tab, status, q, batchId, frozenOnly, offset]);
  const drawers = useDrawers(list.reload);

  /**
   * How a batch's payments ended, in words: "3 paid · 1 failed · 2 not sent (Worker KYC not verified)". An item that
   * failed its checks before anything was sent has no payment row; the batch keeps it and why (`unsent`). Batches from
   * before that was kept can only say how many.
   */
  const batchOutcome = (b: Row) => {
    const unsent: Row[] = Array.isArray(b.unsent) ? b.unsent : [];
    const recorded = b.completed + b.awaiting_claim + b.failed + b.in_flight;
    const notSent = Math.max(b.payment_count - recorded, unsent.length);
    const reasons = [...new Set(unsent.map((u) => u.reason))].join('; ');
    return [
      `${b.completed} paid`,
      b.awaiting_claim ? `${b.awaiting_claim} to claim` : '',
      b.failed ? `${b.failed} failed` : '',
      b.in_flight ? `${b.in_flight} on the way` : '',
      notSent ? `${notSent} not sent${reasons ? ` (${reasons})` : ' (reason not recorded)'}` : '',
    ].filter(Boolean).join(' · ');
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
    batches: [
      { label: 'Created', render: (b: Row) => when(b.created_at) },
      { label: 'Employer', render: (b: Row) => <AccountLink id={b.enterprise_id} email={b.enterprise_email} /> },
      { label: 'Payments', render: (b: Row) => b.payment_count },
      // What the batch moved once settled; batches recorded before that rule hold the amount asked for instead.
      { label: 'Amount (USD)', render: (b: Row) => money(b.total_amount) },
      { label: 'Status', render: (b: Row) => <Pill value={b.status} tone={b.status === 'partial' ? 'bad' : undefined} /> },
      { label: 'How they ended', render: batchOutcome },
    ],
    schedules: [
      { label: 'Name', render: (s: Row) => s.name },
      { label: 'Employer', render: (s: Row) => <AccountLink id={s.enterprise_id} email={s.enterprise_email} /> },
      { label: 'Every', render: (s: Row) => `${s.frequency} (${s.run_day})` },
      { label: 'People', render: (s: Row) => s.items },
      { label: 'Per run (USD)', render: (s: Row) => money(s.total_usd) },
      { label: 'Status', render: (s: Row) => <Pill value={s.status} /> },
      { label: 'Next run', render: (s: Row) => when(s.next_run_at) },
      {
        label: 'Last run',
        render: (s: Row) => (
          <>
            {when(s.last_run_at)} {s.last_run_status && <Pill value={s.last_run_status === 'success' ? 'completed' : s.last_run_status} />}
            {s.last_run_error && <div className="admin-detail" style={{ color: '#b91c1c' }}>{s.last_run_error}</div>}
            {s.last_run_batch_id && <div><Link to={`/money?batchId=${s.last_run_batch_id}`}>Open its payments</Link></div>}
          </>
        ),
      },
    ],
  }[tab];

  return (
    <div className="dashboard">
      <PageHeader title="Money" subtitle="Payments, escrows, cash-outs, payout batches and payroll schedules across the platform" />

      <Tabs<Tab> tabs={TABS} active={tab} onChange={(key) => params.reset(key === 'payments' ? {} : { tab: key })} />

      <div className="admin-filters">
        <select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES[tab].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        {tab === 'escrows' && (
          <label className="admin-check-label">
            <input type="checkbox" checked={frozenOnly} onChange={(e) => set({ frozen: e.target.checked ? 'true' : null })} /> Frozen only
          </label>
        )}
        {tab === 'payments' && batchId && (
          <span className="admin-chip">
            Batch <Id value={batchId} />
            <button type="button" onClick={() => set({ batchId: null })} aria-label="Show all payments">Clear</button>
          </span>
        )}
        <FilterInput value={q} placeholder={PLACEHOLDER[tab]} onApply={(v) => set({ q: v })} />
      </div>

      {tab === 'payments' && batchId && <BatchUnsent batchId={batchId} />}

      <Card>
        <LoadState loading={list.loading && !list.data} error={list.error} />
        {list.data && <Table<Row> rows={list.data} empty="Nothing matches." rowKey={(r) => r.id} columns={columns} onRowClick={drawers.open(DRAWER[tab])} />}
        <Pager offset={offset} shown={list.data?.length ?? 0} pageSize={PAGE} onPage={(o) => set({ offset: String(o) })} />
      </Card>

      {tab === 'escrows' && <Reconcile onRepaired={list.reload} />}

      {drawers.element}
    </div>
  );
}

/** The items of one batch that never became a payment, with why: they are not in the payments list below. */
function BatchUnsent({ batchId }: { batchId: string }) {
  const batch = useLoad(async () => (await admin.batches({ q: batchId, limit: 1 })).batches[0] ?? null, [batchId]);
  const unsent: Row[] = Array.isArray(batch.data?.unsent) ? batch.data!.unsent : [];
  if (!unsent.length) return null;
  return (
    <Card title={`Not sent (${unsent.length})`}>
      <p className="admin-muted">These failed a check before anything was sent, so they have no payment below.</p>
      <Table<Row> rows={unsent} rowKey={(u, i) => `${u.workerId}-${i}`} columns={[
        { label: 'Worker', render: (u) => <AccountLink id={u.workerId} /> },
        { label: 'Amount (USD)', render: (u) => money(u.amountUsd) },
        { label: 'Why', render: (u) => u.reason },
      ]} />
    </Card>
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
