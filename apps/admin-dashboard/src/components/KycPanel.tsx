import { useEffect, useState } from 'react';
import { EmptyState } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { Card, LoadState, Pill, Table } from './bits';
import ReasonDialog, { type ReasonAction } from './ReasonDialog';
import { when } from '../format';
import { useLoad, type Loaded } from '@funti3r/web-core';

const SECTIONS: [string, string][] = [
  ['identity', 'Identity'], ['governmentId', 'Government ID'], ['address', 'Address'], ['taxInfo', 'Tax'], ['bankAccount', 'Bank'],
];
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/**
 * Someone's KYC as an admin sees it: identifying numbers masked by default. Revealing the full record takes a reason
 * and is written to the audit trail before anything is shown; the revealed copy lives only on this screen.
 * Approving clears a sanctions flag, which only a platform admin may do.
 */
export default function KycPanel({ userId, state, onChanged }: {
  userId: string; state: Loaded<Row | null>; onChanged: () => void;
}) {
  const record = state.data;
  const [revealed, setRevealed] = useState<Row | null>(null);
  const [action, setAction] = useState<ReasonAction | null>(null);
  const events = useLoad(async () => (record ? (await admin.kycEvents(userId)).events : []), [userId, record]);
  useEffect(() => setRevealed(null), [userId]);

  if (state.loading || (state.error && !record)) return <Card title="KYC"><LoadState state={state} skeleton="lines" /></Card>;
  if (!record) return <Card title="KYC"><EmptyState title="No KYC submitted yet" message="They have not sent their identity documents." compact /></Card>;

  const shown = revealed ?? record;
  const flagged = record.sanctions_status === 'flagged';
  const matches: Row[] = Array.isArray(record.sanctions_matches) ? record.sanctions_matches : [];

  const reveal: ReasonAction = {
    title: 'Reveal the full KYC record?',
    message: 'Shows ID, date of birth, address, tax and bank numbers in full. Your name, the time and your reason are recorded first.',
    confirmLabel: 'Reveal',
    run: async (reason) => { setRevealed(await admin.revealKyc(userId, reason)); return 'Revealed, and recorded in the audit trail'; },
  };
  const approve: ReasonAction = {
    title: flagged ? 'Clear the sanctions flag and approve?' : 'Approve this KYC?',
    message: flagged
      ? 'You are confirming the sanctions match is a different person. The account can then be paid and can cash out.'
      : 'The account is verified and can be paid and cash out.',
    confirmLabel: flagged ? 'Clear flag and approve' : 'Approve',
    run: async (reason) => { await admin.approveKyc(userId, reason); return 'KYC approved'; },
  };
  const reject: ReasonAction = {
    title: 'Reject this KYC?', message: 'They will need to submit again before they can be paid or cash out.',
    confirmLabel: 'Reject', danger: true,
    run: async (reason) => { await admin.rejectKyc(userId, reason); return 'KYC rejected'; },
  };

  return (
    <Card
      title="KYC"
      actions={(
        <>
          {!revealed && <button className="btn-secondary" onClick={() => setAction(reveal)}>Reveal full record</button>}
          {revealed && <button className="btn-secondary" onClick={() => setRevealed(null)}>Mask again</button>}
          {record.status !== 'verified' || flagged ? <button className="btn-primary" onClick={() => setAction(approve)}>Approve</button> : null}
          {record.status !== 'rejected' && <button className="btn-secondary admin-danger" onClick={() => setAction(reject)}>Reject</button>}
        </>
      )}
    >
      <div className="admin-kyc-status">
        <span>Status <Pill value={record.status} /></span>
        <span>Sanctions <Pill value={record.sanctions_status ?? 'not screened'} /></span>
        <span>Submitted {when(record.created_at)}</span>
        {record.verified_at && <span>Verified {when(record.verified_at)}</span>}
        <span className={revealed ? 'admin-revealed' : 'admin-muted'}>{revealed ? 'Showing the full record' : 'Identifying numbers masked'}</span>
      </div>

      {flagged && matches.length > 0 && (
        <div className="admin-flag">
          <strong>Possible sanctions match.</strong> Compare with the list entry before deciding:
          <Table<Row> rows={matches} rowKey={(x, i) => `${x.matchedName}-${i}`} columns={[
            { label: 'Name given', render: (x) => x.candidateName },
            { label: 'Listed as', render: (x) => x.matchedName },
            { label: 'List', render: (x) => `${x.list} · ${x.program}` },
            { label: 'Closeness', render: (x) => (x.distance === 0 ? 'exact' : `${x.distance} letters apart`) },
            { label: 'Year of birth', render: (x) => x.birthYear },
          ]} />
        </div>
      )}

      <div className="admin-kyc-grid">
        {SECTIONS.filter(([key]) => shown[key] && typeof shown[key] === 'object').map(([key, title]) => (
          <div key={key} className="admin-kyc-section">
            <h4>{title}</h4>
            <dl>
              {Object.entries(shown[key] as Row).map(([k, v]) => (
                <div key={k}><dt>{label(k)}</dt><dd>{v === null || v === '' ? '—' : String(v)}</dd></div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <h4 className="admin-subhead">KYC history</h4>
      <Table<Row> rows={events.data ?? []} empty="No decisions yet." rowKey={(e, i) => `${e.created_at}-${i}`} columns={[
        { label: 'When', render: (e) => when(e.created_at) },
        { label: 'What', render: (e) => e.action },
        { label: 'By', render: (e) => e.actor_role },
        { label: 'Reason', render: (e) => e.detail?.reason ?? '—' },
      ]} />

      <ReasonDialog action={action} onClose={() => setAction(null)} onDone={onChanged} />
    </Card>
  );
}
