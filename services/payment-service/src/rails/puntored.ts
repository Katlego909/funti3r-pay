/**
 * PuntoRed payment rail — Colombia, Peru, Ecuador cash network.
 *
 * PuntoRed connects to thousands of cash-pay points across the Andean region.
 * https://www.puntorecarga.com.co/developers
 *
 * Requires: PUNTORED_API_KEY, PUNTORED_API_URL
 */
import axios from 'axios';
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams, RailResult } from './types.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Rail:PuntoRed');

const SUPPORTED_COUNTRIES = ['CO', 'PE', 'EC'];

interface PuntoRedTransactionResponse {
  transactionCode: string;
  pinCode: string;
  status: string;
  expiresAt: string;
}

export class PuntoRedRail implements IPaymentRail {
  readonly name = 'puntored';
  readonly supportedCountries = SUPPORTED_COUNTRIES;

  private get apiKey(): string {
    const key = process.env.PUNTORED_API_KEY;
    if (!key) throw new Error('PUNTORED_API_KEY is not configured');
    return key;
  }

  private get baseUrl(): string {
    return process.env.PUNTORED_API_URL || 'https://api.puntored.com.co/v1';
  }

  private headers() {
    return {
      Authorization: `ApiKey ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async getQuote(params: RailQuoteParams): Promise<RailQuote> {
    // PuntoRed charges a flat fee per transaction
    const flatFee = 3.5; // USD — fetch dynamically from /fees endpoint in production
    return {
      rail: this.name,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      exchangeRate: 1,
      fee: flatFee,
      estimatedDeliveryMinutes: 15,
    };
  }

  async sendPayment(params: RailPaymentParams): Promise<RailResult> {
    if (!params.recipientName) throw new Error('recipientName is required for PuntoRed');

    logger.info('Initiating PuntoRed cash payout', {
      paymentId: params.paymentId,
      country: params.destinationCountry,
      amount: params.amount,
    });

    const response = await axios.post<PuntoRedTransactionResponse>(
      `${this.baseUrl}/transactions/cash-payout`,
      {
        externalReference: params.paymentId,
        amount: params.amount,
        currency: params.destinationCurrency,
        country: params.destinationCountry,
        beneficiary: { name: params.recipientName },
      },
      { headers: this.headers() },
    );

    const tx = response.data;
    logger.info('PuntoRed payout created', {
      paymentId: params.paymentId,
      code: tx.transactionCode,
      pin: tx.pinCode,
    });

    return {
      success: true,
      providerReference: tx.transactionCode,
      pinCode: tx.pinCode,
      status: 'pending',
      estimatedCompletionAt: new Date(tx.expiresAt),
    };
  }
}
