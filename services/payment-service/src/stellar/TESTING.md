# Stellar Service - Testing Guide

Complete guide for testing the Stellar payment service against Stellar testnet.

## Quick Start Testing

### 1. Run Unit Tests

```bash
pnpm --filter @funti3r/payment-service test
```

### 2. Run End-to-End Tests (Real Testnet)

```bash
STELLAR_E2E=true pnpm --filter @funti3r/payment-service test -- stellar.test.ts
```

**Note:** E2E tests interact with real testnet. They may fail if:
- Friendbot is rate-limited
- Horizon API is slow
- Network is congested

Simply retry if tests fail due to network issues.

## Manual Testing in Node REPL

### 1. Start Node REPL with local env

```bash
cd services/payment-service
node --env-file=../../.env.local --input-type=module
```

### 2. Import the service

```javascript
import {
  generateKeypair,
  fundAccountWithAirdrop,
  getBalance,
  sendPayment,
  getTransactionHistory,
} from './src/stellar/service.js';
```

### 3. Create and fund a test account

```javascript
const keypair = generateKeypair();
console.log('Public Key:', keypair.publicKey);
console.log('Secret Key:', keypair.secretKey);

// Fund account
const result = await fundAccountWithAirdrop(keypair.publicKey);
console.log(result);
```

### 4. Check balance

```javascript
const balance = await getBalance(keypair.publicKey, 'XLM');
console.log('Balance:', balance, 'XLM');
```

### 5. Send a payment

```javascript
// Create recipient
const recipient = generateKeypair();
await fundAccountWithAirdrop(recipient.publicKey);

// Send payment
const paymentResult = await sendPayment({
  fromKeypair: keypair,
  toPublicKey: recipient.publicKey,
  amount: '5.5',
  memo: { type: 'text', value: 'Test payment' }
});

console.log('Transaction:', paymentResult.transactionHash);
console.log('Link:', paymentResult.transactionLink);
```

### 6. Check transaction history

```javascript
const history = await getTransactionHistory(keypair.publicKey, 10);
console.log('Transactions:', history);
```

### 7. Exit REPL

```javascript
.exit
```

## API Endpoint Testing

### 1. Test Payment Submission via API

```bash
curl -X POST http://localhost:3000/payouts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "recipientId": "worker-123",
    "amount": "10.50",
    "description": "Weekly payment"
  }'
```

### 2. Test Balance Endpoint

```bash
curl http://localhost:3000/wallets/balance \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Test Transaction History

```bash
curl http://localhost:3000/payouts \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Full Integration Test Scenario

### Create two accounts and send payment

```javascript
import {
  generateKeypair,
  fundAccountWithAirdrop,
  sendPayment,
  getBalance,
  retryPayment,
} from './src/stellar/service.js';

async function testFullPaymentFlow() {
  console.log('=== Full Payment Flow Test ===\n');

  // 1. Generate accounts
  console.log('1. Generating accounts...');
  const sender = generateKeypair();
  const recipient = generateKeypair();
  console.log('Sender:', sender.publicKey);
  console.log('Recipient:', recipient.publicKey);

  // 2. Fund accounts
  console.log('\n2. Funding accounts via Friendbot...');
  await fundAccountWithAirdrop(sender.publicKey);
  console.log('Sender funded ✓');
  await fundAccountWithAirdrop(recipient.publicKey);
  console.log('Recipient funded ✓');

  // 3. Check initial balances
  console.log('\n3. Checking balances...');
  const senderBalance = await getBalance(sender.publicKey);
  const recipientBalance = await getBalance(recipient.publicKey);
  console.log('Sender balance:', senderBalance, 'XLM');
  console.log('Recipient balance:', recipientBalance, 'XLM');

  // 4. Send payment with retry logic
  console.log('\n4. Sending payment with retry logic...');
  const paymentResult = await retryPayment(
    {
      fromKeypair: sender,
      toPublicKey: recipient.publicKey,
      amount: '10.5',
      memo: {
        type: 'text',
        value: 'Integration test payment'
      }
    },
    3, // maxRetries
    1000 // initialDelay
  );
  console.log('Payment sent ✓');
  console.log('Transaction hash:', paymentResult.transactionHash);

  // 5. Wait for transaction confirmation
  console.log('\n5. Waiting for confirmation...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 6. Check final balances
  console.log('\n6. Checking final balances...');
  const senderFinal = await getBalance(sender.publicKey);
  const recipientFinal = await getBalance(recipient.publicKey);
  console.log('Sender balance:', senderFinal, 'XLM (was', senderBalance, ')');
  console.log('Recipient balance:', recipientFinal, 'XLM (was', recipientBalance, ')');

  // 7. Verify balance changes
  console.log('\n7. Verifying balance changes...');
  const senderDecreased = parseFloat(senderFinal) < parseFloat(senderBalance);
  const recipientIncreased = parseFloat(recipientFinal) > parseFloat(recipientBalance);
  
  if (senderDecreased && recipientIncreased) {
    console.log('✓ Balances changed correctly');
  } else {
    console.log('✗ Balances did not change as expected');
  }

  console.log('\n=== Test Complete ===');
}

// Run the test
testFullPaymentFlow().catch(console.error);
```

## Batch Payment Testing

