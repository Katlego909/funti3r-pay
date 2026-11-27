import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useDrawers } from '../components/drawers';
import { AccountLink, Card, Id, LoadState, Pill, Table, Tx } from '../components/bits';
import { money, when } from '../format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH = /^[0-9a-f]{64}$/i;

/**
 * One box for everything: accounts and companies (email, name, id, Stellar address) from the directory, and payments
 * and escrows (by their id, a transaction hash, or an account id) from the money views.
 */
export default function Search() {
  const drawers = useDrawers();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q')?.trim() ?? '';
  const [draft, setDraft] = useState(q);

  const result = useLoad(async () => {
    if (q.length < 2) return null;
    const byId = UUID.test(q) || TX_HASH.test(q);
    const [directory, payments, escrows] = await Promise.all([
      admin.search(q),
      byId ? admin.payments({ q, limit: 20 }) : Promise.resolve(null),
      UUID.test(q) ? admin.escrows({ q, limit: 20 }) : Promise.resolve(null),
    ]);
    return { ...directory, payments: payments?.payments ?? [], escrows: escrows?.escrows ?? [] };
  }, [q]);

  function submit(e: FormEvent) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(draft.trim())}`);
  }

  const r = result.data;
  const nothing = r && !r.users.length && !r.companies.length && !r.payments.length && !r.escrows.length;

  return (
    <div className="dashboard">
      <PageHeader title="Search" subtitle="Email, account id, company name, Stellar address, payment id or transaction hash" />
      <form onSubmit={submit} className="admin-search-big">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search the platform" autoFocus />
        <button className="btn-primary" type="submit" disabled={draft.trim().length < 2}>Search</button>
      </form>

      {q.length >= 2 && <LoadState loading={result.loading} error={result.error} />}
      {nothing && <p className="admin-empty">Nothing matches “{q}”.</p>}

      {r && r.users.length > 0 && (
        <Card title={`Accounts (${r.users.length})`}>
          <Table<Row> rows={r.users} onRowClick={drawers.open('account')} rowKey={(u) => u.id} columns={[
            { label: 'Account', render: (u) => <AccountLink id={u.id} email={u.email} /> },
            { label: 'Role', render: (u) => u.role },
            { label: 'Status', render: (u) => <Pill value={u.status} /> },
            { label: 'Company', render: (u) => u.company_name ?? '—' },
            { label: 'Wallet', render: (u) => <Id value={u.stellar_public_key} /> },
            { label: 'Joined', render: (u) => when(u.created_at) },
          ]} />
        </Card>
      )}

      {r && r.companies.length > 0 && (
        <Card title={`Companies (${r.companies.length})`}>
          <Table<Row> rows={r.companies} onRowClick={drawers.open('company')} rowKey={(c) => c.id} columns={[
            { label: 'Company', render: (c) => <Link to={`/companies/${c.id}`}>{c.company_name}</Link> },
            { label: 'Owner', render: (c) => c.owner_email },
            { label: 'Country', render: (c) => c.country ?? '—' },
            { label: 'Members', render: (c) => c.members },
            { label: 'Workers', render: (c) => c.workers },
          ]} />
        </Card>
      )}

      {r && r.payments.length > 0 && (
        <Card title={`Payments (${r.payments.length})`}>
          <Table<Row> rows={r.payments} onRowClick={drawers.open('payment')} rowKey={(p) => p.id} columns={[
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

      {r && r.escrows.length > 0 && (
        <Card title={`Escrows (${r.escrows.length})`}>
          <Table<Row> rows={r.escrows} onRowClick={drawers.open('escrow')} rowKey={(x) => x.id} columns={[
            { label: 'Escrow', render: (x) => <Link to={`/money?tab=escrows&q=${x.id}`}><Id value={x.id} /></Link> },
            { label: 'Employer', render: (x) => <AccountLink id={x.enterprise_id} email={x.enterprise_email} /> },
            { label: 'Worker', render: (x) => <AccountLink id={x.worker_id} email={x.worker_email} /> },
            { label: 'Amount', render: (x) => money(x.total_amount, x.token_code) },
            { label: 'Status', render: (x) => <>{<Pill value={x.status} />} {x.frozen && <Pill value="frozen" />}</> },
          ]} />
        </Card>
      )}
      {drawers.element}
    </div>
  );
}
