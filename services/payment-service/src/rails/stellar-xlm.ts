/**
 * Stellar XLM / USDC on-chain rail.
 *
 * For testnet this uses XLM (the native asset) funded via Friendbot.
 * In production, switch STELLAR_SETTLEMENT_ASSET to USDC and configure
 * STELLAR_USDC_ISSUER.
 */
import crypto from 'crypto';
import type { IPaymentRail, RailPaymentParams, RailQuote, RailQuoteParams, RailResult } from './types.js';
import { sendPayment, pathPaymentStrictSend } from '../lib/stellar.js';
import { createLogger } from '@funti3r/shared-utils';
import { Asset } from '@stellar/stellar-sdk';

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
    const destination = params.recipientAccount;
    if (!destination) {
      throw new Error('recipientAccount is required for Stellar rail');
    }

    const sourceSecret = params.metadata?.sourceSecret;
    if (!sourceSecret) {
      throw new Error('sourceSecret is required in metadata for Stellar rail');
    }

    const settlementAsset = process.env.STELLAR_SETTLEMENT_ASSET ?? 'XLM';
    const memoHash = crypto.createHash('sha256').update(params.paymentId).digest();

    logger.info('Sending Stellar payment', {
      paymentId: params.paymentId,
      destination,
      amount: params.amount,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      settlementAsset,
    });

    let txHash: string;

    // If source and destination currencies differ, use path payment
    if (params.sourceCurrency !== params.destinationCurrency) {
      const sendAsset = params.sourceCurrency === 'XLM'
        ? Asset.native()
        : new Asset(params.sourceCurrency, process.env.STELLAR_USDC_ISSUER);

      const destAsset = params.destinationCurrency === 'XLM'
        ? Asset.native()
        : new Asset(params.destinationCurrency, process.env.STELLAR_USDC_ISSUER);

      txHash = await pathPaymentStrictSend(
        sourceSecret,
        destination,
        sendAsset,
        String(params.amount),
        destAsset,
        0.02,
        memoHash,
      );
    } else {
      // Same currency, direct payment
      const issuer = settlementAsset === 'XLM' ? undefined : process.env.STELLAR_USDC_ISSUER;
      txHash = await sendPayment(
        sourceSecret,
        destination,
        String(params.amount),
        settlementAsset,
        issuer,
        memoHash,
      );
    }

    return {
      success: true,
      providerReference: txHash,
      stellarTxHash: txHash,
      status: 'completed',
    };
  }
}
