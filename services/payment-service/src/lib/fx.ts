import axios from 'axios';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('FX');

/**
 * Live USD→fiat exchange rates (open.er-api.com, free, no key), cached 10 min.
 * Used to convert a USD-denominated payout into an exact local-currency amount.
 */
let cache: { rates: Record<string, number>; ts: number } = { rates: {}, ts: 0 };
const TTL = 10 * 60 * 1000;

export async function getUsdRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (Object.keys(cache.rates).length && now - cache.ts < TTL) return cache.rates;
  try {
    const { data } = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    if (data?.result === 'success' && data.rates) {
      cache = { rates: data.rates, ts: now };
    }
  } catch (err) {
    logger.warn('FX fetch failed; using last known rates', { error: String(err) });
  }
  return cache.rates;
}

/** Units of `code` per 1 USD. USDC is pegged 1:1; USD is 1. */
export async function usdToCurrencyRate(code: string): Promise<number> {
  const c = code.toUpperCase();
  if (c === 'USDC' || c === 'USD') return 1;
  const rates = await getUsdRates();
  const r = Number(rates[c]);
  if (!Number.isFinite(r) || r <= 0) {
    throw new Error(`No FX rate available for ${c}`);
  }
  return r;
}

let xlmCache = { usd: 0, ts: 0 };
/** Live XLM→USD price (CoinGecko), cached 5 min. Returns 0 if unavailable. */
export async function getXlmUsd(): Promise<number> {
  const now = Date.now();
  if (xlmCache.usd && now - xlmCache.ts < 5 * 60 * 1000) return xlmCache.usd;
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'stellar', vs_currencies: 'usd' }, timeout: 8000,
    });
    const usd = Number(data?.stellar?.usd) || 0;
    if (usd > 0) xlmCache = { usd, ts: now };
    return usd || xlmCache.usd;
  } catch {
    return xlmCache.usd;
  }
}

/**
 * Convert an amount of `code` to USD using live rates.
 *  XLM → amount × xlmUsd · USDC → amount · local → amount / (units per USD)
 */
export async function amountToUsd(code: string, amount: number): Promise<number> {
  const c = code.toUpperCase();
  if (c === 'USDC' || c === 'USD') return amount;
  if (c === 'XLM') return amount * (await getXlmUsd());
  const rates = await getUsdRates();
  const localPerUsd = Number(rates[c]);
  return localPerUsd > 0 ? amount / localPerUsd : 0;
}
