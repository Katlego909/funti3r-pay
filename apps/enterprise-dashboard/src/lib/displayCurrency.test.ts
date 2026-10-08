import { describe, it, expect } from 'vitest';
import { makeDisplayCurrency, normalizeDisplayCode } from './displayCurrency.js';

// Live-shaped rates: units of each currency per 1 USD.
const RATES = { ZAR: 18, NGN: 1500, KES: 130, UGX: 3700, USDC: 1 };
const XLM_USD = 0.1;

const zar = () => makeDisplayCurrency({ preferred: 'ZAR', xlmUsd: XLM_USD, rates: RATES });
const usd = () => makeDisplayCurrency({ preferred: null, xlmUsd: XLM_USD, rates: RATES });

describe('normalizeDisplayCode', () => {
  it('treats USDC (and nothing) as dollars, and upper-cases local codes', () => {
    expect(normalizeDisplayCode('USDC')).toBe('USD');
    expect(normalizeDisplayCode('usd')).toBe('USD');
    expect(normalizeDisplayCode(null)).toBe('USD');
    expect(normalizeDisplayCode(undefined)).toBe('USD');
    expect(normalizeDisplayCode('zar')).toBe('ZAR');
  });
});

describe('convert — everything goes through a USD pivot', () => {
  it('XLM -> local: 100 XLM = $10 = R180', () => {
    expect(zar().convert(100, 'XLM')).toBeCloseTo(180);
  });

  it('local -> a different local: R180 -> N15,000', () => {
    const ngn = makeDisplayCurrency({ preferred: 'NGN', xlmUsd: XLM_USD, rates: RATES });
    expect(ngn.convert(180, 'ZAR')).toBeCloseTo(15000);
  });

  it('USDC and USD are dollars at par', () => {
    expect(usd().convert(10, 'USDC')).toBe(10);
    expect(usd().convert(10, 'USD')).toBe(10);
    expect(zar().convert(10, 'USDC')).toBeCloseTo(180);
  });

  it('same currency in and out is unchanged', () => {
    expect(zar().convert(250, 'ZAR')).toBeCloseTo(250);
  });

  it('is case-insensitive about the source currency', () => {
    expect(zar().convert(100, 'xlm')).toBeCloseTo(180);
  });

  it('an employer (no preference) sees USD', () => {
    expect(usd().code).toBe('USD');
    expect(usd().convert(100, 'XLM')).toBeCloseTo(10);
  });
});

describe('when a rate is missing — never a wrong number', () => {
  it('cannot price XLM without an XLM price, and says so', () => {
    const dc = makeDisplayCurrency({ preferred: 'ZAR', xlmUsd: 0, rates: RATES });
    expect(dc.convert(100, 'XLM')).toBeNull();
    expect(dc.format(100, 'XLM')).toBe('—');
    // …but anything that does not need the XLM price still works
    expect(dc.convert(18, 'ZAR')).toBeCloseTo(18);
  });

  it('cannot price a currency it has no rate for', () => {
    expect(zar().convert(5, 'EUR')).toBeNull();
    expect(zar().format(5, 'EUR')).toBe('—');
  });

  it('falls back to USD for a preferred currency with no rate, consistently', () => {
    const dc = makeDisplayCurrency({ preferred: 'GHS', xlmUsd: XLM_USD, rates: { USDC: 1 } });
    expect(dc.code).toBe('USD');
    expect(dc.format(100, 'XLM')).toBe('$10.00');
  });

  it('copes with no market data at all (not loaded yet)', () => {
    const dc = makeDisplayCurrency({ preferred: 'ZAR', xlmUsd: 0, rates: {} });
    expect(dc.code).toBe('USD');
    expect(dc.format(25, 'USDC')).toBe('$25.00');
    expect(dc.format(25, 'XLM')).toBe('—');
  });
});

describe('formatValue', () => {
  it('uses the right symbol, grouping and decimals', () => {
    expect(usd().formatValue(1234.5)).toBe('$1,234.50');
    expect(zar().formatValue(1823.4)).toBe('R1,823.40');
    expect(makeDisplayCurrency({ preferred: 'NGN', xlmUsd: 0, rates: RATES }).formatValue(309553.38)).toBe('₦309,553.38');
  });

  it('puts a space after multi-letter symbols (KSh 1,200.00)', () => {
    expect(makeDisplayCurrency({ preferred: 'KES', xlmUsd: 0, rates: RATES }).formatValue(1200)).toBe('KSh 1,200.00');
  });

  it('shows whole units for currencies without minor units', () => {
    expect(makeDisplayCurrency({ preferred: 'UGX', xlmUsd: 0, rates: RATES }).formatValue(37000.4)).toBe('USh 37,000');
  });

  it('puts the minus sign before the symbol', () => {
    expect(zar().formatValue(-12.5)).toBe('-R12.50');
  });

  it('format = convert + formatValue', () => {
    expect(zar().format(100, 'XLM')).toBe('R180.00');
    expect(usd().format(100, 'XLM')).toBe('$10.00');
    expect(usd().format(0, 'XLM')).toBe('$0.00');
  });
});
