import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useListParams } from '../listParams';
import { AccountLink, Card, FilterInput, Id, LoadState, Pager, Pill, Table, Tabs } from '../components/bits';
import { when } from '../format';

const PAGE = 50;
type RoleTab = 'all' | 'enterprise' | 'worker' | 'admin';
const STATUSES = ['active', 'suspended', 'closed'];

/** Every account on the platform: by role, by status, or by part of the email. A row opens the account. */
export default function Accounts() {
  const list = useListParams();
  const role = (list.get('role') || 'all') as RoleTab;
  const status = list.get('status');
  const q = list.get('q');

  const page = useLoad(
    () => admin.accounts({ role: role === 'all' ? undefined : role, status: status || undefined, q: q || undefined, limit: PAGE, offset: list.offset }),
    [role, status, q, list.offset],
  );
  const ids = page.data?.accounts.map((a) => a.id as string) ?? [];
  const kyc = useLoad(async () => (ids.length ? (await admin.kycStatuses(ids)).statuses : {}), [ids.join(',')]);

  const byRole = page.data?.byRole;
  const all = byRole ? Object.values(byRole).reduce((n, c) => n + c, 0) : undefined;

  return (
    <div className="dashboard">
      <PageHeader title="Accounts" subtitle="Everyone with a Funti3rPay account" />
      <Tabs<RoleTab>
        active={role}
        onChange={(key) => list.set({ role: key === 'all' ? null : key })}
        tabs={[
          { key: 'all', label: 'All', count: all },
          { key: 'enterprise', label: 'Enterprises', count: byRole?.enterprise },
          { key: 'worker', label: 'Workers', count: byRole?.worker },
          { key: 'admin', label: 'Admins', count: byRole?.admin },
        ]}
      />
      <div className="admin-filters">
        <select value={status} onChange={(e) => list.set({ status: e.target.value })} aria-label="Account status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <FilterInput value={q} placeholder="Part of an email" onApply={(v) => list.set({ q: v })} />
      </div>
      <Card>
        <LoadState loading={page.loading && !page.data} error={page.error} />
        {page.data && (
          <Table<Row> rows={page.data.accounts} empty="No accounts match." rowKey={(a) => a.id} columns={[
            { label: 'Account', render: (a) => <AccountLink id={a.id} email={a.email} /> },
            { label: 'Role', render: (a) => a.role },
            { label: 'Status', render: (a) => <Pill value={a.status} /> },
            { label: 'Company', render: (a) => a.company_name ?? '—' },
            { label: 'KYC', render: (a) => (a.role === 'worker' ? <Pill value={kyc.data?.[a.id]?.status ?? (kyc.loading ? '…' : 'not submitted')} /> : '—') },
            { label: 'Wallet', render: (a) => <Id value={a.stellar_public_key} /> },
            { label: 'Joined', render: (a) => when(a.created_at) },
          ]} />
        )}
        <Pager offset={list.offset} shown={page.data?.accounts.length ?? 0} pageSize={PAGE} total={page.data?.total} onPage={(o) => list.set({ offset: String(o) })} />
      </Card>
    </div>
  );
}
