import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.js';
import MoneyGramWidget, { type DepositPayload } from './MoneyGramWidget.js';
import { startMoneyGramCashout, submitMoneyGramDeposit, type MoneyGramSession } from '../api/escrows.js';

interface Props {
  target: { escrowId: string; idx: number; title: string } | null;
  onClose: () => void;
  /** Called whenever the cash-out may have changed, so the list can refresh. */
  onChanged: () => void;
}

/** Worker cashes a claimed milestone out through MoneyGram (cash pickup). */
export default function MoneyGramCashoutModal({ target, onClose, onChanged }: Props) {
  const [session, setSession] = useState<MoneyGramSession | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setSession(null);
    setError('');
    startMoneyGramCashout(target.escrowId, target.idx)
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((err: any) => { if (!cancelled) setError(err?.response?.data?.error ?? 'Could not open MoneyGram'); });
    return () => { cancelled = true; };
  }, [target]);

  function close() {
    setSession(null);
    onChanged();
    onClose();
  }

  async function handleDeposit(p: DepositPayload): Promise<string> {
    if (!target) throw new Error('No cash-out in progress');
    try {
      const { txHash } = await submitMoneyGramDeposit(target.escrowId, target.idx, {
        address: p.address, memo: p.memo, amount: String(p.amount),
      });
      toast.success('Funds sent to MoneyGram');
      onChanged();
      return txHash;
    } catch (err: any) {
      throw new Error(err?.response?.data?.error ?? 'Could not send the funds to MoneyGram');
    }
  }

  return (
    <Modal open={!!target} onClose={close} title="Cash out with MoneyGram" closeButton maxWidth="480px">
      {target && (
        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 0 }}>
          <strong>{target.title}</strong> — pick a pickup country and location, then confirm.
          {session && <> This cash-out can use up to {session.maxXlm} XLM from your wallet.</>}
        </p>
      )}
      {error && <div className="error-banner">{error}</div>}
      {!session && !error && <p style={{ color: '#6b7280' }}>Opening MoneyGram…</p>}
      {session && (
        <MoneyGramWidget
          widgetUrl={session.widgetUrl}
          sessionToken={session.sessionToken}
          walletAddress={session.walletAddress}
          onDeposit={handleDeposit}
          onComplete={() => { toast.success('MoneyGram cash-out complete'); close(); }}
          onClose={close}
          onError={(m) => toast.error(m)}
        />
      )}
    </Modal>
  );
}
