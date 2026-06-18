import {
  Horizon,
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
} from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';
import axios from 'axios';

const logger = createLogger('StellarService');

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

export interface StellarAccount {
  publicKey: string;
  secretKey: string;
}

export async function createKeypair(): Promise<StellarAccount> {
  const pair = Keypair.random();
  return {
    publicKey: pair.publicKey(),
    secretKey: pair.secret(),
  };
}

export async function fundWithFriendbot(publicKey: string): Promise<void> {
  try {
    logger.info(`Funding account ${publicKey} via Friendbot...`);
    await axios.get(`https://friendbot.stellar.org?addr=${publicKey}`);
    logger.info(`Account ${publicKey} funded successfully.`);
  } catch (error) {
    logger.error('Friendbot funding failed', { error: String(error) });
    throw new Error('Failed to fund account via Friendbot');
  }
}

export async function getAccountBalance(publicKey: string): Promise<any[]> {
  try {
    const account = await server.loadAccount(publicKey);
    return account.balances;
  } catch (error) {
    logger.error('Failed to load account', { publicKey, error: String(error) });
    throw new Error('Account not found on Stellar network');
  }
}

export async function sendPayment(
  sourceSecret: string,
  destinationPublic: string,
  amount: string,
  assetCode: string = 'XLM',
  assetIssuer?: string
): Promise<string> {
  try {
    const sourceKeypair = Keypair.fromSecret(sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();

    logger.info(`Preparing payment from ${sourcePublicKey} to ${destinationPublic}...`);

    const account = await server.loadAccount(sourcePublicKey);
    const fee = await server.fetchBaseFee();

    const asset = assetCode === 'XLM' 
      ? Asset.native() 
      : new Asset(assetCode, assetIssuer!);

    const transaction = new TransactionBuilder(account, {
      fee: fee.toString(),
      networkPassphrase: Networks.TESTNET, // Defaulting to testnet for now
    })
      .addOperation(
        Operation.payment({
          destination: destinationPublic,
          asset,
          amount,
        })
      )
      .setTimeout(30)
      .build();

    transaction.sign(sourceKeypair);

    const result = await server.submitTransaction(transaction);
    logger.info('Payment successful', { hash: result.hash });
    return result.hash;
  } catch (error: any) {
    const detail = error.response?.data?.extras?.result_codes || error.message;
    logger.error('Payment failed', { error: detail });
    throw new Error(`Stellar payment failed: ${JSON.stringify(detail)}`);
  }
}
