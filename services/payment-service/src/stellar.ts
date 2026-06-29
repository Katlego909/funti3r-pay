import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Horizon,
  Memo,
  xdr,
} from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('StellarService');

// Use testnet for development
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK || Networks.TESTNET;

let horizonServer: Horizon.Server | null = null;

function getServer(): Horizon.Server {
  if (!horizonServer) {
    logger.info('[Stellar] Initializing Horizon server', { url: HORIZON_URL });
    horizonServer = new Horizon.Server(HORIZON_URL);
  }
  return horizonServer;
}

export interface StellarPayment {
  sourceSecret: string;
  destinationAddress: string;
  amount: string;
  currency: string;
  memo?: string;
}

export interface StellarTransaction {
  txHash: string;
  xdr: string;
  status: 'pending' | 'confirmed' | 'failed';
  ledger?: number;
}

export interface StellarTransactionEnvelope {
  transaction: any;
  xdr: string;
}

/**
 * Build a Stellar payment transaction
 * Following official Stellar SDK documentation
 */
export async function buildPaymentTransaction(payment: StellarPayment): Promise<StellarTransactionEnvelope> {
  try {
    logger.info('[Stellar] Building payment transaction', {
      destination: payment.destinationAddress,
      amount: payment.amount,
      currency: payment.currency,
      memo: payment.memo,
    });

    const server = getServer();

    // Get source account
    const sourceKeypair = Keypair.fromSecret(payment.sourceSecret);
    const sourceAddress = sourceKeypair.publicKey();

    logger.info('[Stellar] Loading source account', { address: sourceAddress });
    const sourceAccount = await server.loadAccount(sourceAddress);
    logger.info('[Stellar] Source account loaded', {
      sequence: sourceAccount.sequenceNumber(),
      balances: sourceAccount.balances.length,
    });

    // Fetch current base fee from network
    logger.info('[Stellar] Fetching base fee from network');
    const baseFee = await server.fetchBaseFee();
    logger.info('[Stellar] Base fee fetched', { baseFee });

    // Verify destination account exists
    logger.info('[Stellar] Verifying destination account', { address: payment.destinationAddress });
    try {
      const destAccount = await server.loadAccount(payment.destinationAddress);
      logger.info('[Stellar] Destination account exists', {
        sequence: destAccount.sequenceNumber(),
        balances: destAccount.balances.length,
      });
    } catch (err) {
      logger.warn('[Stellar] Destination account does not exist (will be created via payment)', {
        address: payment.destinationAddress,
      });
    }

    // Build transaction following official pattern
    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: String(baseFee),
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // Add payment operation
    if (payment.currency === 'XLM') {
      logger.info('[Stellar] Adding native XLM payment operation', {
        amount: payment.amount,
      });
      txBuilder.addOperation(
        Operation.payment({
          destination: payment.destinationAddress,
          asset: Asset.native(),
          amount: payment.amount,
        })
      );
    } else {
      logger.error('[Stellar] Non-XLM payments not yet supported', {
        currency: payment.currency,
      });
      throw new Error(`Currency ${payment.currency} not supported yet`);
    }

    // Add memo if provided
    if (payment.memo) {
      logger.info('[Stellar] Adding text memo', { memoLength: payment.memo.length });
      txBuilder.addMemo(Memo.text(payment.memo));
    }

    // Set timeout and build (30 seconds = standard timeout)
    txBuilder.setTimeout(30);

    const transaction = txBuilder.build();
    logger.info('[Stellar] Transaction built successfully', {
      operations: transaction.operations.length,
      fee: transaction.fee,
    });

    // Sign with source keypair
    transaction.sign(sourceKeypair);
    logger.info('[Stellar] Transaction signed');

    // Get XDR (standard envelope encoding)
    const xdr = transaction.toEnvelope().toXDR('base64');
    logger.info('[Stellar] Transaction XDR generated', {
      xdrLength: xdr.length,
    });

    return { transaction, xdr };
  } catch (err) {
    logger.error('[Stellar] Failed to build transaction', {
      error: String(err),
      destination: payment.destinationAddress,
      amount: payment.amount,
    });
    throw err;
  }
}

/**
 * Submit a signed transaction to Stellar network
 * Following official SDK documentation
 */
