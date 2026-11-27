import { FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, exportCSV } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useDrawers } from '../components/drawers';
import { Card, LoadState, Pager, Table } from '../components/bits';
import { auditColumns } from '../components/AuditTable';
import { describe } from '../components/auditText';
import { useLoad } from '@funti3r/web-core';

const PAGE = 100;
const FIELDS = [
  ['action', 'Action starts with', 'e.g. escrow. or account.suspended'],
  ['entityType', 'On a', 'user, escrow, payment, cashout…'],
  ['entityId', 'With id', 'the id it happened to'],
  ['actorId', 'Done by (account id)', 'an admin or user id'],
] as const;

/** Everything recorded as done to money and accounts, by whom and why: filterable, paged, exportable. */
export default function Audit() {
  const drawers = useDrawers();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FIELDS.map(([k]) => [k, params.get(k) ?? ''])) as Record<string, string>;
  const offset = Number(params.get('offset') ?? 0);
  const [draft, setDraft] = useState(filters);

  const query = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), limit: PAGE, offset };
  const page = useLoad(() => admin.audit(query), [JSON.stringify(query)]);

  function apply(e: FormEvent) {
    e.preventDefault();
    setParams(Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])));
  }

  function download(events: Row[]) {
    exportCSV(
      ['When', 'What happened', 'Reason', 'Transaction', 'Action', 'By', 'By (role)', 'On', 'On (id)', 'Detail', 'Request id'],
      events.map((e) => {
        const { summary, reason, txHash } = describe(e);
        return [e.at, summary, reason, txHash, e.action, e.actor_email ?? e.actor_id, e.actor_role, e.entity_type, e.entity_id, JSON.stringify(e.detail ?? {}), e.request_id];
      }),
      `funti3rpay-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <div className="dashboard">
      <PageHeader
        title="Audit log"
        subtitle="Every admin action and money movement, with who did it and why"
        actions={page.data && <button className="btn-secondary" onClick={() => download(page.data!.events)} disabled={!page.data.events.length}>Export CSV</button>}
      />
      <form className="admin-audit-filters" onSubmit={apply}>
        {FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="admin-label">
            {label}
            <input value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          </label>
        ))}
        <div className="admin-audit-buttons">
          <button className="btn-primary" type="submit">Filter</button>
          <button className="btn-secondary" type="button" onClick={() => { setDraft(Object.fromEntries(FIELDS.map(([k]) => [k, '']))); setParams({}); }}>Clear</button>
        </div>
      </form>
      <Card>
        <LoadState state={page} />
        {page.data && <Table rows={page.data.events} refreshing={page.refreshing} onRowClick={drawers.open('audit')} empty={{ title: 'Nothing recorded for this filter', message: 'Clear the filters to see everything admins and the system have done.' }} rowKey={(e) => String(e.id)} columns={auditColumns} />}
        <Pager offset={offset} shown={page.data?.events.length ?? 0} pageSize={PAGE} onPage={(o) => setParams({ ...Object.fromEntries(params), offset: String(o) })} />
      </Card>
      {drawers.element}
    </div>
  );
}
