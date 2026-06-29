/**
 * Stellar Service - Complete Production-Ready Implementation
 * Handles account management, transaction building, signing, and submission
 * Follows official Stellar SDK documentation exactly
 */

import {
  Keypair,
  TransactionBuilder,
  Asset,
  Operation,
  Memo,
  Networks,
  Transaction,
  FeeBumpTransaction,
  Horizon,
  Account,
} from '@stellar/stellar-sdk';

const Server = Horizon.Server;
import axios from 'axios';
import { createLogger } from '@funti3r/shared-utils';
import {
  STELLAR_NETWORK,
  HORIZON_BASE_URL,
  FRIENDBOT_URL,
  TX_TIMEOUT_SECONDS,
  NATIVE_ASSET,
  STELLAR_USDC_ISSUER,
  MINIMUM_BALANCE_XLM,
} from './constants.js';
import { validatePublicKey, validateSecretKey, validatePaymentParams, validateAmount } from './utils/validation.js';
import { formatBalance, shortenKey } from './utils/formatting.js';
import type {
  KeypairData,
  AccountInfo,
  PaymentParams,
  PaymentResult,
  TransactionData,
  StreamingTransaction,
  AirdropResult,
} from './types.js';

const logger = createLogger('StellarService');

// Singleton server instance
let horizonServer: Server | null = null;

/**
 * Get or create Horizon server instance
 * Reuses connection instead of creating new ones
 *
 * @returns Horizon Server instance
 */
export function getHorizonServer(): Server {
  if (!horizonServer) {
    logger.info('Creating Horizon server connection', { url: HORIZON_BASE_URL });
    horizonServer = new Server(HORIZON_BASE_URL);
  }
  return horizonServer;
}

/**
 * Generate a new random keypair
 * Uses cryptographically secure random generation
 *
 * @returns KeypairData with publicKey and secretKey
 *
 * @example
 * const keypair = generateKeypair();
 * console.log(keypair.publicKey); // GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47
 */
export function generateKeypair(): KeypairData {
  logger.info('Generating new keypair');
  const keypair = Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
}

/**
 * Fund a new testnet account via Friendbot airdrop
 * Verifies account creation and loads sequence number
 *
 * @param publicKey - Public key to fund
 * @throws Error if airdrop fails or account cannot be verified
 * @returns AirdropResult with success status
 *
 * @example
 * const result = await fundAccountWithAirdrop('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47');
 * console.log(result.accountCreated); // true
 */
