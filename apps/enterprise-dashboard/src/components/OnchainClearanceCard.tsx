import { useEffect, useState } from 'react';
import { getMyClearance, type OnchainClearance } from '../api/escrows.js';

/** What the escrow contract itself currently holds for this worker: the gate that decides whether a payout can move. */
export function OnchainClearanceCard() {
  const [clearance, setClearance] = useState<OnchainClearance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getMyClearance().then(setClearance).catch(() => setFailed(true));
  }, []);

  if (failed) return null; // the contract view is supplementary; KYCStatus already reports its own errors
  if (!clearance) return null;

  const tone = clearance.cleared
    ? { bg: '#f0fdf4', border: '#86efac', text: '#166534' }
    : { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' };

  return (
    <div style={{ marginTop: '16px', padding: '16px', backgroundColor: tone.bg, border: `1px solid ${tone.border}`, borderRadius: '8px', color: tone.text }}>
      <h4 style={{ margin: '0 0 8px' }}>Escrow contract clearance: {clearance.cleared ? 'Active' : 'Not active'}</h4>
      <div style={{ fontSize: '14px', lineHeight: 1.6 }}>
        {clearance.cleared && clearance.expiry && (
          <p style={{ margin: 0 }}>Valid until {new Date(clearance.expiry * 1000).toLocaleDateString()}. Escrow payouts to you can move.</p>
        )}
        {!clearance.cleared && (
          <p style={{ margin: 0 }}>
            {clearance.expiry
              ? 'Your clearance on the contract has expired. It is renewed when you next take part in an escrow.'
              : 'The contract has no clearance for you yet. It is recorded the first time an employer funds an escrow for you.'}
          </p>
        )}
        {clearance.attestation && (
          <p style={{ margin: '8px 0 0', wordBreak: 'break-all' }}>
            Screening record hash: <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '12px' }}>{clearance.attestation}</span>
          </p>
        )}
      </div>
    </div>
  );
}
