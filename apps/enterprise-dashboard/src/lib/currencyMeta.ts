/** Display metadata for the currencies this platform actually supports (see payment-service/src/lib/currencies.ts). */
export const CURRENCY_META: Record<string, { name: string; symbol: string; color: string }> = {
  XLM: { name: 'Stellar Lumens', symbol: 'XLM', color: '#3b82f6' },
  USDC: { name: 'USD Coin', symbol: '$', color: '#16a34a' },
  NGN: { name: 'Nigerian Naira', symbol: '₦', color: '#f59e0b' },
  KES: { name: 'Kenyan Shilling', symbol: 'KSh', color: '#8b5cf6' },
  GHS: { name: 'Ghanaian Cedi', symbol: 'GH₵', color: '#ec4899' },
  ZAR: { name: 'South African Rand', symbol: 'R', color: '#06b6d4' },
  UGX: { name: 'Ugandan Shilling', symbol: 'USh', color: '#ef4444' },
};

/** Convenience lookup for just the color, with a neutral fallback for unknown codes. */
export function currencyColor(code: string, fallback = '#6b7280'): string {
  return CURRENCY_META[code]?.color ?? fallback;
}
