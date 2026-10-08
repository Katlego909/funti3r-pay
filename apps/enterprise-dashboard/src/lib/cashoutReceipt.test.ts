import { describe, it, expect } from 'vitest';
import type { WalletCashout } from '../api/escrows.js';
import { buildReceipt } from './cashoutReceipt.js';

const cashout = (over: Partial<WalletCashout> = {}): WalletCashout => ({
  id: 'c1', status: 'completed', mgStatus: 'processing', settlementHash: 'h', xlmSpent: 479.33, sendUsdc: '450',
  referenceNumber: '81495372', destinationCountry: 'ZAF', receiveAmount: '7116.54', receiveCurrency: 'ZAR',
  fee: '13.9', feeCurrency: 'USDC', error: null, createdAt: '2026-10-08T16:16:00Z', completedAt: null, sandbox: true, ...over,
});

describe('buildReceipt', () => {
  it('works the swap rate and the exchange rate out of what was stored', () => {
    const r = buildReceipt(cashout());
    expect(r.xlmSold).toBe(479.33);
    expect(r.usdcSent).toBe(450);
    expect(r.swapRate).toBeCloseTo(0.9388, 4);
    expect(r.feeUsdc).toBe(13.9);
    expect(r.usdcConverted).toBeCloseTo(436.1, 6);
    expect(r.fxRate).toBeCloseTo(16.3186, 3);
    expect(r.receiveAmount).toBe(7116.54);
    expect(r.receiveCurrency).toBe('ZAR');
  });

  it('keeps what it knows when the XLM cost was never recorded (older cash-outs)', () => {
    const r = buildReceipt(cashout({ xlmSpent: null, sendUsdc: '10', fee: '3', receiveAmount: '114.23' }));
    expect(r.xlmSold).toBeNull();
    expect(r.swapRate).toBeNull();
    expect(r.usdcConverted).toBe(7);
    expect(r.fxRate).toBeCloseTo(16.319, 3);
  });

  it('has no exchange rate until MoneyGram has quoted, and ignores a fee in another currency', () => {
    const waiting = buildReceipt(cashout({ receiveAmount: null, receiveCurrency: null, fee: null, feeCurrency: null }));
    expect(waiting.fxRate).toBeNull();
    expect(waiting.feeUsdc).toBeNull();
    expect(waiting.usdcConverted).toBe(450);

    const odd = buildReceipt(cashout({ fee: '200', feeCurrency: 'ZAR' }));
    expect(odd.feeUsdc).toBeNull();
    expect(odd.usdcConverted).toBe(450);
  });
});
