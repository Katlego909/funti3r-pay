import type { Escrow } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';

const KIND: Record<string, ['completed' | 'failed' | 'pending', string]> = {
  submitted: ['pending', 'Work submitted'],
  approved: ['completed', 'Approved'],
  rejected: ['failed', 'Changes requested'],
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Who submitted, approved or sent back each milestone, with their note and links. */
export default function EscrowReviewLog({ escrow }: { escrow: Escrow }) {
  const events = escrow.reviewEvents ?? [];
  if (!events.length) {
    return <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>No review activity yet.</p>;
  }

  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead>
          <tr><th>Date</th><th>Milestone</th><th>Event</th><th>By</th><th>Details</th></tr>
        </thead>
        <tbody>
          {events.map((ev, i) => {
            const m = escrow.milestones.find((x) => x.idx === ev.idx);
            const [variant, label] = KIND[ev.kind] ?? ['pending', ev.kind];
            return (
              <tr key={`${ev.idx}-${ev.at}-${i}`}>
                <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{fmtDate(ev.at)}</td>
                <td data-label="Milestone" style={{ whiteSpace: 'nowrap' }}>
                  #{ev.idx + 1}{m?.description ? ` ${m.description}` : ''}
                </td>
                <td data-label="Event" style={{ whiteSpace: 'nowrap' }}><StatusBadge variant={variant}>{label}</StatusBadge></td>
                <td data-label="By" style={{ whiteSpace: 'nowrap' }}>{ev.by === 'worker' ? 'Worker' : 'Employer'}</td>
                <td data-label="Details" style={{ minWidth: 240 }}>
                  {ev.note && <div style={{ whiteSpace: 'pre-wrap' }}>{ev.note}</div>}
                  {ev.links.map((l) => (
                    <div key={l}>
                      <a href={l} target="_blank" rel="noopener noreferrer nofollow" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{l}</a>
                    </div>
                  ))}
                  {!ev.note && !ev.links.length && <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