```javascript
import { sendPaymentBatch, generateKeypair, fundAccountWithAirdrop } from './src/stellar/service.js';

async function testBatchPayments() {
  // Create sender
  const sender = generateKeypair();
  await fundAccountWithAirdrop(sender.publicKey);

  // Create recipients
  const recipients = [];
  for (let i = 0; i < 3; i++) {
    const r = generateKeypair();
    await fundAccountWithAirdrop(r.publicKey);
    recipients.push({
      publicKey: r.publicKey,
      amount: String(5 + i) // 5 XLM, 6 XLM, 7 XLM
    });
  }

  // Send batch
  const results = await sendPaymentBatch(sender, recipients);
  
  console.log('Batch Results:');
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.success ? '✓' : '✗'} ${r.amount} XLM to ${r.recipient.substring(0, 6)}`);
    if (!r.success) {
      console.log(`     Error: ${r.error}`);
    }
  });
}

testBatchPayments().catch(console.error);
```

## Error Scenario Testing

### Test insufficient balance

```javascript
import { sendPayment, generateKeypair, fundAccountWithAirdrop } from './src/stellar/service.js';

async function testInsufficientBalance() {
  const sender = generateKeypair();
  const recipient = generateKeypair();
  
  // Fund sender with small amount
  await fundAccountWithAirdrop(sender.publicKey);
  
  // Try to send more than available
  try {
    await sendPayment({
      fromKeypair: sender,
      toPublicKey: recipient.publicKey,
      amount: '1000000', // More than testnet airdrop
    });
  } catch (error) {
    console.log('Expected error:', error.message);
  }
}

testInsufficientBalance().catch(console.error);
```

### Test invalid inputs

```javascript
import { sendPayment, generateKeypair } from './src/stellar/service.js';

async function testInvalidInputs() {
  const validKeypair = generateKeypair();
  
  // Test 1: Invalid recipient
  try {
    await sendPayment({
      fromKeypair: validKeypair,
      toPublicKey: 'INVALID_KEY',
      amount: '10',
    });
  } catch (error) {
    console.log('✓ Rejected invalid recipient:', error.message);
  }

  // Test 2: Negative amount
  try {
    await sendPayment({
      fromKeypair: validKeypair,
      toPublicKey: validKeypair.publicKey,
      amount: '-10',
    });
  } catch (error) {
    console.log('✓ Rejected negative amount:', error.message);
  }

  // Test 3: Invalid amount decimals
  try {
    await sendPayment({
      fromKeypair: validKeypair,
      toPublicKey: validKeypair.publicKey,
      amount: '10.123456789', // More than 7 decimals
    });
  } catch (error) {
    console.log('✓ Rejected too many decimals:', error.message);
  }
}

testInvalidInputs().catch(console.error);
```

## Performance Testing

### Measure payment submission time

```javascript
import { sendPayment, generateKeypair, fundAccountWithAirdrop } from './src/stellar/service.js';

async function measurePaymentTime() {
  const sender = generateKeypair();
  const recipient = generateKeypair();
  
  await fundAccountWithAirdrop(sender.publicKey);
  await fundAccountWithAirdrop(recipient.publicKey);

  const start = Date.now();
  
  await sendPayment({
    fromKeypair: sender,
    toPublicKey: recipient.publicKey,
    amount: '10',
  });

  const duration = Date.now() - start;
  console.log(`Payment submitted in ${duration}ms`);
}

measurePaymentTime().catch(console.error);
```

## Debugging Tips

### Enable debug logging

```javascript
// Set environment variable before starting
process.env.DEBUG = 'stellar*';

import { getHorizonServer } from './src/stellar/service.js';
const server = getHorizonServer();

// All operations will now log detailed information
```

### Inspect transaction XDR

```javascript
import { TransactionBuilder, Keypair, Networks } from '@stellar/stellar-sdk';

// After building transaction
const xdr = transaction.toXDR();
console.log('Transaction XDR:', xdr);
```

### Check Horizon API directly

```bash
# Get account details
curl https://horizon-testnet.stellar.org/accounts/GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47

# Get transaction details
curl https://horizon-testnet.stellar.org/transactions/{HASH}

# Get account transactions
curl https://horizon-testnet.stellar.org/accounts/GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47/transactions
```

## Common Issues

### "Friendbot is rate-limited"
- **Solution:** Wait 30 seconds and retry, or increase delay between requests

### "bad_seq - Transaction has a bad sequence number"
- **Solution:** Always load fresh account before sending - sequence numbers increment

### "insufficient_balance"
- **Solution:** Account doesn't have enough XLM for payment + fee. Request more from Friendbot.

### "Horizon request timeout"
- **Solution:** Network is slow, retry with delay. Consider implementing exponential backoff.

### "invalid_transaction_set - Transaction is invalid"
- **Solution:** Usually invalid memo or asset. Check memo is max 28 chars for text memos.

## Success Criteria

A successful test should show:
- ✓ Keypairs generated correctly (56 chars, start with G/S)
- ✓ Accounts funded via Friendbot
- ✓ Balances loaded from network
- ✓ Payments submitted successfully
- ✓ Transaction hashes returned
- ✓ Balance changes verified
- ✓ Transaction history accessible

When all these pass, the Stellar integration is working correctly!
