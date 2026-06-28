/**
 * Stellar XLM / USDC on-chain rail.
 *
 * For testnet this uses XLM (the native asset) funded via Friendbot.
 * The worker's destination is their Soroban SmartWallet contract address.
 * In production, switch STELLAR_SETTLEMENT_ASSET to USDC and configure
 * STELLAR_USDC_ISSUER.
 */
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams, RailResult } from './types.js';
import { sendPayment } from '../lib/stellar.js';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Rail:Stellar');

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

  async sendPayment(params: RailPaymentParams): Promise<RailResult> {
    const destination = params.stellarContractAddress;
    if (!destination) {
      throw new Error('stellarContractAddress is required for Stellar rail');
    }

    const sourceSecret = params.metadata?.sourceSecret;
    if (!sourceSecret) {
      throw new Error('sourceSecret is required in metadata for Stellar rail');
    }

    const asset = process.env.STELLAR_SETTLEMENT_ASSET ?? 'XLM';
    const issuer = asset === 'XLM' ? undefined : process.env.STELLAR_USDC_ISSUER;

    logger.info('Sending Stellar payment', {
      paymentId: params.paymentId,
      destination,
      amount: params.amount,
      asset,
    });

    const txHash = await sendPayment(
      sourceSecret,
      destination,
      String(params.amount),
      asset,
      issuer,
    );

    return {
      success: true,
      providerReference: txHash,
      stellarTxHash: txHash,
      status: 'completed',
    };
  }
}
