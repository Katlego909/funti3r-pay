/**
 * Stellar Service - End-to-End Integration Tests
 * Tests real testnet transactions and account operations
 * Run with: pnpm --filter @funti3r/payment-service test -- stellar.test.ts
 *
 * IMPORTANT: These tests interact with live testnet. They may fail temporarily
 * if Friendbot is rate-limited or Horizon is slow. Retry if needed.
 */

import {
  generateKeypair,
  fundAccountWithAirdrop,
  loadAccount,
  getBaseFee,
  sendPayment,
  getBalance,
  getTransactionHistory,
} from './service.js';
import { validatePublicKey, validateSecretKey } from './utils/validation.js';

describe('Stellar Service - End-to-End Tests', () => {
  // Skip these tests in CI or when running quickly
  // Run with: STELLAR_E2E=true pnpm test -- stellar.test.ts
  const skipE2E = process.env.STELLAR_E2E !== 'true';

  describe('Keypair Generation', () => {
    it('should generate valid keypair', () => {
      const keypair = generateKeypair();

      expect(keypair.publicKey).toBeDefined();
      expect(keypair.secretKey).toBeDefined();
      expect(validatePublicKey(keypair.publicKey)).toBe(true);
      expect(validateSecretKey(keypair.secretKey)).toBe(true);
      expect(keypair.publicKey.startsWith('G')).toBe(true);
      expect(keypair.secretKey.startsWith('S')).toBe(true);
    });

    it('should generate unique keypairs', () => {
      const kp1 = generateKeypair();
      const kp2 = generateKeypair();

      expect(kp1.publicKey).not.toEqual(kp2.publicKey);
      expect(kp1.secretKey).not.toEqual(kp2.secretKey);
    });
  });

  describe('Account Management', skipE2E ? undefined : () => {
    let testKeypair: { publicKey: string; secretKey: string };

    beforeAll(async () => {
      testKeypair = generateKeypair();
      console.log(`Testing with account: ${testKeypair.publicKey}`);
    });

    it('should fund account via Friendbot', async () => {
      const result = await fundAccountWithAirdrop(testKeypair.publicKey);

      expect(result.success).toBe(true);
      expect(result.accountCreated).toBe(true);
      expect(result.message).toContain(testKeypair.publicKey.substring(0, 6));
    }, 30000); // 30 second timeout for Friendbot

    it('should load account after funding', async () => {
      const account = await loadAccount(testKeypair.publicKey);

      expect(account.exists).toBe(true);
      expect(account.publicKey).toEqual(testKeypair.publicKey);
      expect(account.sequenceNumber).toBeDefined();
      expect(account.balances.length).toBeGreaterThan(0);
    });

    it('should have XLM balance after airdrop', async () => {
      const balance = await getBalance(testKeypair.publicKey, 'XLM');

      expect(parseFloat(balance)).toBeGreaterThan(0);
      console.log(`Account balance: ${balance} XLM`);
    });

    it('should return 0 for non-existent account', async () => {
      const randomKeypair = generateKeypair();
      const balance = await getBalance(randomKeypair.publicKey, 'XLM');

      expect(balance).toEqual('0');
    });
  });

  describe('Payment Operations', skipE2E ? undefined : () => {
    let senderKeypair: { publicKey: string; secretKey: string };
    let recipientKeypair: { publicKey: string; secretKey: string };

    beforeAll(async () => {
      senderKeypair = generateKeypair();
      recipientKeypair = generateKeypair();

      console.log(`Sender: ${senderKeypair.publicKey}`);
      console.log(`Recipient: ${recipientKeypair.publicKey}`);

      // Fund both accounts
      await fundAccountWithAirdrop(senderKeypair.publicKey);
      await fundAccountWithAirdrop(recipientKeypair.publicKey);
    }, 60000); // 60 second timeout for two airdrops

    it('should send payment between accounts', async () => {
      const result = await sendPayment({
        fromKeypair: senderKeypair,
        toPublicKey: recipientKeypair.publicKey,
        amount: '10.5',
      });

      expect(result.transactionHash).toBeDefined();
      expect(result.transactionLink).toContain('horizon');
      expect(result.status).toEqual('success');
      expect(result.amount).toEqual('10.5');
      expect(result.destination).toEqual(recipientKeypair.publicKey);

      console.log(`Payment sent. TX: ${result.transactionHash}`);
    }, 30000);

    it('should include memo in payment', async () => {
      const memo = 'Test payment with memo';
      const result = await sendPayment({
        fromKeypair: senderKeypair,
        toPublicKey: recipientKeypair.publicKey,
        amount: '5.25',
        memo: {
          type: 'text',
          value: memo,
        },
      });

      expect(result.transactionHash).toBeDefined();
      expect(result.status).toEqual('success');

      console.log(`Payment with memo sent. TX: ${result.transactionHash}`);
    }, 30000);

    it('should fail with invalid recipient', async () => {
      await expect(
        sendPayment({
          fromKeypair: senderKeypair,
          toPublicKey: 'INVALID_KEY',
          amount: '1',
        })
      ).rejects.toThrow();
    });

    it('should fail when sending to same account', async () => {
      await expect(
        sendPayment({
          fromKeypair: senderKeypair,
          toPublicKey: senderKeypair.publicKey,
          amount: '1',
        })
      ).rejects.toThrow('Cannot send payment to the same account');
    });

    it('should fail with invalid amount', async () => {
      await expect(
        sendPayment({
          fromKeypair: senderKeypair,
          toPublicKey: recipientKeypair.publicKey,
          amount: '-5',
        })
      ).rejects.toThrow();
    });

    it('should track balance changes after payment', async () => {
      const senderBefore = await getBalance(senderKeypair.publicKey, 'XLM');
      const recipientBefore = await getBalance(recipientKeypair.publicKey, 'XLM');

      await sendPayment({
        fromKeypair: senderKeypair,
        toPublicKey: recipientKeypair.publicKey,
        amount: '2.5',
      });

      // Add small delay to ensure transaction is processed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const senderAfter = await getBalance(senderKeypair.publicKey, 'XLM');
      const recipientAfter = await getBalance(recipientKeypair.publicKey, 'XLM');

      // Sender should have less (payment + fee)
      expect(parseFloat(senderAfter)).toBeLessThan(parseFloat(senderBefore));

      // Recipient should have more
      expect(parseFloat(recipientAfter)).toBeGreaterThan(parseFloat(recipientBefore));

      console.log(`Sender: ${senderBefore} → ${senderAfter}`);
      console.log(`Recipient: ${recipientBefore} → ${recipientAfter}`);
    }, 30000);
  });

  describe('Network Queries', skipE2E ? undefined : () => {
    let testKeypair: { publicKey: string; secretKey: string };

    beforeAll(async () => {
      testKeypair = generateKeypair();
      await fundAccountWithAirdrop(testKeypair.publicKey);
    }, 30000);

    it('should fetch base fee', async () => {
      const baseFee = await getBaseFee();

      expect(baseFee).toBeDefined();
      expect(parseInt(baseFee)).toBeGreaterThan(0);

      console.log(`Current base fee: ${baseFee} stroops`);
    });

    it('should get transaction history', async () => {
      const transactions = await getTransactionHistory(testKeypair.publicKey, 10);

      // Account funded via Friendbot should have at least 1 transaction
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBeGreaterThan(0);

      const firstTx = transactions[0];
      expect(firstTx.id).toBeDefined();
      expect(firstTx.hash).toBeDefined();
      expect(firstTx.created_at).toBeDefined();
      expect(typeof firstTx.successful).toBe('boolean');

      console.log(`Found ${transactions.length} transactions`);
    });

    it('should limit transaction history', async () => {
      const limit5 = await getTransactionHistory(testKeypair.publicKey, 5);
      const limit20 = await getTransactionHistory(testKeypair.publicKey, 20);

      expect(limit5.length).toBeLessThanOrEqual(5);
      expect(limit20.length).toBeLessThanOrEqual(20);
    });
  });

  describe('Validation', () => {
    it('should validate public key format', () => {
      expect(validatePublicKey('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47')).toBe(true);
      expect(validatePublicKey('INVALID')).toBe(false);
      expect(validatePublicKey('')).toBe(false);
      expect(validatePublicKey(null as any)).toBe(false);
    });

    it('should validate secret key format', () => {
      const keypair = generateKeypair();
      expect(validateSecretKey(keypair.secretKey)).toBe(true);
      expect(validateSecretKey('INVALID')).toBe(false);
      expect(validateSecretKey('')).toBe(false);
    });
  });
});
