import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { Escrow } from '../api/escrows.js';
import CopyButton from './CopyButton.js';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

interface TxEvent {
  key: string;
  title: string;
  detail?: string;
  at?: string | null;
  /** On-chain transaction hash, when this step has one. */
  hash?: string | null;
  /** Off-chain reference (e.g. the anchor's own transaction id). */
  reference?: { label: string; value: string };
}

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : undefined);
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/** Every step of an escrow, in the order it happens, each with its transaction. */
function buildEvents(escrow: Escrow): TxEvent[] {
  const events: TxEvent[] = [
    {
      key: 'funded',
      title: 'Escrow funded',
      detail: `${escrow.totalXlm} XLM locked in the contract · escrow #${escrow.onchainEscrowId}`,
      at: escrow.createdAt,
      hash: escrow.createTxHash,
    },
  ];

  for (const m of escrow.milestones) {
    const name = `Milestone ${m.idx + 1}${m.description ? ` — ${m.description}` : ''} (${m.amountXlm} XLM)`;

    if (m.approveTxHash || m.status === 'approved' || m.status === 'claimed') {
      events.push({ key: `a${m.idx}`, title: `Approved · ${name}`, at: m.approvedAt, hash: m.approveTxHash });
    }
    if (m.status === 'claimed') {
      events.push({ key: `c${m.idx}`, title: `Claimed by worker · ${name}`, at: m.claimedAt, hash: m.claimTxHash });
    }
    if (m.cashoutStatus === 'completed' && m.anchorSettlementHash) {
      events.push({
        key: `p${m.idx}`,
        title: `Paid out via anchor · ${name}`,
        detail: m.anchorStatus ? `Anchor status: ${m.anchorStatus}` : undefined,
        at: m.cashoutAt,
        hash: m.anchorSettlementHash,
        reference: m.anchorTxId ? { label: 'Anchor transaction', value: m.anchorTxId } : undefined,
      });
    } else if (m.anchorTxId) {
      events.push({
        key: `p${m.idx}`,
        title: `Anchor cash-out ${m.cashoutStatus === 'failed' ? 'failed' : 'in progress'} · ${name}`,
        detail: m.cashoutError ?? (m.cashoutStatus === 'action_required' ? 'Waiting for the worker to complete the anchor form' : undefined),
        reference: { label: 'Anchor transaction', value: m.anchorTxId },
      });
    }
    if (m.status === 'refunded') {
      events.push({ key: `r${m.idx}`, title: `Refunded to employer · ${name}`, hash: m.refundTxHash });
    }
  }
  return events;
}

export default function EscrowTransactions({ escrow }: { escrow: Escrow }) {
  const events = buildEvents(escrow);

  return (
    <div>
      {events.map((ev) => (
        <div key={ev.key} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{ev.title}</div>
          {(ev.at || ev.detail) && (
            <div style={{ fontSize: '0.76rem', color: '#6b7280', marginTop: 2 }}>
              {[fmt(ev.at), ev.detail].filter(Boolean).join(' · ')}
            </div>
          )}
          {ev.hash && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '0.78rem' }}>
              <span style={{ color: '#6b7280' }}>Tx</span>
              <a
                href={`${EXPLORER}/tx/${ev.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                title={ev.hash}
                style={{ fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {short(ev.hash)} <HiOutlineArrowTopRightOnSquare size={12} />
              </a>
              <CopyButton text={ev.hash} title="Copy transaction hash" />
            </div>
          )}
          {ev.reference && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '0.78rem' }}>
              <span style={{ color: '#6b7280' }}>{ev.reference.label}</span>
              <span style={{ fontFamily: 'monospace' }} title={ev.reference.value}>{short(ev.reference.value)}</span>
              <CopyButton text={ev.reference.value} title={`Copy ${ev.reference.label.toLowerCase()} id`} />
            </div>
          )}
          {!ev.hash && !ev.reference && ev.key !== 'funded' && (
            <div style={{ fontSize: '0.74rem', color: '#9ca3af', marginTop: 4 }}>No transaction hash recorded</div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 0', fontSize: '0.78rem' }}>
        <span style={{ color: '#6b7280' }}>Contract</span>
        <a
          href={`${EXPLORER}/contract/${escrow.contractAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          title={escrow.contractAddress}
          style={{ fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {short(escrow.contractAddress)} <HiOutlineArrowTopRightOnSquare size={12} />
        </a>
        <CopyButton text={escrow.contractAddress} title="Copy contract address" />
      </div>
    </div>
  );
}
