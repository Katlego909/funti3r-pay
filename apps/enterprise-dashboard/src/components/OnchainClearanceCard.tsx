import { useEffect, useState } from 'react';
import { getMyClearance, type OnchainClearance } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';

const line = { margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--gray-600)' } as const;

/** What the escrow contract itself currently holds for this worker: the gate that decides whether a payout can move. */
export function OnchainClearanceCard() {
  const [clearance, setClearance] = useState<OnchainClearance | null>(null);

  useEffect(() => {
    // Supplementary view: KYCStatus already reports its own errors, so a failed read just shows nothing.
    getMyClearance().then(setClearance).catch(() => undefined);
  }, []);

  if (!clearance) return null;

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--gray-200)' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--gray-600)', marginBottom: 8 }}>Escrow contract clearance</div>
      <StatusBadge variant={clearance.cleared ? 'completed' : 'pending'}>
        {clearance.cleared ? 'Active' : 'Not active'}
      </StatusBadge>
      {clearance.cleared && clearance.expiry && (
        <p style={line}>Valid until {new Date(clearance.expiry * 1000).toLocaleDateString()}. Escrow payouts to you can move.</p>
      )}
      {!clearance.cleared && (
        <p style={line}>
          {clearance.expiry
            ? 'Your clearance on the contract has expired. It is renewed when you next take part in an escrow.'
            : 'The contract has no clearance for you yet. It is recorded the first time an employer funds an escrow for you.'}
        </p>
      )}
      {clearance.attestation && (
        <p style={{ ...line, wordBreak: 'break-all' }}>
          Screening record hash:{' '}
          <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.78rem' }}>{clearance.attestation}</span>
        </p>
      )}
    </div>
  );
}
