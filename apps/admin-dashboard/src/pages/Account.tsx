import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useDrawers } from '../components/drawers';
import { AccountLink, Card, Facts, Id, LoadState, Pill, Table, Tx } from '../components/bits';
import ReasonDialog, { type ReasonAction } from '../components/ReasonDialog';
import KycPanel from '../components/KycPanel';
import AuditTable from '../components/AuditTable';
import { money, when } from '../format';
import { useLoad } from '@funti3r/web-core';

/** A read that 404s means "none" (no KYC record yet, say), not a failure. */
const orNull = async <T,>(read: Promise<T>): Promise<T | null> => {
  try {
    return await read;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
};

/**
 * One account whole, the core support view: who they are and their status, their company ties, wallet and balances,
 * KYC, every payment / escrow / cash-out with why it failed, and what admins have done to the account.
 */
export default function AccountPage() {
  const { id = '' } = useParams();
  const account = useLoad(() => admin.account(id), [id]);
  const moneyView = useLoad(() => admin.money(id), [id]);
  const kyc = useLoad(() => orNull(admin.kyc(id)), [id]);
  const [action, setAction] = useState<ReasonAction | null>(null);
  const [auditKey, setAuditKey] = useState(0);

  const u = account.data?.user;
  const m = moneyView.data;
  const afterAction = () => { void account.reload(); setAuditKey((k) => k + 1); };
  const drawers = useDrawers(() => { void moneyView.reload(); afterAction(); });

  const statusAction: ReasonAction | null = !u ? null : u.status === 'active'
    ? {
      title: `Suspend ${u.email}?`,
      message: 'They are signed out everywhere within seconds and cannot sign in, pay, claim or cash out until reactivated. Their money stays where it is.',
      confirmLabel: 'Suspend account', danger: true,
      run: async (reason) => { await admin.suspend(id, reason); return 'Account suspended'; },
    }
    : u.status === 'suspended'
      ? {
        title: `Reactivate ${u.email}?`,
        message: 'They can sign in and use their account again.',
        confirmLabel: 'Reactivate account',
        run: async (reason) => { await admin.reactivate(id, reason); return 'Account reactivated'; },
      }
      : null; // closed stays closed

  return (
    <div className="dashboard">
      <PageHeader
        title={u?.email ?? 'Account'}
        subtitle={u ? `${u.role} account` : undefined}
        actions={statusAction && (
          <button className={u?.status === 'active' ? 'btn-secondary admin-danger' : 'btn-primary'} onClick={() => setAction(statusAction)}>
            {u?.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
        )}
      />
      <LoadState state={account} />

      {u && (
        <div className="admin-grid-2">
          <Card title="Profile">
            <Facts items={[
              ['Status', <Pill key="s" value={u.status} />],
              ['Role', u.role],
              ['Name', [u.first_name, u.last_name].filter(Boolean).join(' ') || '—'],
              ['Country', u.country],
              ['Phone', u.phone],
              ['Paid in', u.preferred_currency],
              ['KYC', <Pill key="k" value={kyc.loading ? '…' : kyc.data?.status ?? 'not submitted'} />],
              ['Account id', <Id key="i" value={u.id} />],
              ['Joined', when(u.created_at)],
              ['Recovered by email', u.recovered_at ? when(u.recovered_at) : 'never'],
            ]} />
          </Card>
          <Card title="Wallet">
            <LoadState state={moneyView} />
            {m && (
              <>
                <Facts items={[['Address', <Id key="a" value={m.wallet.address} keep={8} />]]} />
                <Table<Row>
                  rows={m.wallet.balances}
                  empty={m.wallet.address ? 'Not on the network yet: holds nothing.' : 'No wallet.'}
                  rowKey={(b, i) => `${b.asset_code ?? 'XLM'}-${i}`}
                  columns={[
                    { label: 'Asset', render: (b) => (b.asset_type === 'native' ? 'XLM' : b.asset_code) },
                    { label: 'Balance', render: (b) => money(b.balance) },
                    { label: 'Issuer', render: (b) => <Id value={b.asset_issuer} /> },
                  ]}
                />
              </>
            )}
          </Card>
        </div>
      )}

      {account.data && (account.data.memberships.length > 0 || account.data.employers.length > 0) && (
        <Card title="Companies">
          <Table<Row>
            rows={[
              ...account.data.memberships.map((r) => ({ ...r, tie: `member (${r.company_role})` })),
              ...account.data.employers.map((r) => ({ ...r, tie: 'worker', created_at: r.added_at })),
            ]}
            rowKey={(r, i) => `${r.company_id}-${i}`}
            onRowClick={drawers.open('company', 'company_id')}
            columns={[
              { label: 'Company', render: (r) => <Link to={`/companies/${r.company_id}`}>{r.company_name}</Link> },
              { label: 'As', render: (r) => r.tie },
              { label: 'Status', render: (r) => <Pill value={r.status} /> },
              { label: 'Since', render: (r) => when(r.created_at) },
            ]}
          />
        </Card>
      )}

      <KycPanel userId={id} state={kyc} onChanged={() => { void kyc.reload(); afterAction(); }} />

      {m && (
        <Card title={`Payments (${m.payments.length})`}>
          <Table<Row> rows={m.payments} onRowClick={drawers.open('payment')} empty="No payments." rowKey={(p) => p.id} columns={[
            { label: 'Created', render: (p) => when(p.created_at) },
            { label: 'From', render: (p) => <AccountLink id={p.enterprise_id} email={p.enterprise_email} /> },
            { label: 'To', render: (p) => <AccountLink id={p.worker_id} email={p.worker_email} /> },
            { label: 'Amount', render: (p) => money(p.amount, p.currency) },
            { label: 'Status', render: (p) => <Pill value={p.status} /> },
            { label: 'Why it failed', render: (p) => p.failure_reason ?? '—' },
            { label: 'Tx', render: (p) => <Tx hash={p.stellar_tx_hash} /> },
          ]} />
        </Card>
      )}

      {m && (m.escrows.length > 0 || m.cashouts.length > 0) && (
        <div className="admin-grid-2">
          <Card title={`Escrows (${m.escrows.length})`}>
            <Table<Row> rows={m.escrows} onRowClick={drawers.open('escrow')} empty="No escrows." rowKey={(x) => x.id} columns={[
              { label: 'Escrow', render: (x) => <Link to={`/money?tab=escrows&q=${x.id}`}>{money(x.total_amount, x.token_code)}</Link> },
              { label: 'Milestones', render: (x) => `${x.claimed}/${x.milestones} claimed` },
              { label: 'Status', render: (x) => <>{<Pill value={x.status} />} {x.frozen && <Pill value="frozen" />}</> },
            ]} />
          </Card>
          <Card title={`Cash-outs (${m.cashouts.length})`}>
            <Table<Row> rows={m.cashouts} onRowClick={drawers.open('cashout')} empty="No cash-outs." rowKey={(c) => c.id} columns={[
              { label: 'Created', render: (c) => when(c.created_at) },
              { label: 'USDC', render: (c) => money(c.send_usdc) },
              { label: 'Status', render: (c) => <Pill value={c.status} /> },
              { label: 'Error', render: (c) => c.error ?? '—' },
            ]} />
          </Card>
        </div>
      )}

      {m && m.schedules.length > 0 && (
        <Card title="Payroll schedules">
          <Table<Row> rows={m.schedules} onRowClick={drawers.open('schedule')} rowKey={(s) => s.id} columns={[
            { label: 'Name', render: (s) => s.name },
            { label: 'Every', render: (s) => s.frequency },
            { label: 'Status', render: (s) => <Pill value={s.status} /> },
            { label: 'Next run', render: (s) => when(s.next_run_at) },
            { label: 'Last run', render: (s) => <>{when(s.last_run_at)} {s.last_run_status && <Pill value={s.last_run_status} />}</> },
          ]} />
        </Card>
      )}

      {account.data && account.data.passkeys.length > 0 && (
        <Card title="Passkeys">
          <Table<Row> rows={account.data.passkeys} rowKey={(p) => p.origin} columns={[
            { label: 'Site', render: (p) => p.origin },
            { label: 'Passkeys', render: (p) => p.count },
            { label: 'Last added', render: (p) => when(p.last_added) },
          ]} />
        </Card>
      )}

      <Card title="What admins and the system did to this account">
        <AuditTable key={auditKey} query={{ entityId: id, limit: 25 }} />
      </Card>

      <ReasonDialog action={action} onClose={() => setAction(null)} onDone={afterAction} />
      {drawers.element}
    </div>
  );
}
