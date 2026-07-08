import { Keypair, TransactionBuilder, hash, xdr, Transaction } from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';
import { getNetworkPassphrase } from './wallet-kit-integration.js';

const logger = createLogger('WalletVerification');

/**
 * Verify a signed Stellar transaction for wallet linking
 * The transaction should contain the challenge as a text memo
 */
export function verifyWalletSignature(
  signedXdr: string,
  publicKeyString: string,
  expectedChallenge: string,
): { isValid: boolean; error?: string } {
  try {
    logger.info('Starting wallet signature verification', {
      publicKey: publicKeyString.substring(0, 10) + '...',
    });

    // Parse the signed XDR
    const txEnvelope = xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64');
    const v1Envelope = txEnvelope.v1();

    if (!v1Envelope) {
      return { isValid: false, error: 'Invalid transaction envelope' };
    }

    const txXdr = v1Envelope.tx();
    if (!txXdr) {
      return { isValid: false, error: 'Failed to extract transaction' };
    }

    // Extract and verify memo
    const memoXdr = txXdr.memo();
    if (!memoXdr) {
      return { isValid: false, error: 'Transaction has no memo' };
    }

    const memoSwitch = memoXdr.switch();
    if (memoSwitch.value !== 1) {
      // 1 = memoText
      return { isValid: false, error: 'Memo is not text type' };
    }

    const memoBuffer = memoXdr.text();
    if (!memoBuffer) {
      return { isValid: false, error: 'Failed to extract memo text' };
    }

    const memoText = memoBuffer.toString();
    const expectedMemo = expectedChallenge.substring(0, 28);

    if (memoText !== expectedMemo) {
      logger.error('Memo verification failed', {
        expected: expectedMemo,
        actual: memoText,
      });
      return { isValid: false, error: 'Challenge mismatch: invalid memo' };
    }

    logger.info('Memo verified successfully');

    // Verify transaction structure (should have at least bump sequence operation)
    const operations = txXdr.operations();
    if (operations.length === 0) {
      return { isValid: false, error: 'Transaction has no operations' };
    }

    const hasBumpSequence = operations.some((op) => {
      // Operation type 11 is BUMP_SEQUENCE
      return op.body().switch().value === 11;
    });

    if (!hasBumpSequence) {
      return { isValid: false, error: 'Transaction missing bump sequence operation' };
    }

    logger.info('Transaction structure verified');

    // Verify network passphrase
    // Note: The network passphrase is not stored in XDR, but we use it for signature verification
    const expectedPassphrase = getNetworkPassphrase();

    // Compute transaction hash using the network passphrase (same way it was signed)
    // Create a Transaction object from the full envelope with the correct network passphrase
    let txHashBuffer: Buffer;
    try {
      const txFromEnvelope = new Transaction(txEnvelope, expectedPassphrase);
      txHashBuffer = txFromEnvelope.hash();
    } catch (hashErr) {
      logger.error('Failed to compute transaction hash', { error: String(hashErr) });
      return { isValid: false, error: `Hash computation failed: ${String(hashErr)}` };
    }

    logger.info('Transaction hash computed', {
      hashLength: txHashBuffer.length,
    });

    // Extract signatures from envelope
    const signatures = v1Envelope.signatures();
    logger.info('Signatures found', { count: signatures.length });

    if (signatures.length === 0) {
      return { isValid: false, error: 'Transaction has no signatures' };
    }

    // Verify signature with public key
    const keypair = Keypair.fromPublicKey(publicKeyString);

    logger.info('Verifying signatures', {
      publicKey: publicKeyString,
      transactionHashHex: txHashBuffer.toString('hex'),
    });

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      const signatureBuffer = sig.signature();
      const isValid = keypair.verify(txHashBuffer, signatureBuffer);

      logger.info('Signature verification', {
        signatureIndex: i,
        isValid,
        signatureHex: signatureBuffer.toString('hex'),
        signatureLength: signatureBuffer.length,
      });

      if (isValid) {
        logger.info('Wallet signature verification successful');
        return { isValid: true };
      }
    }

    return { isValid: false, error: 'No valid signatures found' };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Wallet signature verification error', { error: errorMsg });
    return { isValid: false, error: `Verification failed: ${errorMsg}` };
  }
}
