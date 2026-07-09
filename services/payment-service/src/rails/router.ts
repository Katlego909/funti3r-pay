/**
 * Payment rail quote aggregator.
 *
 * The Stellar rail is always available; fiat rails (cash pickup / mobile
 * money / bank) activate once their API keys are configured in environment
 * variables. Rail *sending* is fiat-only and not wired up yet — on-chain
 * payouts are executed by executePayout (src/app.ts), not through here.
 */
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams } from './types.js';
import { StellarRail } from './stellar-xlm.js';
import { MoneyGramRail } from './moneygram.js';
import { FlutterwaveRail } from './flutterwave.js';
import { AirTMRail } from './airtm.js';
import { PuntoRedRail } from './puntored.js';

const stellarRail = new StellarRail();
const fiatRails: IPaymentRail[] = [
  new MoneyGramRail(),
  new FlutterwaveRail(),
  new AirTMRail(),
  new PuntoRedRail(),
];

function isConfigured(rail: IPaymentRail): boolean {
  const envMap: Record<string, string | undefined> = {
    moneygram: process.env.MONEYGRAM_API_KEY,
    flutterwave: process.env.FLUTTERWAVE_SECRET_KEY,
    airtm: process.env.AIRTM_API_KEY,
    puntored: process.env.PUNTORED_API_KEY,
  };
  return envMap[rail.name] !== undefined && envMap[rail.name] !== '';
}

function supportsCountry(rail: IPaymentRail, country: string): boolean {
  return rail.supportedCountries.includes('*') || rail.supportedCountries.includes(country);
}

/** Returns quotes from all available rails for the given parameters. */
export async function getAllQuotes(params: RailQuoteParams): Promise<RailQuote[]> {
  const rails: IPaymentRail[] = [
    stellarRail,
    ...fiatRails.filter(
      (r) => isConfigured(r) && supportsCountry(r, params.destinationCountry),
    ),
  ];

  const results = await Promise.allSettled(rails.map((r) => r.getQuote(params)));

  return results
    .filter((r): r is PromiseFulfilledResult<RailQuote> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams };
