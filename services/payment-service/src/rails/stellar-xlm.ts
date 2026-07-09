/**
 * Stellar on-chain rail — quotes only.
 *
 * Actual on-chain payouts do NOT go through the rail abstraction: they are
 * executed by `executePayout` (src/app.ts) via lib/stellar's strict-receive
 * path payments, which handles per-currency issuers and exact-receive
 * semantics. This class only contributes the on-chain option to
 * GET /payouts/quotes.
 */
import type { IPaymentRail, RailQuote, RailQuoteParams } from './types.js';

export class StellarRail implements IPaymentRail {
  readonly name = 'stellar';
  readonly supportedCountries: string[] = ['*']; // global

  async getQuote(params: RailQuoteParams): Promise<RailQuote> {
    return {
      rail: this.name,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: process.env.STELLAR_SETTLEMENT_ASSET ?? 'XLM',
      exchangeRate: 1,
      fee: 0.00001, // Stellar base fee in XLM
      estimatedDeliveryMinutes: 1,
    };
  }
}