export async function fundAccountWithAirdrop(publicKey: string): Promise<AirdropResult> {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  logger.info('Funding account via Friendbot airdrop', { publicKey: shortenKey(publicKey) });

  try {
    // Request airdrop from Friendbot
    const airdropUrl = `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;
    const response = await axios.get(airdropUrl);

    logger.info('Friendbot airdrop successful', { publicKey: shortenKey(publicKey) });

    // Verify account was created by loading it
    const account = await getHorizonServer().loadAccount(publicKey);
    logger.info('Account verified after airdrop', {
      publicKey: shortenKey(publicKey),
      sequenceNumber: account.sequenceNumber,
      balances: account.balances.length,
    });

    return {
      success: true,
      accountCreated: true,
      message: `Account ${shortenKey(publicKey)} funded and verified`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Friendbot airdrop failed', { publicKey: shortenKey(publicKey), error: errorMsg });
    throw new Error(`Failed to fund account via airdrop: ${errorMsg}`);
  }
}

/**
 * Load account information from network
 * CRITICAL: Must load fresh account before each transaction (sequence number changes)
 *
 * @param publicKey - Public key of account to load
 * @throws Error if account doesn't exist or network unavailable
 * @returns AccountInfo with current state
 *
 * @example
 * const account = await loadAccount('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47');
 * console.log(account.sequenceNumber); // Current sequence number from network
 */
export async function loadAccount(publicKey: string): Promise<AccountInfo> {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  try {
    logger.info('Loading account from network', { publicKey: shortenKey(publicKey) });
    const account = await getHorizonServer().loadAccount(publicKey);

    const accountInfo: AccountInfo = {
      id: account.id,
      publicKey: account.accountId(),
      sequenceNumber: account.sequenceNumber,
      balances: account.balances,
      exists: true,
    };

    logger.info('Account loaded successfully', {
      publicKey: shortenKey(publicKey),
      sequenceNumber: account.sequenceNumber,
      balances: account.balances.length,
    });

    return accountInfo;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('404')) {
      logger.warn('Account not found on network', { publicKey: shortenKey(publicKey) });
      return {
        id: publicKey,
        publicKey,
        sequenceNumber: '0',
        balances: [],
        exists: false,
      };
    }

    logger.error('Failed to load account', { publicKey: shortenKey(publicKey), error: errorMsg });
    throw new Error(`Failed to load account: ${errorMsg}`);
  }
}

/**
 * Fetch current base fee from network
 * Uses the recommended fee instead of hardcoding
 *
 * @throws Error if network unavailable
 * @returns Base fee in stroops
 *
 * @example
 * const baseFee = await getBaseFee();
 * console.log(baseFee); // '100' (stroops)
 */
export async function getBaseFee(): Promise<string> {
  try {
    logger.debug('Fetching base fee from network');
    const baseFee = await getHorizonServer().fetchBaseFee();
    logger.debug('Base fee fetched', { baseFee: String(baseFee) });
    return String(baseFee);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch base fee, using default', { error: errorMsg });
    // Fallback to standard fee if network unavailable
    return '100';
  }
}

/**
 * Send a payment from one account to another
 * Complete end-to-end flow: load account, build tx, sign, submit
 *
 * @param params - Payment parameters
 * @throws Error if payment fails at any stage
 * @returns PaymentResult with transaction hash and link
 *
 * @example
 * const result = await sendPayment({
 *   fromKeypair: { publicKey: 'G...', secretKey: 'S...' },
 *   toPublicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47',
 *   amount: '100.50',
 *   memo: { type: 'text', value: 'Payment for services' }
 * });
 * console.log(result.transactionHash); // Transaction ID
 * console.log(result.transactionLink); // Horizon link
 */
export async function sendPayment(params: PaymentParams): Promise<PaymentResult> {
  const { fromKeypair, toPublicKey, amount, memo, assetCode = NATIVE_ASSET, assetIssuer } = params;

  logger.info('Sending payment', {
    from: shortenKey(fromKeypair.publicKey),
    to: shortenKey(toPublicKey),
    amount,
    assetCode,
  });

  try {
    // Validate all parameters
    validatePaymentParams(fromKeypair.publicKey, toPublicKey, amount);

    if (assetCode !== NATIVE_ASSET) {
      if (!assetIssuer || !validatePublicKey(assetIssuer)) {
        throw new Error('Asset issuer required and must be valid for non-native assets');
      }
    }

    // Step 1: Load sender account (FRESH - sequence number changes)
    logger.debug('Loading sender account for fresh sequence number');
    const senderAccount = await loadAccount(fromKeypair.publicKey);

    if (!senderAccount.exists) {
      throw new Error('Sender account does not exist on network');
    }

    // Step 2: Fetch current base fee
    const baseFee = await getBaseFee();
    logger.debug('Using base fee', { baseFee });

    // Step 3: Create keypair from secret key
    const keypair = Keypair.fromSecret(fromKeypair.secretKey);

    // Step 4: Build transaction
    logger.debug('Building transaction');
    const horizonAccount = await getHorizonServer().loadAccount(fromKeypair.publicKey);

    // Convert Horizon response to Account object that TransactionBuilder expects
    const account = new Account(fromKeypair.publicKey, horizonAccount.sequence);

    const builder = new TransactionBuilder(account, {
      fee: baseFee,
      networkPassphrase: STELLAR_NETWORK.passphrase,
    });

    // Add memo if provided
    if (memo) {
      switch (memo.type) {
        case 'text':
          builder.addMemo(Memo.text(memo.value.substring(0, 28))); // Max 28 bytes
          break;
        case 'id':
          builder.addMemo(Memo.id(memo.value));
          break;
        case 'hash':
          builder.addMemo(Memo.hash(Buffer.from(memo.value, 'hex')));
          break;
        case 'return':
          builder.addMemo(Memo.return(memo.value));
          break;
      }
    }

    // Add payment operation
    const asset =
      assetCode === NATIVE_ASSET
        ? Asset.native()
        : new Asset(assetCode, assetIssuer);

    builder.addOperation(
      Operation.payment({
        destination: toPublicKey,
        asset,
        amount,
      })
    );

    // Set timeout and build
    const transaction = builder.setTimeout(TX_TIMEOUT_SECONDS).build();

    logger.debug('Transaction built', {
      from: shortenKey(fromKeypair.publicKey),
      operations: 1,
      fee: baseFee,
    });

    // Step 5: Sign transaction
    logger.debug('Signing transaction');
    transaction.sign(keypair);

    // Step 6: Submit to network
    logger.info('Submitting transaction to network');
    const result = await getHorizonServer().submitTransaction(transaction);

    logger.info('Payment successful', {
      transactionHash: result.id,
      from: shortenKey(fromKeypair.publicKey),
      to: shortenKey(toPublicKey),
      amount,
    });

    return {
      transactionHash: result.id,
      transactionLink: result._links.transaction.href,
      status: 'success',
      timestamp: new Date().toISOString(),
      amount,
      destination: toPublicKey,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Payment failed', {
      from: shortenKey(fromKeypair.publicKey),
      to: shortenKey(toPublicKey),
      error: errorMsg,
    });
    throw error;
  }
}

/**
 * Get account balance for a specific asset
 *
 * @param publicKey - Account public key
 * @param assetCode - Asset code (default: 'XLM' for native)
 * @param assetIssuer - Asset issuer (required for non-native assets)
 * @throws Error if account not found
 * @returns Balance as string
 *
 * @example
 * const balance = await getBalance('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47', 'XLM');
 * console.log(balance); // '1000.5000000'
 */
export async function getBalance(
  publicKey: string,
  assetCode: string = NATIVE_ASSET,
  assetIssuer?: string
): Promise<string> {
  try {
    const account = await loadAccount(publicKey);

    if (!account.exists) {
      return '0';
    }

    const balance = account.balances.find((b) => {
      if (assetCode === NATIVE_ASSET) {
        return b.asset_type === 'native';
      }
      return b.asset_code === assetCode && b.asset_issuer === assetIssuer;
    });

    const amount = balance ? balance.balance : '0';
    logger.debug('Balance retrieved', {
      publicKey: shortenKey(publicKey),
      assetCode,
      balance: amount,
    });

    return amount;
  } catch (error) {
    logger.error('Failed to get balance', {
      publicKey: shortenKey(publicKey),
      error: String(error),
    });
    throw error;
  }
}

/**
 * Stream new transactions for an account in real-time
 * Handles disconnections and reconnection
 *
 * @param publicKey - Account public key
 * @param onTransaction - Callback for new transactions
 * @param onError - Callback for errors
 * @returns Stop function to close the stream
 *
 * @example
 * const stop = await streamAccountTransactions(
 *   publicKey,
 *   (tx) => console.log('New transaction:', tx.id),
 *   (err) => console.error('Stream error:', err)
 * );
 *
 * // Later...
 * stop();
 */
export async function streamAccountTransactions(
  publicKey: string,
  onTransaction: (tx: StreamingTransaction) => void,
  onError: (error: Error) => void
): Promise<() => void> {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  logger.info('Starting transaction stream', { publicKey: shortenKey(publicKey) });

  let es: EventSource | undefined;

  try {
    es = await getHorizonServer()
      .transactions()
      .forAccount(publicKey)
      .stream({
        onmessage: (tx: any) => {
          logger.debug('New transaction received', {
            publicKey: shortenKey(publicKey),
            txHash: tx.id,
          });
          onTransaction({
            id: tx.id,
            hash: tx.hash,
            created_at: tx.created_at,
            source_account: tx.source_account,
            successful: tx.successful,
            operations_count: tx.operations_count,
          });
        },
        onerror: (error: any) => {
          logger.error('Stream error', {
            publicKey: shortenKey(publicKey),
            error: String(error),
          });
          onError(new Error(`Stream error: ${String(error)}`));
        },
      });

    // Return stop function
    return () => {
      logger.info('Stopping transaction stream', { publicKey: shortenKey(publicKey) });
      if (es) {
        es.close();
      }
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start stream', {
      publicKey: shortenKey(publicKey),
      error: errorMsg,
    });
    throw error;
  }
}

/**
 * Get transaction history for an account
 *
 * @param publicKey - Account public key
 * @param limit - Number of transactions to retrieve (default: 10, max: 200)
 * @throws Error if account not found
 * @returns Array of transactions
 *
 * @example
 * const txs = await getTransactionHistory('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47', 20);
 * console.log(txs[0].hash);
 */
export async function getTransactionHistory(
  publicKey: string,
  limit: number = 10
): Promise<TransactionData[]> {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  if (limit < 1 || limit > 200) {
    throw new Error('Limit must be between 1 and 200');
  }

  try {
    logger.info('Fetching transaction history', {
      publicKey: shortenKey(publicKey),
      limit,
    });

    const response = await getHorizonServer()
      .transactions()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .call();

    const transactions = response.records.map((tx: any) => ({
      id: tx.id,
      hash: tx.hash,
      created_at: tx.created_at,
      source_account: tx.source_account,
      successful: tx.successful,
      type_code: tx.type_code,
      operations_count: tx.operations_count,
    }));

    logger.debug('Transaction history retrieved', {
      publicKey: shortenKey(publicKey),
      count: transactions.length,
    });

    return transactions;
  } catch (error) {
    logger.error('Failed to get transaction history', {
      publicKey: shortenKey(publicKey),
      error: String(error),
    });
    throw error;
  }
}

/**
 * Restore keypair from secret key
 * Validates secret key format before restoration
 *
 * @param secretKey - Secret key starting with 'S'
 * @throws Error if secret key format is invalid
 * @returns KeypairData with both public and secret
 *
 * @example
 * const keypair = getKeypairFromSecret('SBXZY...');
 * console.log(keypair.publicKey);
 */
export function getKeypairFromSecret(secretKey: string): KeypairData {
  if (!validateSecretKey(secretKey)) {
    throw new Error(`Invalid secret key format: ${secretKey}`);
  }

  try {
    logger.info('Restoring keypair from secret');
    const keypair = Keypair.fromSecret(secretKey);
    return {
      publicKey: keypair.publicKey(),
      secretKey: secretKey,
    };
  } catch (error) {
    logger.error('Failed to restore keypair from secret', { error: String(error) });
    throw new Error('Failed to restore keypair from secret key');
  }
}

/**
 * Verify if account exists on the network
 * Returns false instead of throwing for non-existent accounts
 *
 * @param publicKey - Account public key
 * @throws Error if network unavailable
 * @returns true if account exists, false otherwise
 *
 * @example
 * const exists = await verifyAccountExists('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47');
 * console.log(exists); // true or false
 */
export async function verifyAccountExists(publicKey: string): Promise<boolean> {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  try {
    const account = await loadAccount(publicKey);
    return account.exists;
  } catch (error) {
    logger.error('Failed to verify account existence', {
      publicKey: shortenKey(publicKey),
      error: String(error),
    });
    throw error;
  }
}

/**
 * Get all balances for an account
 * Returns balances for all assets the account holds
 *
 * @param publicKey - Account public key
 * @throws Error if account doesn't exist
 * @returns Array of balance objects with asset info
 *
 * @example
 * const balances = await getAccountBalances('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47');
 * balances.forEach(b => console.log(b.asset_code || 'XLM', b.balance));
 */
export async function getAccountBalances(publicKey: string) {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  try {
    const account = await loadAccount(publicKey);

    if (!account.exists) {
      throw new Error('Account does not exist on network');
    }

    logger.debug('Account balances retrieved', {
      publicKey: shortenKey(publicKey),
      count: account.balances.length,
    });

    return account.balances;
  } catch (error) {
    logger.error('Failed to get account balances', {
      publicKey: shortenKey(publicKey),
      error: String(error),
    });
    throw error;
  }
}

/**
 * Calculate transaction fee based on operation count
 * Uses current base fee from network
 *
 * @param operationCount - Number of operations in transaction
 * @throws Error if network unavailable
 * @returns Total fee in stroops
 *
 * @example
 * const fee = await calculateTransactionFee(2);
 * console.log(fee); // '200' (2 operations * 100 stroops base fee)
 */
export async function calculateTransactionFee(operationCount: number): Promise<string> {
  if (operationCount < 1) {
    throw new Error('Operation count must be at least 1');
  }

  try {
    const baseFee = await getBaseFee();
    const totalFee = String(parseInt(baseFee) * operationCount);

    logger.debug('Transaction fee calculated', {
      operationCount,
      baseFee,
      totalFee,
    });

    return totalFee;
  } catch (error) {
    logger.error('Failed to calculate transaction fee', { error: String(error) });
    throw error;
  }
}

/**
 * Get payment operations from transaction history
 * Filters transaction history to only payment operations
 *
 * @param publicKey - Account public key
 * @param limit - Number of transactions to check (default: 50)
 * @throws Error if account not found
 * @returns Array of payment operations
 *
 * @example
 * const payments = await getPaymentOperations('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47', 20);
 * console.log(payments);
 */
export async function getPaymentOperations(publicKey: string, limit: number = 50) {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  if (limit < 1 || limit > 200) {
    throw new Error('Limit must be between 1 and 200');
  }

  try {
    logger.info('Fetching payment operations', {
      publicKey: shortenKey(publicKey),
      limit,
    });

    const response = await getHorizonServer()
      .operations()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .call();

    const payments = response.records
      .filter((op: any) => op.type === 'payment' || op.type === 'path_payment_strict_receive')
      .map((op: any) => ({
        id: op.id,
        type: op.type,
        from: op.from,
        to: op.to,
        amount: op.amount,
        asset_type: op.asset_type,
        asset_code: op.asset_code,
        asset_issuer: op.asset_issuer,
        created_at: op.created_at,
        transaction_hash: op.transaction_hash,
      }));

    logger.debug('Payment operations retrieved', {
      publicKey: shortenKey(publicKey),
      count: payments.length,
    });

    return payments;
  } catch (error) {
    logger.error('Failed to get payment operations', {
      publicKey: shortenKey(publicKey),
      error: String(error),
    });
    throw error;
  }
}

/**
 * Filter incoming payments from operations for an account
 * Only includes payments where the account is the recipient
 *
 * @param publicKey - Account public key to filter for
 * @param operations - Array of operations to filter
 * @returns Only incoming payments for the account
 *
 * @example
 * const ops = await getPaymentOperations(myKey, 20);
 * const incoming = filterIncomingPayments(myKey, ops);
 */
export function filterIncomingPayments(publicKey: string, operations: any[]) {
  if (!validatePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey}`);
  }

  logger.debug('Filtering incoming payments', {
    publicKey: shortenKey(publicKey),
    totalOps: operations.length,
  });

  const incoming = operations.filter((op) => op.to === publicKey);

  logger.debug('Incoming payments filtered', {
    publicKey: shortenKey(publicKey),
    incomingCount: incoming.length,
  });

  return incoming;
}

