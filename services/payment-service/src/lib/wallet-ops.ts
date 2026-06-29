import { Keypair, Horizon } from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('WalletOps');

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const OPERATOR_SECRET = process.env.STELLAR_OPERATOR_SECRET || '';

const horizonServer = new Horizon.Server(HORIZON_URL);

/**
 * Deploy SmartWallet contract to Soroban
 * For now, returns a mock contract address
 * TODO: Implement actual Soroban contract upload
 */
export async function deploySmartWallet(passkeyPkHex: string): Promise<string> {
  logger.info('Deploying SmartWallet', { passkeyPkHex: passkeyPkHex.substring(0, 8) + '...' });

  try {
    // WASM would be loaded from: path.join(import.meta.url, '../../../contracts/build/smartwallet.wasm')
    // For now, return a mock Stellar contract address format
    // Real implementation will upload WASM to Soroban RPC

    const contractAddress = 'C' + Array(56).fill('0').map(() =>
      Math.random().toString(16).charAt(2)
    ).join('').substring(0, 56);

    logger.info('SmartWallet deployed', { contractAddress });
    return contractAddress;
  } catch (err) {
    logger.error('SmartWallet deployment failed', { error: String(err) });
    throw err;
  }
}

/**
 * Initialize SmartWallet contract with worker's passkey
 * TODO: Implement actual Soroban contract initialization
 */
export async function initializeSmartWallet(
  contractAddress: string,
  passkeyPkHex: string
): Promise<void> {
  logger.info('Initializing SmartWallet', { contractAddress });

  try {
    // TODO: Call contract's init() function via Soroban RPC
    // This will store the passkey public key in the contract
    logger.info('SmartWallet initialized', { contractAddress });
  } catch (err) {
    logger.error('SmartWallet initialization failed', { error: String(err) });
    throw err;
  }
}

/**
 * Fund a Stellar account on testnet using Friendbot
 */
export async function fundAccountTestnet(publicKey: string): Promise<void> {
  if (process.env.STELLAR_NETWORK !== 'TESTNET') {
    throw new Error('Friendbot funding only available on testnet');
  }

  try {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
    );

    if (!response.ok) {
      throw new Error(`Friendbot returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    logger.info('Account funded on testnet', { publicKey, hash: (data as any).hash });
  } catch (err) {
    logger.error('Friendbot funding failed', { error: String(err) });
    throw err;
  }
}

/**
 * Get account info and balances from Horizon
 */
export async function getAccountInfo(publicKey: string) {
  try {
    const account = await horizonServer.accounts().accountId(publicKey).call();

    return {
      id: account.id,
      balances: account.balances,
      sequenceNumber: account.sequence,
      subentryCount: account.subentry_count
    };
  } catch (err) {
    logger.error('Failed to fetch account info', { publicKey, error: String(err) });
    throw err;
  }
}

/**
 * Create enterprise keypair (Stellar)
 */
export async function createEnterpriseKeypair(): Promise<{ publicKey: string; secretKey: string }> {
  try {
    const keypair = Keypair.random();

    return {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret()
    };
  } catch (err) {
    logger.error('Keypair creation failed', { error: String(err) });
    throw err;
  }
}
