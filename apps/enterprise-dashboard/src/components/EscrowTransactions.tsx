import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { Escrow } from '../api/escrows.js';
import CopyButton from './CopyButton.js';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

interface TxRow {
  key: string;
  step: string;
  /** Which milestone the step belongs to; omitted for escrow-level steps. */
  milestone?: string;
  at?: string | null;
  /** On-chain transaction hash, when the step has one. */
  hash?: string | null;
  /** Off-chain reference (the anchor's own transaction id). */
  reference?: string;
  note?: string;
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** Every step of an escrow in the order it happens. */
function buildRows(escrow: Escrow): TxRow[] {
  const rows: TxRow[] = [
    { key: 'funded', step: 'Escrow funded', at: escrow.createdAt, hash: escrow.createTxHash },
  ];

  for (const m of escrow.milestones) {
    const milestone = `#${m.idx + 1}${m.description ? ` ${m.description}` : ''} · ${m.amountXlm} XLM`;

    if (m.approveTxHash || m.status === 'approved' || m.status === 'claimed') {
      rows.push({ key: `a${m.idx}`, step: 'Approved', milestone, at: m.approvedAt, hash: m.approveTxHash });
    }
    if (m.status === 'claimed') {
      rows.push({ key: `c${m.idx}`, step: 'Claimed', milestone, at: m.claimedAt, hash: m.claimTxHash });
    }
    if (m.anchorSettlementHash) {
      rows.push({
        key: `p${m.idx}`,
        step: 'Anchor payout',
        milestone,
        at: m.cashoutAt,
        hash: m.anchorSettlementHash,
        note: m.anchorStatus ? `Anchor: ${m.anchorStatus}` : undefined,
      });
    }
    if (m.anchorTxId) {
      rows.push({
        key: `r${m.idx}`,
        step: m.cashoutStatus === 'failed' ? 'Anchor withdrawal (failed)' : 'Anchor withdrawal',
        milestone,
        reference: m.anchorTxId,
        note: m.cashoutError ?? (m.cashoutStatus === 'action_required' ? 'Waiting for the anchor form' : undefined),
      });
    }
    if (m.status === 'refunded') {
      rows.push({ key: `f${m.idx}`, step: 'Refunded', milestone, hash: m.refundTxHash });
    }
  }
  return rows;
}

/** Transaction history of one escrow — same `data-table` look as Payments. */
export default function EscrowTransactions({ escrow }: { escrow: Escrow }) {
  const rows = buildRows(escrow);

  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead>
          <tr><th>Step</th><th>Date</th><th>Transaction</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td data-label="Step">
                <div style={{ fontWeight: 600 }}>{r.step}</div>
                {r.milestone && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.milestone}</div>}
                {r.note && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.note}</div>}
              </td>
              <td data-label="Date" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.at)}</td>
              <td data-label="Transaction">
                {r.hash ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <a
                      href={`${EXPLORER}/tx/${r.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={r.hash}
                      style={{ fontFamily: 'monospace', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {short(r.hash)} <HiOutlineArrowTopRightOnSquare size={12} />
                    </a>
                    <CopyButton text={r.hash} title="Copy transaction hash" />
                  </span>
                ) : r.reference ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }} title={r.reference}>{short(r.reference)}</span>
                    <CopyButton text={r.reference} title="Copy anchor transaction id" />
                  </span>
                ) : (
                  <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not recorded</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