/**
 * Retry a payment operation with exponential backoff
 * Retries up to maxRetries times with increasing delays
 *
 * @param params - Payment parameters
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param initialDelay - Initial delay in milliseconds (default: 1000)
 * @throws Error if all retries fail
 * @returns PaymentResult
 *
 * @example
 * const result = await retryPayment(paymentParams, 5, 2000);
 */
export async function retryPayment(
  params: PaymentParams,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<PaymentResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.info('Attempting payment', {
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        to: shortenKey(params.toPublicKey),
        amount: params.amount,
      });

      return await sendPayment(params);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message;

      // Don't retry on validation errors
      if (errorMsg.includes('Invalid') || errorMsg.includes('Cannot send payment to the same account')) {
        throw lastError;
      }

      // Don't retry on insufficient balance
      if (errorMsg.includes('insufficient')) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delayMs = initialDelay * Math.pow(2, attempt);
        logger.warn('Payment attempt failed, retrying', {
          attempt: attempt + 1,
          error: errorMsg,
          nextRetryIn: delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  logger.error('Payment failed after all retries', {
    maxRetries,
    lastError: lastError?.message,
  });

  throw new Error(`Payment failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Send payments to multiple recipients in sequence
 * Retries individual payments if they fail
 *
 * @param senderKeypair - Sender's keypair
 * @param recipients - Array of {publicKey, amount}
 * @returns Array of results with success/failure status
 *
 * @example
 * const results = await sendPaymentBatch(keypair, [
 *   { publicKey: 'G...', amount: '10' },
 *   { publicKey: 'G...', amount: '20' }
 * ]);
 */
export async function sendPaymentBatch(
  senderKeypair: KeypairData,
  recipients: Array<{ publicKey: string; amount: string }>
) {
  logger.info('Starting batch payment', {
    sender: shortenKey(senderKeypair.publicKey),
    recipientCount: recipients.length,
  });

  const results = [];

  for (const recipient of recipients) {
    try {
      const result = await retryPayment(
        {
          fromKeypair: senderKeypair,
          toPublicKey: recipient.publicKey,
          amount: recipient.amount,
        },
        3,
        1000
      );

      results.push({
        recipient: recipient.publicKey,
        amount: recipient.amount,
        success: true,
        transactionHash: result.transactionHash,
      });

      // Small delay between payments to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        recipient: recipient.publicKey,
        amount: recipient.amount,
        success: false,
        error: errorMsg,
      });

      logger.error('Batch payment to recipient failed', {
        recipient: shortenKey(recipient.publicKey),
        error: errorMsg,
      });
    }
  }

  logger.info('Batch payment completed', {
    total: recipients.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
  });

  return results;
}
