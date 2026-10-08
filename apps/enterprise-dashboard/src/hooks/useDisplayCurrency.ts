import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { getFxRates, getXlmPrice, getPreferredCurrency } from '../api/payments.js';
import { makeDisplayCurrency, type DisplayCurrency, type UsdRates } from '../lib/displayCurrency.js';

interface Market { xlmUsd: number; rates: UsdRates }

// One fetch shared by every component that formats an amount.
const TTL_MS = 5 * 60_000;
let cache: { at: number; market: Promise<Market> } | null = null;

function loadMarket(): Promise<Market> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = {
      at: Date.now(),
      market: Promise.all([getXlmPrice(), getFxRates()]).then(([xlmUsd, rates]) => ({ xlmUsd, rates })),
    };
  }
  return cache.market;
}

export type UseDisplayCurrency = DisplayCurrency & {
  /** False until the viewer's preference and the live rates have loaded. */
  ready: boolean;
};

/**
 * The one currency this viewer sees money in: a worker's preferred currency, USD for
 * everyone else. Use `format(amount, 'XLM')` etc. instead of printing `{amount} {currency}`.
 */
export function useDisplayCurrency(): UseDisplayCurrency {
  const user = useAuthStore((s) => s.user);
  const isWorker = user?.role === 'worker';
  const [market, setMarket] = useState<Market | null>(null);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [prefLoaded, setPrefLoaded] = useState(!isWorker);

  useEffect(() => {
    let cancelled = false;
    loadMarket().then((m) => { if (!cancelled) setMarket(m); }).catch(() => {});
    if (isWorker && user?.userId) {
      getPreferredCurrency(user.userId)
        .then((c) => { if (!cancelled) setPreferred(c); })
        .finally(() => { if (!cancelled) setPrefLoaded(true); });
    }
    return () => { cancelled = true; };
  }, [isWorker, user?.userId]);

  return useMemo(() => {
    const dc = makeDisplayCurrency({
      preferred: isWorker ? preferred : null,
      xlmUsd: market?.xlmUsd ?? 0,
      rates: market?.rates ?? {},
    });
    return { ...dc, ready: !!market && prefLoaded };
  }, [isWorker, preferred, market, prefLoaded]);
}