export async function submitTransaction(envelope: StellarTransactionEnvelope | string): Promise<StellarTransaction> {
  try {
    const server = getServer();
    let transaction: any;
    let xdr: string;

    // Handle both StellarTransactionEnvelope objects and XDR strings
    if (typeof envelope === 'string') {
      logger.info('[Stellar] Submitting transaction from XDR string', { xdrLength: envelope.length });
      xdr = envelope;
      // The server.submitTransaction expects a built Transaction object, but we have an XDR
      // We'll submit the XDR string directly to the API
      const result = await (server as any).submitTransaction(xdr);
      logger.info('[Stellar] Transaction submitted successfully', {
        txHash: result.hash,
        ledger: result.ledger,
      });
      return {
        txHash: result.hash,
        xdr,
        status: 'pending',
        ledger: result.ledger,
      };
    } else {
      logger.info('[Stellar] Submitting transaction from envelope', { xdrLength: envelope.xdr.length });
      xdr = envelope.xdr;
      transaction = envelope.transaction;
      // Submit the transaction (server expects Transaction object)
      logger.info('[Stellar] Submitting to Horizon server...');
      const result = await server.submitTransaction(transaction);
      logger.info('[Stellar] Transaction submitted successfully', {
        txHash: result.hash,
        ledger: result.ledger,
      });
      return {
        txHash: result.hash,
        xdr,
        status: 'pending',
        ledger: result.ledger,
      };
    }
  } catch (err: any) {
    // Log detailed error information
    if (err.response?.data?.result_xdr) {
      logger.error('[Stellar] Transaction submission failed', {
        resultCode: err.response.data.result_code,
        resultXdr: err.response.data.result_xdr.substring(0, 100),
      });
    } else if (err.response?.status) {
      logger.error('[Stellar] Horizon server error', {
        status: err.response.status,
        statusText: err.response.statusText,
      });
    } else {
      logger.error('[Stellar] Transaction submission failed', {
        error: String(err),
      });
    }
    throw err;
  }
}

/**
 * Check transaction status on Stellar network
 */
export async function getTransactionStatus(txHash: string): Promise<{
  status: 'pending' | 'confirmed' | 'failed';
  ledger?: number;
  timestamp?: string;
  resultCode?: string;
}> {
  try {
    logger.info('[Stellar] Checking transaction status', { txHash });

    const server = getServer();
    const transaction = await server.transactions().transaction(txHash).call();

    logger.info('[Stellar] Transaction status retrieved', {
      txHash,
      ledger: (transaction as any).ledger,
      successful: (transaction as any).successful,
    });

    // Check if transaction was successful
    const successful = (transaction as any).successful;
    const status = successful ? 'confirmed' : 'failed';

    return {
      status,
      ledger: (transaction as any).ledger,
      timestamp: (transaction as any).created_at,
    };
  } catch (err: any) {
    if (err.status === 404) {
      logger.info('[Stellar] Transaction not yet confirmed (404 from Horizon)', { txHash });
      return { status: 'pending' };
    }

    logger.error('[Stellar] Failed to check transaction status', {
      txHash,
      error: String(err),
      status: err.status,
    });
    return { status: 'failed' };
  }
}

/**
 * Get account balances
 */
export async function getAccountBalance(publicKey: string): Promise<Array<{
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}>> {
  try {
    logger.info('[Stellar] Fetching account balance', { publicKey });

    const server = getServer();
    const account = await server.loadAccount(publicKey);

    logger.info('[Stellar] Account loaded successfully', {
      publicKey,
      sequence: account.sequenceNumber(),
      balanceCount: account.balances.length,
    });

    // Find XLM balance
    const xlmBalance = account.balances.find((b: any) => b.asset_type === 'native');
    logger.info('[Stellar] XLM balance', {
      publicKey,
      xlmBalance: xlmBalance?.balance || '0',
    });

    return account.balances;
  } catch (err: any) {
    if (err.status === 404) {
      logger.warn('[Stellar] Account not found on network (not yet funded)', { publicKey });
      return [];
    }

    logger.error('[Stellar] Failed to fetch account balance', {
      publicKey,
      error: String(err),
    });
    throw err;
  }
}

/**
 * Test Stellar network connectivity
 */
export async function testConnection(): Promise<boolean> {
  try {
    logger.info('[Stellar] Testing connection to Stellar network', { url: HORIZON_URL });

    const server = getServer();

    // Call root endpoint to verify connectivity
    const root = await server.root();

    logger.info('[Stellar] Connected to Stellar network', {
      horizonVersion: root.horizon_version,
    });

    return true;
  } catch (err) {
    logger.error('[Stellar] Failed to connect to Stellar network', {
      url: HORIZON_URL,
      error: String(err),
    });
    return false;
  }
}

/**
 * Validate a Stellar public key
 */
export function validatePublicKey(publicKey: string): boolean {
  try {
    Keypair.fromPublicKey(publicKey);
    logger.debug('[Stellar] Public key validated', { publicKey: publicKey.substring(0, 10) + '...' });
    return true;
  } catch (err) {
    logger.warn('[Stellar] Invalid public key', { error: String(err) });
    return false;
  }
}

/**
 * Validate a secret key
 */
export function validateSecretKey(secretKey: string): boolean {
  try {
    Keypair.fromSecret(secretKey);
    logger.debug('[Stellar] Secret key validated');
    return true;
  } catch (err) {
    logger.warn('[Stellar] Invalid secret key', { error: String(err) });
    return false;
  }
}
