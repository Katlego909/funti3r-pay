/**
 * Payment rail router — selects the best available rail for a given country.
 *
 * Priority order per region:
 *   1. Stellar on-chain (always fastest, lowest fee, global)
 *   2. Regional fiat rail (cash pickup / mobile money / bank)
 *
 * For testnet the Stellar rail is always available. Fiat rails activate once
 * their API keys are configured in environment variables.
 */
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams } from './types.js';
import { StellarRail } from './stellar-xlm.js';
import { MoneyGramRail } from './moneygram.js';
import { FlutterwaveRail } from './flutterwave.js';
import { AirTMRail } from './airtm.js';
import { PuntoRedRail } from './puntored.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('PaymentRouter');

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

/** Returns the best rail for the given destination country and payment method. */
export function selectRail(
  destinationCountry: string,
  preferFiat: boolean = false,
): IPaymentRail {
  if (!preferFiat) return stellarRail;

  const available = fiatRails.filter(
    (r) => isConfigured(r) && supportsCountry(r, destinationCountry),
  );

  if (available.length === 0) {
    logger.info('No fiat rail available for country, falling back to Stellar', {
      destinationCountry,
    });
    return stellarRail;
  }

  // Priority: PuntoRed (Andean), Flutterwave (Africa), AirTM (LatAm), MoneyGram (everywhere)
  const priority = ['puntored', 'flutterwave', 'airtm', 'moneygram'];
  const sorted = available.sort(
    (a, b) => priority.indexOf(a.name) - priority.indexOf(b.name),
  );

  return sorted[0];
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
