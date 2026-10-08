/**
 * One currency per viewer.
 *
 * The app holds money in several assets (XLM on the escrow contract, USDC, local
 * currencies a worker is paid in), and showing each as it is made the same money
 * read as several different numbers. Instead every amount is converted to a single
 * display currency — the worker's preferred currency, USD for employers — through a
 * USD pivot, and the original asset only appears in audit detail and on-chain links.
 *
 * Pure and dependency-free: rates come in as data (see hooks/useDisplayCurrency).
 */

/** Units of each currency per 1 USD (USDC and USD are 1). */
export type UsdRates = Record<string, number>;

export interface DisplayCurrency {
  /** What amounts are shown in: `USD` or a local code (`ZAR`, `NGN`…). */
  code: string;
  /** Converts `amount` of `from` into the display currency; null when no rate is known. */
  convert(amount: number, from: string): number | null;
  /** Formats an amount that is already in the display currency, e.g. `R 1,823.40`. */
  formatValue(value: number): string;
  /** `convert` + `formatValue`; `—` when the amount cannot be converted. */
  format(amount: number, from: string): string;
}

const SYMBOLS: Record<string, string> = {
  USD: '$', NGN: '₦', KES: 'KSh', GHS: 'GH₵', ZAR: 'R', UGX: 'USh',
};
/** Currencies with no meaningful minor unit. */
const WHOLE_UNITS = new Set(['UGX']);

const isDollar = (code: string) => code === 'USD' || code === 'USDC';

/** Display code for a stored preference: `USDC` is dollars, so it displays as `USD`. */
export function normalizeDisplayCode(code: string | null | undefined): string {
  const c = (code ?? 'USD').toUpperCase();
  return isDollar(c) ? 'USD' : c;
}

/** Amount of `from` in USD, or null when it can't be priced. */
function toUsd(amount: number, from: string, xlmUsd: number, rates: UsdRates): number | null {
  const c = from.toUpperCase();
  if (isDollar(c)) return amount;
  if (c === 'XLM') return xlmUsd > 0 ? amount * xlmUsd : null;
  const perUsd = Number(rates[c]);
  return perUsd > 0 ? amount / perUsd : null;
}

export function makeDisplayCurrency(opts: {
  /** Preferred currency (`ZAR`, `USDC`…); employers pass nothing and get USD. */
  preferred?: string | null;
  /** USD price of 1 XLM (0 when unavailable). */
  xlmUsd: number;
  rates: UsdRates;
}): DisplayCurrency {
  const { xlmUsd, rates } = opts;
  let code = normalizeDisplayCode(opts.preferred);
  // No rate for the preferred currency: show USD consistently rather than a wrong number.
  if (code !== 'USD' && !(Number(rates[code]) > 0)) code = 'USD';

  const perUsd = code === 'USD' ? 1 : Number(rates[code]);
  const symbol = SYMBOLS[code] ?? code;
  // Single-glyph symbols sit tight against the number ($1,200.00); longer ones get a space (KSh 1,200.00).
  const gap = symbol.length > 1 ? ' ' : '';
  const fractionDigits = WHOLE_UNITS.has(code) ? 0 : 2;

  const formatValue = (value: number) => {
    const text = Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
    });
    return `${value < 0 ? '-' : ''}${symbol}${gap}${text}`;
  };

  const convert = (amount: number, from: string) => {
    const usd = toUsd(amount, from, xlmUsd, rates);
    return usd === null ? null : usd * perUsd;
  };

  return {
    code,
    convert,
    formatValue,
    format: (amount, from) => {
      const v = convert(amount, from);
      return v === null ? '—' : formatValue(v);
    },
  };
}
