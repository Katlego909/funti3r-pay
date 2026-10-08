import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.js';
import MoneyGramWidget, { type DepositPayload } from './MoneyGramWidget.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import { startMoneyGramCashout, submitMoneyGramDeposit, type MoneyGramSession } from '../api/escrows.js';

const centered = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, textAlign: 'center',
} as const;

/** Shown while the session is created and the MoneyGram page loads; holds the space so the modal does not jump. */
function Opening({ overlay = false }: { overlay?: boolean }) {
  return (
    <div
      role="status"
      style={{ ...centered, minHeight: overlay ? undefined : 260, ...(overlay ? { position: 'absolute', inset: 0 } : {}) }}
    >
      <div
        style={{
          width: 34, height: 34, borderRadius: '50%', border: '3px solid var(--gray-200)',
          borderTopColor: 'var(--gray-900)', animation: 'spin 0.8s linear infinite',
        }}
      />
      <div>
        <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>Opening MoneyGram…</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--gray-600)', marginTop: 4 }}>Setting up a secure session</div>
      </div>
    </div>
  );
}

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
  const [widgetReady, setWidgetReady] = useState(false);
  // Bumped to try opening the session again after a failure.
  const [attempt, setAttempt] = useState(0);
  const dc = useDisplayCurrency();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSession(null);
    setError('');
    setWidgetReady(false);
    startMoneyGramCashout()
      .then((s) => { if (!cancelled) setSession(s); })
      .catch((err: any) => { if (!cancelled) setError(err?.response?.data?.error ?? 'Could not open MoneyGram'); });
    return () => { cancelled = true; };
  }, [open, attempt]);

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
      {session && (
        <p style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: 0 }}>
          Pick the amount, a pickup country and location, then confirm.
          You can cash out up to {dc.format(session.maxXlm, 'XLM')} from your wallet.
        </p>
      )}
      {error && (
        <div style={{ ...centered, minHeight: 200 }}>
          <div className="error-banner" style={{ margin: 0, textAlign: 'center' }}>{error}</div>
          <button className="btn-secondary" style={{ padding: '8px 18px' }} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {!session && !error && <Opening />}
      {session && (
        <div style={{ position: 'relative', minHeight: 640 }}>
          {!widgetReady && <Opening overlay />}
          <div style={{ opacity: widgetReady ? 1 : 0, transition: 'opacity 0.2s ease' }}>
            <MoneyGramWidget
              widgetUrl={session.widgetUrl}
              sessionToken={session.sessionToken}
              walletAddress={session.walletAddress}
              onDeposit={handleDeposit}
              onComplete={() => { toast.success('MoneyGram cash-out complete'); close(); }}
              onClose={close}
              onLoaded={() => setWidgetReady(true)}
              onError={(m) => {
                toast.error(m);
                // A deposit larger than the wallet can spare can never succeed; leave the stuck widget so the worker can reopen and enter a smaller amount.
                if (/above the .* limit/.test(m)) close();
              }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
