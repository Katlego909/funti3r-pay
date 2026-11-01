import axios from 'axios';
import { getJSON, setJSON } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('FX');

/**
 * Live prices used to convert payouts: USD→fiat rates (open.er-api.com) and the XLM→USD price (CoinGecko).
 *
 * Prices are refreshed after FIAT_TTL / XLM_TTL and shared between replicas through Redis (falling back to this
 * process's memory if Redis is down). When a refresh fails, the last price is still used, but only while it is
 * younger than FX_MAX_AGE_MINUTES (default 30). Past that every lookup throws StaleRatesError, so a payout is
 * refused rather than priced on an out-of-date rate, and a missing price is never treated as 0.
 */
const FIAT_TTL_MS = 10 * 60 * 1000;
const XLM_TTL_MS = 5 * 60 * 1000;
const FIAT_KEY = 'fx:usd-rates';
const XLM_KEY = 'fx:xlm-usd';

function maxAgeMs(): number {
  const minutes = Number(process.env.FX_MAX_AGE_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

/** Prices are unavailable or older than FX_MAX_AGE_MINUTES. */
export class StaleRatesError extends Error {
  constructor(what: string) {
    super(`${what} is unavailable or out of date; try again shortly`);
    this.name = 'StaleRatesError';
  }
}

interface Cached<T> { value: T; ts: number }
const memory = new Map<string, Cached<unknown>>();

async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const shared = await getJSON<Cached<T>>(key);
    if (shared) return shared;
  } catch (err) {
    logger.debug('FX cache read fell back to memory', { key, error: String(err) });
  }
  return (memory.get(key) as Cached<T> | undefined) ?? null;
}

async function writeCache<T>(key: string, value: T, now: number): Promise<void> {
  const entry: Cached<T> = { value, ts: now };
  memory.set(key, entry);
  try {
    await setJSON(key, entry, Math.ceil(maxAgeMs() / 1000));
  } catch (err) {
    logger.debug('FX cache write fell back to memory', { key, error: String(err) });
  }
}

/** Return a fresh cached price, or fetch one; on a failed fetch, fall back to the last price while it is not stale. */
async function cachedPrice<T>(key: string, ttlMs: number, what: string, fetch: () => Promise<T | null>): Promise<T> {
  const now = Date.now();
  const cached = await readCache<T>(key);
  if (cached && now - cached.ts < ttlMs) return cached.value;

  try {
    const fresh = await fetch();
    if (fresh !== null) {
      await writeCache(key, fresh, now);
      return fresh;
    }
  } catch (err) {
    logger.warn(`${what} fetch failed`, { error: String(err) });
  }

  if (cached && now - cached.ts < maxAgeMs()) {
    logger.warn(`Using last known ${what}`, { ageSeconds: Math.round((now - cached.ts) / 1000) });
    return cached.value;
  }
  throw new StaleRatesError(what);
}

/** USD→fiat rates, units of each currency per 1 USD. */
export function getUsdRates(): Promise<Record<string, number>> {
  return cachedPrice(FIAT_KEY, FIAT_TTL_MS, 'Exchange rates', async () => {
    const { data } = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 });
    return data?.result === 'success' && data.rates ? (data.rates as Record<string, number>) : null;
  });
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

/** Live XLM→USD price. Never 0: throws StaleRatesError when no recent price is known. */
export function getXlmUsd(): Promise<number> {
  return cachedPrice(XLM_KEY, XLM_TTL_MS, 'The XLM price', async () => {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'stellar', vs_currencies: 'usd' }, timeout: 8000,
    });
    const usd = Number(data?.stellar?.usd);
    return Number.isFinite(usd) && usd > 0 ? usd : null;
  });
}

/**
 * Convert an amount of `code` to USD using live rates.
 *  XLM → amount × xlmUsd · USDC → amount · local → amount / (units per USD)
 */
export async function amountToUsd(code: string, amount: number): Promise<number> {
  const c = code.toUpperCase();
  if (c === 'USDC' || c === 'USD') return amount;
  if (c === 'XLM') return amount * (await getXlmUsd());
  return amount / (await usdToCurrencyRate(c));
}
