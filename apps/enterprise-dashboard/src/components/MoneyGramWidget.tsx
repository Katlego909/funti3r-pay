import { useEffect, useMemo, useRef } from 'react';

/** What MoneyGram's widget reports when the user has confirmed and we must pay the deposit. */
export interface DepositPayload {
  address: string;
  memo: string;
  amount: string | number;
  chain?: string;
  asset?: string;
}

interface Props {
  widgetUrl: string;
  sessionToken: string;
  walletAddress: string;
  /** Pays the deposit (server-side) and returns the Stellar transaction hash. */
  onDeposit: (payload: DepositPayload) => Promise<string>;
  onComplete?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
  /** The widget page has finished loading (the iframe, not a MoneyGram step). */
  onLoaded?: () => void;
}

const isMoneyGramHost = (u: URL) =>
  u.protocol === 'https:' && (u.hostname === 'moneygram.com' || u.hostname.endsWith('.moneygram.com'));

/**
 * Hosts MoneyGram's Ramps widget in an iframe and speaks its postMessage protocol
 * (RAMPS_READY -> RAMPS_CONFIG, RAMPS_DEPOSIT_ADDRESS -> RAMPS_SIGN_SUCCESS/ERROR, …).
 *
 * Written against MoneyGram's SDK rather than loading it, so no remote script runs in
 * our page. Messages are only trusted from the widget's own origin AND its own frame.
 */
export default function MoneyGramWidget({ widgetUrl, sessionToken, walletAddress, onDeposit, onComplete, onClose, onError, onLoaded }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ onDeposit, onComplete, onClose, onError });
  latest.current = { onDeposit, onComplete, onClose, onError };

  const parsed = useMemo(() => {
    try {
      const u = new URL(widgetUrl);
      if (!isMoneyGramHost(u)) return null;
      const src = new URL(u.toString());
      src.searchParams.set('sessionToken', sessionToken);
      src.searchParams.set('theme', 'light');
      return { origin: u.origin, src: src.toString() };
    } catch {
      return null;
    }
  }, [widgetUrl, sessionToken]);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe || !parsed) return;
    const { origin } = parsed;
    const send = (type: string, payload?: unknown) => iframe.contentWindow?.postMessage({ type, payload }, origin);

    // The widget may repeat the deposit request; pay once and answer repeats with the same hash.
    let inflight: Promise<string> | null = null;

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== iframe.contentWindow) return;
      const ev = e.data as { type?: string; payload?: any } | undefined;
      if (!ev?.type?.startsWith('RAMPS_')) return;

      switch (ev.type) {
        case 'RAMPS_READY':
          send('RAMPS_CONFIG', {
            sessionToken,
            theme: 'light',
            wallet: { address: walletAddress, chain: 'stellar', asset: 'USDC', walletType: 'custodial' },
            mode: 'off-ramp',
          });
          break;
        case 'RAMPS_DEPOSIT_ADDRESS': {
          const p = ev.payload as DepositPayload;
          inflight ??= latest.current.onDeposit(p);
          inflight
            .then((txHash) => send('RAMPS_SIGN_SUCCESS', { txHash, walletAddress }))
            .catch((err) => {
              inflight = null; // allow a retry after a failure
              const message = err instanceof Error ? err.message : String(err);
              latest.current.onError?.(message);
              send('RAMPS_SIGN_ERROR', { error: message });
            });
          break;
        }
        case 'RAMPS_TRANSACTION_COMPLETE':
          latest.current.onComplete?.();
          break;
        case 'RAMPS_TRANSACTION_FAILED':
          latest.current.onError?.(String(ev.payload?.message ?? ev.payload?.error ?? 'MoneyGram could not complete this transaction'));
          break;
        case 'RAMPS_CLOSE':
          latest.current.onClose?.();
          break;
        case 'RAMPS_OPEN_URL': {
          const url = String(ev.payload?.url ?? '');
          if (url.startsWith('https://')) window.open(url, '_blank', 'noopener,noreferrer');
          break;
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [parsed, sessionToken, walletAddress]);

  if (!parsed) {
    return <div className="error-banner">MoneyGram returned an unexpected widget address, so it was not opened.</div>;
  }
  return (
    <iframe
      ref={frame}
      src={parsed.src}
      title="MoneyGram cash-out"
      onLoad={onLoaded}
      allow="clipboard-write; camera; geolocation"
      style={{ width: '100%', height: 640, border: 'none', borderRadius: 12, display: 'block', position: 'relative' }}
    />
  );
}
