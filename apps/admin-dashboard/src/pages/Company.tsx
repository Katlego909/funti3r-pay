import { useParams } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useDrawers } from '../components/drawers';
import { AccountLink, Card, Facts, Id, LoadState, Pill, Table, Tx } from '../components/bits';
import { money, when } from '../format';
import { useLoad } from '@funti3r/web-core';

/** One company whole: owner and wallet, members and their roles, workers, invites, and the money it has sent. */
export default function CompanyPage() {
  const drawers = useDrawers();
  const { id = '' } = useParams();
  const company = useLoad(() => admin.company(id), [id]);
  const c = company.data?.company;
  // The company pays from its owner's wallet, so its money is the owner's.
  const moneyView = useLoad(async () => (c ? admin.money(c.owner_id) : null), [c?.owner_id]);
  const m = moneyView.data;
  const workerIds = company.data?.workers.map((w) => w.id as string) ?? [];
  const kyc = useLoad(
    async () => (workerIds.length ? (await admin.kycStatuses(workerIds)).statuses : {}),
    [workerIds.join(',')],
  );

  return (
    <div className="dashboard">
      <PageHeader title={c?.company_name ?? 'Company'} subtitle={c ? `Owned by ${c.owner_email}` : undefined} />
      <LoadState state={company} />

      {c && company.data && (
        <>
          <div className="admin-grid-2">
            <Card title="Company">
              <Facts items={[
                ['Owner', <AccountLink key="o" id={c.owner_id} email={c.owner_email} />],
                ['Registration', c.company_registration],
                ['Country', c.country],
                ['Paying wallet', <Id key="w" value={c.wallet} keep={8} />],
                ['Company id', <Id key="i" value={c.id} />],
                ['Created', when(c.created_at)],
              ]} />
            </Card>
            <Card title={`Members (${company.data.members.length})`}>
              <Table<Row> rows={company.data.members} onRowClick={drawers.open('account')} rowKey={(r) => r.id} columns={[
                { label: 'Member', render: (r) => <AccountLink id={r.id} email={r.email} /> },
                { label: 'Role', render: (r) => r.company_role },
                { label: 'Membership', render: (r) => <Pill value={r.status} /> },
                { label: 'Account', render: (r) => <Pill value={r.account_status} /> },
              ]} />
            </Card>
          </div>

          <Card title={`Workers (${company.data.workers.length})`}>
            <Table<Row> rows={company.data.workers} onRowClick={drawers.open('account')} empty="No workers yet." rowKey={(r) => r.id} columns={[
              { label: 'Worker', render: (r) => <AccountLink id={r.id} email={r.email} /> },
              { label: 'With company', render: (r) => <Pill value={r.status} /> },
              { label: 'Account', render: (r) => <Pill value={r.account_status} /> },
              { label: 'KYC', render: (r) => <Pill value={kyc.data?.[r.id]?.status ?? (kyc.loading ? '…' : 'not submitted')} /> },
              { label: 'Paid in', render: (r) => r.preferred_currency ?? '—' },
              { label: 'Added', render: (r) => when(r.added_at) },
            ]} />
          </Card>

          {m && (
            <Card title={`Payments sent (${m.payments.length})`}>
              <Table<Row> rows={m.payments} onRowClick={drawers.open('payment')} empty="No payments." rowKey={(p) => p.id} columns={[
                { label: 'Created', render: (p) => when(p.created_at) },
                { label: 'To', render: (p) => <AccountLink id={p.worker_id} email={p.worker_email} /> },
                { label: 'Amount', render: (p) => money(p.amount, p.currency) },
                { label: 'Status', render: (p) => <Pill value={p.status} /> },
                { label: 'Why it failed', render: (p) => p.failure_reason ?? '—' },
                { label: 'Tx', render: (p) => <Tx hash={p.stellar_tx_hash} /> },
              ]} />
            </Card>
          )}

          {m && (m.escrows.length > 0 || m.schedules.length > 0) && (
            <div className="admin-grid-2">
              <Card title={`Escrows (${m.escrows.length})`}>
                <Table<Row> rows={m.escrows} onRowClick={drawers.open('escrow')} empty="No escrows." rowKey={(x) => x.id} columns={[
                  { label: 'Worker', render: (x) => <AccountLink id={x.worker_id} email={x.worker_email} /> },
                  { label: 'Amount', render: (x) => money(x.total_amount, x.token_code) },
                  { label: 'Status', render: (x) => <>{<Pill value={x.status} />} {x.frozen && <Pill value="frozen" />}</> },
                ]} />
              </Card>
              <Card title="Payroll schedules">
                <Table<Row> rows={m.schedules} onRowClick={drawers.open('schedule')} empty="No schedules." rowKey={(s) => s.id} columns={[
                  { label: 'Name', render: (s) => s.name },
                  { label: 'Every', render: (s) => s.frequency },
                  { label: 'Status', render: (s) => <Pill value={s.status} /> },
                  { label: 'Next run', render: (s) => when(s.next_run_at) },
                ]} />
              </Card>
            </div>
          )}

          <Card title={`Invites (${company.data.invites.length})`}>
            <Table<Row> rows={company.data.invites} empty="No invites." rowKey={(r, i) => `${r.email}-${i}`} columns={[
              { label: 'Email', render: (r) => r.email },
              { label: 'As', render: (r) => r.kind },
              { label: 'Status', render: (r) => <Pill value={r.status} /> },
              { label: 'Sent', render: (r) => when(r.created_at) },
              { label: 'Expires', render: (r) => when(r.expires_at) },
            ]} />
          </Card>
        </>
      )}
      {drawers.element}
    </div>
  );
}
