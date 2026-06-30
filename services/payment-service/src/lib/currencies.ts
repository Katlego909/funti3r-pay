/**
 * Registry of supported payout currencies.
 *
 * - XLM: native asset.
 * - USDC: Circle's issued stablecoin.
 * - NGN/KES/GHS/ZAR/UGX: local African currencies. On testnet these are issued
 *   by our own account (STELLAR_AFRICA_ISSUER) with seeded DEX liquidity; on
 *   mainnet, point the issuer at a real anchor — nothing else changes.
 *
 * "Local" currencies are settled via path payment: the employer sends value in
 * XLM/USD and the worker receives an exact amount of their local currency.
 */
export type CurrencyKind = 'native' | 'stablecoin' | 'local';

export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  kind: CurrencyKind;
  issuer?: string; // undefined for native XLM
}

const USDC_ISSUER = process.env.STELLAR_USDC_ISSUER;
const AFRICA_ISSUER = process.env.STELLAR_AFRICA_ISSUER;

export const CURRENCIES: Record<string, CurrencyDef> = {
  XLM: { code: 'XLM', name: 'Stellar Lumens', symbol: 'XLM', kind: 'native' },
  USDC: { code: 'USDC', name: 'USD Coin', symbol: '$', kind: 'stablecoin', issuer: USDC_ISSUER },
  NGN: { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', kind: 'local', issuer: AFRICA_ISSUER },
  KES: { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', kind: 'local', issuer: AFRICA_ISSUER },
  GHS: { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', kind: 'local', issuer: AFRICA_ISSUER },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'R', kind: 'local', issuer: AFRICA_ISSUER },
  UGX: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', kind: 'local', issuer: AFRICA_ISSUER },
};

/** Currencies a worker can choose to be paid in (excludes the native gas asset). */
export const PAYOUT_CURRENCIES = Object.values(CURRENCIES).filter((c) => c.code !== 'XLM');

export const LOCAL_CURRENCY_CODES = Object.values(CURRENCIES)
  .filter((c) => c.kind === 'local')
  .map((c) => c.code);

export function getCurrency(code: string): CurrencyDef | undefined {
  return CURRENCIES[code?.toUpperCase()];
}

export function isSupportedCurrency(code: string): boolean {
  return !!getCurrency(code);
}
