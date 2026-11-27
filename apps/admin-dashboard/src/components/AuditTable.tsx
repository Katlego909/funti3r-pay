import { Link } from 'react-router-dom';
import { admin, type AuditQuery, type Row } from '../api';
import { AccountLink, LoadState, Table, Tx } from './bits';
import { useDrawers } from './drawers';
import { short, when } from '../format';
import { describe } from './auditText';
import { useLoad } from '@funti3r/web-core';

/** What the event was about: the account's email, or the kind of record and its short id. */
function target(e: Row) {
  if (e.entity_type === 'user') return <AccountLink id={e.entity_id} email={e.entity_email} />;
  const id = String(e.entity_id ?? '');
  if (e.entity_type === 'payment' && e.detail?.batchId) return <Link to={`/money?batchId=${e.detail.batchId}`}>payment {short(id, 8)}</Link>;
  return <span className="admin-muted">{e.entity_type} {id === 'all' ? '(all)' : short(id.split(':')[0], 8)}</span>;
}

export const auditColumns = [
  { label: 'When', render: (e: Row) => <span className="admin-nowrap">{when(e.at)}</span> },
  {
    label: 'What happened',
    render: (e: Row) => {
      const { summary, reason, txHash } = describe(e);
      return (
        <div>
          <div>{summary}</div>
          {(reason || txHash) && (
            <div className="admin-detail">
              {reason && <>“{reason}”</>}{reason && txHash && ' · '}{txHash && <>tx <Tx hash={txHash} /></>}
            </div>
          )}
        </div>
      );
    },
  },
  {
    label: 'By',
    render: (e: Row) => (e.actor_id
      ? <><AccountLink id={e.actor_id} email={e.actor_email ?? e.actor_role} /><div className="admin-detail">{e.actor_role}</div></>
      : <span className="admin-muted">{e.actor_role}</span>),
  },
  { label: 'On', render: target },
];

/** The audit trail for one query (an account's, say), newest first. */
export default function AuditTable({ query }: { query: AuditQuery }) {
  const audit = useLoad(() => admin.audit(query), [JSON.stringify(query)]);
  const drawers = useDrawers();
  return (
    <>
      <LoadState state={audit} />
      {audit.data && <Table rows={audit.data.events} refreshing={audit.refreshing} empty="Nothing recorded." rowKey={(e) => String(e.id)} columns={auditColumns} onRowClick={drawers.open('audit')} />}
      {drawers.element}
    </>
  );
}
