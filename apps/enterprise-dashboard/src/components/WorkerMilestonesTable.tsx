import { useState } from 'react';
import type { Escrow } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import { buildMilestoneRows, inTab, type MilestoneRow, type MilestoneTab } from '../lib/workerMilestones.js';
import ExportButtons from './ExportButtons.js';
import { exportMilestonesCSV, exportMilestonesPDF, type ExportMilestone } from '../utils/export.js';

export interface SubmitTarget {
  escrowId: string;
  idx: number;
  title: string;
  previousReason?: string;
}

interface Props {
  escrows: Escrow[];
  /** `<escrowId>:<idx>` of the milestone with a request in flight. */
  busyKey: string | null;
  onClaim: (escrowId: string, idx: number) => void;
  onSubmitWork: (target: SubmitTarget) => void;
  onOpen: (escrow: Escrow) => void;
}

const TABS: Array<[MilestoneTab, string]> = [['active', 'Active'], ['finished', 'Finished'], ['all', 'All']];
const EMPTY: Record<MilestoneTab, string> = {
  active: 'Nothing to do right now.',
  finished: 'No finished milestones yet.',
  all: 'No milestones yet.',
};
const small = { fontSize: '0.74rem', color: 'var(--gray-600)', marginTop: 4 } as const;
const btn = { padding: '6px 14px', fontSize: '0.8rem' } as const;

const toExport = ({ escrow: e, milestone: m, state }: MilestoneRow): ExportMilestone => ({
  escrowId: e.id,
  title: m.description || `Milestone ${m.idx + 1}`,
  position: e.milestones.length > 1 ? `${m.idx + 1} of ${e.milestones.length}` : '',
  amountXlm: m.amountXlm,
  status: state.label,
  expires: e.expiresAt,
  approvedAt: m.approvedAt,
  claimedAt: m.claimedAt,
  approveTxHash: m.approveTxHash,
  claimTxHash: m.claimTxHash,
  refundTxHash: m.refundTxHash,
});

/** The employer's most recent "changes requested" note for a milestone. */
function lastRejection(e: Escrow, idx: number): string | undefined {
  const rejected = (e.reviewEvents ?? []).filter((ev) => ev.idx === idx && ev.kind === 'rejected');
  return rejected[rejected.length - 1]?.note ?? undefined;
}

/**
 * The worker's milestones: what to do next first, finished work one tab away.
 * Status is the milestone's own lifecycle; cashing out is done from the wallet balance.
 */
export default function WorkerMilestonesTable({
  escrows, busyKey, onClaim, onSubmitWork, onOpen,
}: Props) {
  const dc = useDisplayCurrency();
  const [tab, setTab] = useState<MilestoneTab>('active');
  const all = buildMilestoneRows(escrows);
  const rows = all.filter((r) => inTab(r, tab));

  return (
    <section className="section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Escrow Milestones</h3>
        {rows.length > 0 && (
          <ExportButtons
            onCSV={() => exportMilestonesCSV(rows.map(toExport), tab !== 'all' ? `-${tab}` : '')}
            onPDF={() => exportMilestonesPDF(rows.map(toExport), tab !== 'all' ? `-${tab}` : '')}
          />
        )}
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--gray-600)', marginTop: '-6px', marginBottom: 0 }}>
        Your employer locked these funds in an on-chain escrow. Approved milestones are yours to claim, and claimed
        money lands in your wallet. Select a row to see its transactions.
      </p>
      <div className="payments-status-tabs" style={{ margin: '16px 0' }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={`status-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label} ({all.filter((r) => inTab(r, key)).length})
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty-state" style={{ padding: 0 }}>{EMPTY[tab]}</p>
      ) : (
        <div className="table-responsive">
          <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr><th>Milestone</th><th>Amount</th><th>Expires</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(({ escrow: e, milestone: m, state }) => {
                const key = `${e.id}:${m.idx}`;
                const busy = busyKey === key;
                const rejection = m.status === 'pending' && m.reviewStatus === 'rejected' ? lastRejection(e, m.idx) : undefined;
                const title = m.description || `Milestone ${m.idx + 1}`;
                return (
                  <tr key={key} onClick={() => onOpen(e)} style={{ cursor: 'pointer' }}>
                    <td data-label="Milestone">
                      <div style={{ fontWeight: 600 }}>{title}</div>
                      {e.milestones.length > 1 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>{m.idx + 1} of {e.milestones.length}</div>
                      )}
                    </td>
                    <td data-label="Amount">{dc.format(m.amountXlm, 'XLM')}</td>
                    <td data-label="Expires">{new Date(e.expiresAt).toLocaleDateString()}</td>
                    <td data-label="Status">
                      <StatusBadge variant={state.variant}>{state.label}</StatusBadge>
                      {rejection && <div style={small}>{rejection}</div>}
                    </td>
                    <td data-label="" onClick={(ev) => ev.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {m.status === 'pending' && e.status === 'active' && m.reviewStatus !== 'submitted' && state.label !== 'Expired' && (
                        <button
                          className="btn-secondary"
                          style={btn}
                          onClick={() => onSubmitWork({
                            escrowId: e.id, idx: m.idx, title,
                            previousReason: m.reviewStatus === 'rejected' ? lastRejection(e, m.idx) : undefined,
                          })}
                        >
                          {m.reviewStatus === 'rejected' ? 'Resubmit' : 'Submit work'}
                        </button>
                      )}
                      {m.status === 'approved' && (
                        <button
                          className="btn-primary"
                          style={btn}
                          disabled={e.frozen || busy}
                          title={e.frozen ? 'This escrow is on a compliance hold' : undefined}
                          onClick={() => onClaim(e.id, m.idx)}
                        >
                          {busy ? 'Claiming…' : 'Claim'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
