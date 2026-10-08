import type { WalletCashout } from '../api/escrows.js';

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The money of one MoneyGram cash-out as the steps it went through, every figure either stored or
 * worked out from stored ones: XLM sold -> swapped to USDC -> MoneyGram fee -> converted to the pickup
 * currency. A step is null when we have no record of it (older cash-outs, or MoneyGram has not yet
 * reported its quote).
 */
export interface CashoutReceipt {
  /** XLM taken from the wallet. */
  xlmSold: number | null;
  /** USDC bought with it, and sent to MoneyGram. */
  usdcSent: number | null;
  /** USDC received per 1 XLM sold. */
  swapRate: number | null;
  /** MoneyGram's fee in USDC (null when it is not in USDC or not reported). */
  feeUsdc: number | null;
  /** USDC left after the fee, the part MoneyGram converts. */
  usdcConverted: number | null;
  /** Pickup currency units per 1 USDC converted. */
  fxRate: number | null;
  receiveAmount: number | null;
  receiveCurrency: string | null;
}

export function buildReceipt(c: WalletCashout): CashoutReceipt {
  const xlmSold = num(c.xlmSpent);
  const usdcSent = num(c.sendUsdc);
  const fee = num(c.fee);
  const feeUsdc = fee !== null && (c.feeCurrency ?? 'USDC').toUpperCase().startsWith('USD') ? fee : null;
  const usdcConverted = usdcSent !== null ? usdcSent - (feeUsdc ?? 0) : null;
  const receiveAmount = num(c.receiveAmount);
  return {
    xlmSold,
    usdcSent,
    swapRate: xlmSold && usdcSent !== null ? usdcSent / xlmSold : null,
    feeUsdc,
    usdcConverted,
    fxRate: receiveAmount !== null && usdcConverted ? receiveAmount / usdcConverted : null,
    receiveAmount,
    receiveCurrency: c.receiveCurrency,
  };
}
