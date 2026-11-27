import { admin, type AuditQuery, type Row } from '../api';
import { useLoad } from '../useLoad';
import { AccountLink, LoadState, Table } from './bits';
import { when } from '../format';

/** Detail worth reading at a glance: the reason first, then anything else, compactly. */
export function auditDetail(detail: Row | null | undefined): string {
  if (!detail) return '—';
  const { reason, ...rest } = detail;
  const extra = Object.keys(rest).length ? JSON.stringify(rest) : '';
  return [reason ? `“${reason}”` : '', extra].filter(Boolean).join('  ');
}

export const auditColumns = [
  { label: 'When', render: (e: Row) => when(e.at) },
  { label: 'Action', render: (e: Row) => <code>{e.action}</code> },
  { label: 'By', render: (e: Row) => (e.actor_id ? <AccountLink id={e.actor_id} email={e.actor_role} /> : e.actor_role) },
  { label: 'On', render: (e: Row) => `${e.entity_type} ${e.entity_id?.length > 12 ? `${e.entity_id.slice(0, 8)}…` : e.entity_id}` },
  { label: 'Detail', render: (e: Row) => <span className="admin-detail">{auditDetail(e.detail)}</span> },
];

/** The audit trail for one query (an account's, say), newest first. */
export default function AuditTable({ query }: { query: AuditQuery }) {
  const { data, error, loading } = useLoad(() => admin.audit(query), [JSON.stringify(query)]);
  return (
    <>
      <LoadState loading={loading && !data} error={error} />
      {data && <Table rows={data.events} empty="Nothing recorded." rowKey={(e) => String(e.id)} columns={auditColumns} />}
    </>
  );
}
