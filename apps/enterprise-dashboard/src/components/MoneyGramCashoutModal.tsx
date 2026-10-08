import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.js';
import MoneyGramWidget, { type DepositPayload } from './MoneyGramWidget.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import { startMoneyGramCashout, submitMoneyGramDeposit, type MoneyGramSession } from '../api/escrows.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called whenever the cash-out may have changed, so the list can refresh. */
  onChanged: () => void;
}

/** Worker cashes out of their wallet balance through MoneyGram (cash pickup). */
export default function MoneyGramCashoutModal({ open, onClose, onChanged }: Props) {
  const [session, setSession] = useState<MoneyGramSession | null>(null);
  const [error, setError] = useState('');
  const dc = useDisplayCurrency();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSession(null);
    setError('');
    startMoneyGramCashout()
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((err: any) => { if (!cancelled) setError(err?.response?.data?.error ?? 'Could not open MoneyGram'); });
    return () => { cancelled = true; };
  }, [open]);

  function close() {
    setSession(null);
    onChanged();
    onClose();
  }

  async function handleDeposit(p: DepositPayload): Promise<string> {
    try {
      const { txHash } = await submitMoneyGramDeposit({
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
    <Modal open={open} onClose={close} title="Cash out with MoneyGram" closeButton maxWidth="480px">
      <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 0 }}>
        Pick the amount, a pickup country and location, then confirm.
        {session && <> You can cash out up to {dc.format(session.maxXlm, 'XLM')} from your wallet.</>}
      </p>
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
          onError={(m) => {
            toast.error(m);
            // A deposit over the milestone can never succeed; leave the stuck widget so the worker can reopen and enter a smaller amount.
            if (/above the .* limit/.test(m)) close();
          }}
        />
      )}
    </Modal>
  );
}
