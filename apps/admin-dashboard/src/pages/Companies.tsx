import { Link } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useListParams } from '../listParams';
import { useDrawers } from '../components/drawers';
import { AccountLink, Card, FilterInput, LoadState, Pager, Table } from '../components/bits';
import { when } from '../format';
import { useLoad } from '@funti3r/web-core';

const PAGE = 50;

/** Every company on the platform, newest first, with its owner and size. A row opens the company. */
export default function Companies() {
  const drawers = useDrawers();
  const list = useListParams();
  const q = list.get('q');
  const page = useLoad(() => admin.companies({ q: q || undefined, limit: PAGE, offset: list.offset }), [q, list.offset]);

  return (
    <div className="dashboard">
      <PageHeader title="Companies" subtitle="Every business paying people through Funti3rPay" />
      <div className="admin-filters">
        <FilterInput value={q} placeholder="Part of a company name" onApply={(v) => list.set({ q: v })} />
      </div>
      <Card>
        <LoadState state={page} />
        {page.data && (
          <Table<Row> rows={page.data.companies} refreshing={page.refreshing} onRowClick={drawers.open('company')} empty={{ title: 'No companies match', message: 'Try another name, or clear the filter.' }} rowKey={(c) => c.id} columns={[
            { label: 'Company', render: (c) => <Link to={`/companies/${c.id}`}>{c.company_name}</Link> },
            { label: 'Owner', render: (c) => <AccountLink id={c.owner_id} email={c.owner_email} /> },
            { label: 'Country', render: (c) => c.country ?? '—' },
            { label: 'Members', render: (c) => c.members },
            { label: 'Workers', render: (c) => c.workers },
            { label: 'Joined', render: (c) => when(c.created_at) },
          ]} />
        )}
        <Pager offset={list.offset} shown={page.data?.companies.length ?? 0} pageSize={PAGE} total={page.data?.total} onPage={(o) => list.set({ offset: String(o) })} />
      </Card>
      {drawers.element}
    </div>
  );
}
