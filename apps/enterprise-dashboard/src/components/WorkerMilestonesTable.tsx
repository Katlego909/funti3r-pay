import { useState } from 'react';
import type { Escrow } from '../api/escrows.js';
import type { PayoutMethod } from '../api/payments.js';
import { StatusBadge } from './StatusBadge.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import { buildMilestoneRows, inTab, type MilestoneTab } from '../lib/workerMilestones.js';

export interface SubmitTarget {
  escrowId: string;
  idx: number;
  title: string;
  previousReason?: string;
}

interface Props {
  escrows: Escrow[];
  payoutMethod: PayoutMethod;
  moneygramOn: boolean;
  /** `<escrowId>:<idx>` of the milestone with a request in flight. */
  busyKey: string | null;
  onClaim: (escrowId: string, idx: number) => void;
  onCashout: (escrowId: string, idx: number) => void;
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

/** The employer's most recent "changes requested" note for a milestone. */
function lastRejection(e: Escrow, idx: number): string | undefined {
  const rejected = (e.reviewEvents ?? []).filter((ev) => ev.idx === idx && ev.kind === 'rejected');
  return rejected[rejected.length - 1]?.note ?? undefined;
}

/**
 * The worker's milestones: what to do next first, finished work one tab away.
 * Status is the milestone's own lifecycle; a bank payout through the anchor is a separate column.
 */
export default function WorkerMilestonesTable({
  escrows, payoutMethod, moneygramOn, busyKey, onClaim, onCashout, onSubmitWork, onOpen,
}: Props) {
  const dc = useDisplayCurrency();
  const [tab, setTab] = useState<MilestoneTab>('active');
  const all = buildMilestoneRows(escrows);
  const rows = all.filter((r) => inTab(r, tab));

  return (
    <section className="section">
      <h3>Escrow Milestones</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--gray-600)', marginTop: '-6px' }}>
        Your employer locked these funds in an on-chain escrow. Approved milestones are yours to claim, and claimed
        money lands in your wallet. Select a row to see its transactions.
      </p>
      <div className="payments-status-tabs" style={{ marginBottom: 12 }}>
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
              <tr><th>Milestone</th><th>Amount</th><th>Expires</th><th>Status</th><th>Bank payout</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(({ escrow: e, milestone: m, state, payout }) => {
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
                    <td data-label="Bank payout" onClick={(ev) => ev.stopPropagation()}>
                      {payout ? (
                        <>
                          <StatusBadge variant={payout.variant} title={m.cashoutError ?? undefined}>{payout.label}</StatusBadge>
                          {m.payout && (
                            <div style={small}>
                              {m.payout.destination?.accountLast4 ? `To account ••••${m.payout.destination.accountLast4}` : 'Destination not recorded'}
                              {m.payout.receivedAmount && ` · anchor pays out ${m.payout.receivedAmount}${m.payout.receivedAsset ? ` ${m.payout.receivedAsset}` : ''}`}
                              {m.payout.sandbox && ' · test anchor, no real transfer'}
                            </div>
                          )}
                          {m.cashoutStatus === 'action_required' && (
                            <div style={small}>Enter exactly {m.amountXlm} XLM in the anchor form</div>
                          )}
                          {m.cashoutStatus === 'failed' && !payout.retryable && (
                            <div style={small}>Cash out from your wallet balance instead.</div>
                          )}
                          <div style={{ display: 'inline-flex', gap: 8, marginTop: 6 }}>
                            {m.cashoutStatus === 'action_required' && (
                              <>
                                {m.anchorMoreInfoUrl && (
                                  <a className="btn-secondary" href={m.anchorMoreInfoUrl} target="_blank" rel="noopener noreferrer"
                                    style={{ ...btn, padding: '6px 12px' }}>
                                    Open anchor form
                                  </a>
                                )}
                                <button className="btn-primary" style={btn} disabled={busy} onClick={() => onCashout(e.id, m.idx)}>
                                  {busy ? 'Checking…' : 'Continue'}
                                </button>
                              </>
                            )}
                            {payout.retryable && (
                              <button className="btn-secondary" style={btn} disabled={e.frozen || busy} onClick={() => onCashout(e.id, m.idx)}>
                                {busy ? 'Working…' : 'Retry'}
                              </button>
                            )}
                          </div>
                        </>
                      ) : m.status === 'claimed' && payoutMethod === 'anchor' && !moneygramOn ? (
                        <button className="btn-secondary" style={btn} disabled={e.frozen || busy} onClick={() => onCashout(e.id, m.idx)}>
                          {busy ? 'Working…' : 'Cash out'}
                        </button>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>—</span>
                      )}
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
                          {busy ? 'Claiming…' : payoutMethod === 'anchor' ? 'Claim & cash out' : 'Claim'}
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
