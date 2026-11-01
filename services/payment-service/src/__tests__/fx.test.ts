import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import * as db from '@funti3r/database';

// Each test gets a fresh module so the in-process fallback cache starts empty.
async function loadFx() {
  vi.resetModules();
  return import('../lib/fx.js');
}

const get = vi.mocked(axios.get);
const NOW = new Date('2026-11-01T12:00:00Z').getTime();
const MIN = 60 * 1000;

const fiatResponse = (ngn: number) => ({ data: { result: 'success', rates: { NGN: ngn } } });
const xlmResponse = (usd: number) => ({ data: { stellar: { usd } } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  get.mockReset();
  // No Redis in unit tests: reads and writes fail, so fx falls back to its in-process cache.
  vi.spyOn(db, 'getJSON').mockRejectedValue(new Error('no redis'));
  vi.spyOn(db, 'setJSON').mockRejectedValue(new Error('no redis'));
  delete process.env.FX_MAX_AGE_MINUTES;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fiat rates', () => {
  it('converts with a fresh rate', async () => {
    const fx = await loadFx();
    get.mockResolvedValueOnce(fiatResponse(1500));
    expect(await fx.usdToCurrencyRate('NGN')).toBe(1500);
    expect(await fx.amountToUsd('NGN', 3000)).toBe(2);
    expect(get).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('keeps using the last rate while it is younger than the max age', async () => {
    const fx = await loadFx();
    get.mockResolvedValueOnce(fiatResponse(1500));
    await fx.getUsdRates();

    vi.setSystemTime(NOW + 20 * MIN); // past the 10 min refresh, inside the 30 min max age
    get.mockRejectedValueOnce(new Error('provider down'));
    expect(await fx.usdToCurrencyRate('NGN')).toBe(1500);
  });

  it('refuses once the last rate is older than the max age', async () => {
    const fx = await loadFx();
    get.mockResolvedValueOnce(fiatResponse(1500));
    await fx.getUsdRates();

    vi.setSystemTime(NOW + 31 * MIN);
    get.mockRejectedValueOnce(new Error('provider down'));
    await expect(fx.usdToCurrencyRate('NGN')).rejects.toBeInstanceOf(fx.StaleRatesError);
  });

  it('honours FX_MAX_AGE_MINUTES', async () => {
    process.env.FX_MAX_AGE_MINUTES = '15';
    const fx = await loadFx();
    get.mockResolvedValueOnce(fiatResponse(1500));
    await fx.getUsdRates();

    vi.setSystemTime(NOW + 16 * MIN);
    get.mockRejectedValueOnce(new Error('provider down'));
    await expect(fx.getUsdRates()).rejects.toBeInstanceOf(fx.StaleRatesError);
  });

  it('refuses when no rate was ever fetched', async () => {
    const fx = await loadFx();
    get.mockRejectedValueOnce(new Error('provider down'));
    await expect(fx.amountToUsd('NGN', 100)).rejects.toBeInstanceOf(fx.StaleRatesError);
  });

  it('USD and USDC never need a rate', async () => {
    const fx = await loadFx();
    expect(await fx.amountToUsd('USDC', 7)).toBe(7);
    expect(await fx.usdToCurrencyRate('USD')).toBe(1);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('XLM price', () => {
  it('never returns 0: a zero price from the provider is treated as unavailable', async () => {
    const fx = await loadFx();
    get.mockResolvedValueOnce(xlmResponse(0));
    await expect(fx.getXlmUsd()).rejects.toBeInstanceOf(fx.StaleRatesError);
  });

  it('a payout priced in XLM is refused when the price is stale', async () => {
    const fx = await loadFx();
    get.mockResolvedValueOnce(xlmResponse(0.4));
    expect(await fx.amountToUsd('XLM', 10)).toBe(4);

    vi.setSystemTime(NOW + 31 * MIN);
    get.mockRejectedValueOnce(new Error('provider down'));
    await expect(fx.amountToUsd('XLM', 10)).rejects.toBeInstanceOf(fx.StaleRatesError);
  });
});

describe('shared cache', () => {
  it('uses a fresh price another replica stored in Redis without fetching', async () => {
    const fx = await loadFx();
    vi.mocked(db.getJSON).mockResolvedValueOnce({ value: 0.5, ts: NOW - MIN });
    expect(await fx.getXlmUsd()).toBe(0.5);
    expect(get).not.toHaveBeenCalled();
  });
});
