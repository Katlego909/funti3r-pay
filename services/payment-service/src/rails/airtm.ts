/**
 * AirTM payment rail — Latin American digital wallet and cash network.
 *
 * AirTM provides digital dollar wallets and local cash-out across
 * Latin America, with a peer-to-peer network in 50+ countries.
 * https://developers.airtm.com
 *
 * Requires: AIRTM_API_KEY, AIRTM_API_SECRET
 * Sandbox: https://sandbox-api.airtm.com/v1
 */
import axios from 'axios';
import { createHash } from 'crypto';
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams, RailResult } from './types.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Rail:AirTM');

const SUPPORTED_COUNTRIES = [
  'MX', 'CO', 'PE', 'AR', 'CL', 'BR', 'VE', 'EC', 'BO', 'PY',
  'UY', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'DO', 'CU',
];

interface AirTMQuoteResponse {
  quoteId: string;
  rate: number;
  fee: number;
  amountToReceive: number;
  expiresAt: string;
}

interface AirTMTransferResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  reference: string;
}

export class AirTMRail implements IPaymentRail {
  readonly name = 'airtm';
  readonly supportedCountries = SUPPORTED_COUNTRIES;

  private get apiKey(): string {
    const key = process.env.AIRTM_API_KEY;
    if (!key) throw new Error('AIRTM_API_KEY is not configured');
    return key;
  }

  private get apiSecret(): string {
    const secret = process.env.AIRTM_API_SECRET;
    if (!secret) throw new Error('AIRTM_API_SECRET is not configured');
    return secret;
  }

  private get baseUrl(): string {
    return process.env.AIRTM_API_URL || 'https://sandbox-api.airtm.com/v1';
  }

  private signRequest(body: string): string {
    return createHash('sha256')
      .update(this.apiSecret + body)
      .digest('hex');
  }

  private headers(body: string) {
    return {
      'X-API-Key': this.apiKey,
      'X-Signature': this.signRequest(body),
      'Content-Type': 'application/json',
    };
  }

  async getQuote(params: RailQuoteParams): Promise<RailQuote> {
    const body = JSON.stringify({
      amount: params.amount,
      from_currency: params.sourceCurrency,
      to_currency: params.destinationCurrency,
      country: params.destinationCountry,
    });

    const response = await axios.post<AirTMQuoteResponse>(
      `${this.baseUrl}/quotes`,
      body,
      { headers: this.headers(body) },
    );

    const q = response.data;
    return {
      rail: this.name,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      exchangeRate: q.rate,
      fee: q.fee,
      estimatedDeliveryMinutes: 60,
      quoteId: q.quoteId,
      expiresAt: new Date(q.expiresAt),
    };
  }

  async sendPayment(params: RailPaymentParams): Promise<RailResult> {
    if (!params.recipientAccount) throw new Error('recipientAccount (email or phone) is required');

    logger.info('Initiating AirTM transfer', {
      paymentId: params.paymentId,
      country: params.destinationCountry,
    });

    const payload = {
      quote_id: params.quoteId,
      external_id: params.paymentId,
      recipient_email: params.recipientAccount,
      recipient_name: params.recipientName,
      amount: params.amount,
      currency: params.sourceCurrency,
      payout_method: 'wallet',
    };
    const body = JSON.stringify(payload);

    const response = await axios.post<AirTMTransferResponse>(
      `${this.baseUrl}/transfers`,
      body,
      { headers: this.headers(body) },
    );

    const tx = response.data;
    logger.info('AirTM transfer created', {
      paymentId: params.paymentId,
      id: tx.id,
      status: tx.status,
    });

    return {
      success: tx.status !== 'failed',
      providerReference: tx.reference,
      status: tx.status === 'completed' ? 'completed' : 'pending',
    };
  }
}
