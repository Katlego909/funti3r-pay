/**
 * MoneyGram Stellar Anchor — SEP-31 direct cross-border payment rail.
 *
 * MoneyGram operates a Stellar anchor supporting 200+ countries and cash pickup.
 * https://www.moneygram.com/mgo/us/en/developers/stellar.html
 *
 * Requires: MONEYGRAM_API_KEY, MONEYGRAM_API_URL
 * Testnet sandbox: https://extgw-sandbox.moneygram.com
 */
import axios from 'axios';
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams, RailResult } from './types.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Rail:MoneyGram');

// Countries supported by MoneyGram (subset shown — full list from /info endpoint)
const SUPPORTED_COUNTRIES = [
  'US', 'MX', 'CO', 'PE', 'EC', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA',
  'BO', 'PY', 'UY', 'AR', 'BR', 'CL', 'VE', 'DO', 'CU', 'PR',
  'NG', 'GH', 'KE', 'TZ', 'UG', 'RW', 'ZA', 'ET', 'SN',
  'PH', 'IN', 'PK', 'BD', 'VN', 'ID', 'TH', 'MY',
  'GB', 'DE', 'FR', 'ES', 'IT', 'PL', 'UA', 'RO',
];

interface MoneyGramQuoteResponse {
  quoteId: string;
  exchangeRate: number;
  fee: { amount: number; currency: string };
  totalCost: number;
  estimatedDeliveryMinutes: number;
  expiresAt: string;
}

interface MoneyGramTransactionResponse {
  transactionId: string;
  status: string;
  referenceNumber: string;
}

export class MoneyGramRail implements IPaymentRail {
  readonly name = 'moneygram';
  readonly supportedCountries = SUPPORTED_COUNTRIES;

  private get apiKey(): string {
    const key = process.env.MONEYGRAM_API_KEY;
    if (!key) throw new Error('MONEYGRAM_API_KEY is not configured');
    return key;
  }

  private get baseUrl(): string {
    return process.env.MONEYGRAM_API_URL || 'https://extgw-sandbox.moneygram.com';
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Partner-Id': process.env.MONEYGRAM_PARTNER_ID ?? '',
    };
  }

  async getQuote(params: RailQuoteParams): Promise<RailQuote> {
    const response = await axios.post<MoneyGramQuoteResponse>(
      `${this.baseUrl}/v1/quotes`,
      {
        sendAmount: params.amount,
        sendCurrency: params.sourceCurrency,
        receiveCurrency: params.destinationCurrency,
        receiveCountry: params.destinationCountry,
        paymentMethod: 'CASH_PICKUP',
      },
      { headers: this.headers() },
    );

    const q = response.data;
    return {
      rail: this.name,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      exchangeRate: q.exchangeRate,
      fee: q.fee.amount,
      estimatedDeliveryMinutes: q.estimatedDeliveryMinutes,
      quoteId: q.quoteId,
      expiresAt: new Date(q.expiresAt),
    };
  }

  async sendPayment(params: RailPaymentParams): Promise<RailResult> {
    if (!params.recipientName) throw new Error('recipientName is required for MoneyGram');
    if (!params.quoteId) throw new Error('quoteId is required — call getQuote first');

    logger.info('Initiating MoneyGram payout', {
      paymentId: params.paymentId,
      country: params.destinationCountry,
      amount: params.amount,
    });

    const response = await axios.post<MoneyGramTransactionResponse>(
      `${this.baseUrl}/v1/transactions`,
      {
        quoteId: params.quoteId,
        receiver: {
          name: params.recipientName,
          country: params.destinationCountry,
        },
        externalId: params.paymentId,
      },
      { headers: this.headers() },
    );

    const tx = response.data;
    logger.info('MoneyGram payout created', {
      paymentId: params.paymentId,
      transactionId: tx.transactionId,
      reference: tx.referenceNumber,
    });

    return {
      success: true,
      providerReference: tx.referenceNumber,
      status: tx.status === 'COMPLETED' ? 'completed' : 'pending',
    };
  }
}
