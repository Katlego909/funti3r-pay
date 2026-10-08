import { useRef } from 'react';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { Escrow } from '../api/escrows.js';
import SlideOver, { Row, SectionTitle } from './SlideOver.js';
import { StatusBadge } from './StatusBadge.js';
import CopyButton from './CopyButton.js';
import EscrowTransactions from './EscrowTransactions.js';

const STATUS: Record<Escrow['status'], ['completed' | 'pending', string]> = {
  active: ['completed', 'Active'],
  completed: ['completed', 'Completed'],
  refunded: ['pending', 'Refunded'],
};

/** Read-only side panel with an escrow's summary and full transaction history (worker wallet). */
export default function EscrowTransactionsDrawer({ escrow, onClose }: { escrow: Escrow | null; onClose: () => void }) {
  // Keep the last escrow so content stays put while the panel slides out.
  const last = useRef<Escrow | null>(null);
  if (escrow) last.current = escrow;
  const current = escrow ?? last.current;

  return (
    <SlideOver openKey={escrow} title="Escrow Transactions" width={820} onClose={onClose}>
      {current && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>
              {current.totalXlm} <span style={{ fontSize: '0.55em' }}>XLM</span>
            </div>
            <StatusBadge variant={STATUS[current.status][0]} style={{ marginTop: 10, display: 'inline-block' }}>
              {STATUS[current.status][1]}
            </StatusBadge>
            {current.frozen && (
              <StatusBadge variant="failed" style={{ marginTop: 10, marginLeft: 8, display: 'inline-block' }}>
                On compliance hold
              </StatusBadge>
            )}
          </div>

          <SectionTitle>Escrow</SectionTitle>
          <Row label="Expires">{new Date(current.expiresAt).toLocaleDateString()}</Row>
          <Row label="On-chain ID">#{current.onchainEscrowId}</Row>
          <Row label="Contract">
            <a
              href={`https://stellar.expert/explorer/testnet/contract/${current.contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'monospace', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {current.contractAddress.slice(0, 8)}…{current.contractAddress.slice(-6)} <HiOutlineArrowTopRightOnSquare size={12} />
            </a>
            <CopyButton text={current.contractAddress} style={{ marginLeft: 6, verticalAlign: 'middle' }} />
          </Row>

          <SectionTitle>Transactions</SectionTitle>
          <EscrowTransactions escrow={current} />
        </div>
      )}
    </SlideOver>
  );
}
