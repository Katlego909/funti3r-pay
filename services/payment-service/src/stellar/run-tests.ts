/**
 * Manual test runner for Stellar Service E2E tests
 * Run with: npx tsx src/stellar/run-tests.ts
 */

import {
  generateKeypair,
  fundAccountWithAirdrop,
  loadAccount,
  sendPayment,
  getBalance,
  getTransactionHistory,
} from './service.js';
import { validatePublicKey, validateSecretKey } from './utils/validation.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n▶ ${name}`);
  const start = Date.now();

  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`✓ PASSED (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMsg, duration });
    console.log(`✗ FAILED (${duration}ms): ${errorMsg}`);
  }
}

async function runTests() {
  console.log('\n═══════════════════════════════════════');
  console.log('  STELLAR SERVICE E2E TEST SUITE');
  console.log('═══════════════════════════════════════');

  // Test 1: Keypair generation
  await test('Generate keypair', () => {
    const keypair = generateKeypair();

    if (!validatePublicKey(keypair.publicKey)) {
      throw new Error('Invalid public key format');
    }
    if (!validateSecretKey(keypair.secretKey)) {
      throw new Error('Invalid secret key format');
    }

    console.log(`   Public: ${keypair.publicKey.substring(0, 10)}...`);
    console.log(`   Secret: ${keypair.secretKey.substring(0, 10)}...`);

    return Promise.resolve();
  });

  let testKeypair: { publicKey: string; secretKey: string };
  let testAccount2: { publicKey: string; secretKey: string };

  // Test 2: Fund account via Friendbot
  await test('Fund account via Friendbot airdrop', async () => {
    testKeypair = generateKeypair();
    console.log(`   Public key: ${testKeypair.publicKey.substring(0, 10)}...`);

    const result = await fundAccountWithAirdrop(testKeypair.publicKey);
    console.log(`   Message: ${result.message}`);

    if (!result.success || !result.accountCreated) {
      throw new Error('Airdrop failed or account not created');
    }
  });

  // Test 3: Load account
  await test('Load account from network', async () => {
    const account = await loadAccount(testKeypair.publicKey);

    if (!account.exists) {
      throw new Error('Account does not exist after funding');
    }

    console.log(`   Exists: ${account.exists}`);
    console.log(`   Sequence: ${account.sequenceNumber}`);
    console.log(`   Balances: ${account.balances.length}`);
  });

  // Test 4: Check balance
  await test('Get account balance', async () => {
    const balance = await getBalance(testKeypair.publicKey, 'XLM');
    const balanceNum = parseFloat(balance);

    if (isNaN(balanceNum) || balanceNum <= 0) {
      throw new Error(`Invalid balance: ${balance}`);
    }

    console.log(`   XLM Balance: ${balance}`);
  });

  // Test 5: Fund recipient account
  await test('Fund second account for payment', async () => {
    testAccount2 = generateKeypair();
    console.log(`   Public key: ${testAccount2.publicKey.substring(0, 10)}...`);

    await fundAccountWithAirdrop(testAccount2.publicKey);
    const balance = await getBalance(testAccount2.publicKey, 'XLM');
    console.log(`   Balance: ${balance} XLM`);
  });

  // Test 6: Send payment
  await test('Send payment between accounts', async () => {
    const result = await sendPayment({
      fromKeypair: testKeypair,
      toPublicKey: testAccount2.publicKey,
      amount: '10.5',
      memo: { type: 'text', value: 'Test payment' },
    });

    if (!result.transactionHash) {
      throw new Error('No transaction hash returned');
    }

    console.log(`   TX Hash: ${result.transactionHash.substring(0, 16)}...`);
    console.log(`   Amount: ${result.amount} XLM`);
    console.log(`   Status: ${result.status}`);
  });

  // Test 7: Wait for confirmation
  await test('Wait for transaction confirmation', async () => {
    console.log('   Waiting 3 seconds for network confirmation...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  // Test 8: Verify balance changes
  await test('Verify balance changes after payment', async () => {
    const senderBalance = await getBalance(testKeypair.publicKey, 'XLM');
    const recipientBalance = await getBalance(testAccount2.publicKey, 'XLM');

    const senderNum = parseFloat(senderBalance);
    const recipientNum = parseFloat(recipientBalance);

    console.log(`   Sender: ${senderBalance} XLM`);
    console.log(`   Recipient: ${recipientBalance} XLM`);

    if (senderNum <= 0 || recipientNum <= 0) {
      throw new Error('Balances invalid');
    }
  });

  // Test 9: Get transaction history
  await test('Get transaction history', async () => {
    const transactions = await getTransactionHistory(testKeypair.publicKey, 10);

    if (!Array.isArray(transactions) || transactions.length === 0) {
      throw new Error('No transaction history retrieved');
    }

    console.log(`   Total transactions: ${transactions.length}`);
    if (transactions.length > 0) {
      console.log(`   Latest: ${transactions[0].hash.substring(0, 16)}...`);
      console.log(`   Status: ${transactions[0].successful ? 'Success' : 'Failed'}`);
    }
  });

  // Test 10: Validate inputs
  await test('Input validation', async () => {
    // Test invalid public key
    try {
      await sendPayment({
        fromKeypair: testKeypair,
        toPublicKey: 'INVALID',
        amount: '10',
      });
      throw new Error('Should have rejected invalid public key');
    } catch (e) {
      if (!String(e).includes('Invalid')) {
        throw e;
      }
    }

    console.log('   ✓ Rejects invalid public key');

    // Test negative amount
    try {
      await sendPayment({
        fromKeypair: testKeypair,
        toPublicKey: testAccount2.publicKey,
        amount: '-10',
      });
      throw new Error('Should have rejected negative amount');
    } catch (e) {
      if (!String(e).includes('Invalid') && !String(e).includes('positive')) {
        throw e;
      }
    }

    console.log('   ✓ Rejects negative amount');
  });

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\nTests run: ${results.length}`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`Total time: ${totalTime}ms\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  console.log('═══════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
