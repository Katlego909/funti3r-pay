# Stellar Service - Complete Production-Ready Implementation

This directory contains a complete, production-ready Stellar implementation for cross-border payments on Stellar testnet. It follows the official Stellar SDK documentation exactly with no shortcuts or assumptions.

## Overview

The Stellar service provides:
- Account management (keypair generation, funding via Friendbot, account loading)
- Payment operations (send/receive with proper XDR encoding)
- Transaction building with proper sequence numbers and base fees
- Transaction signing and submission to Horizon
- Real-time transaction streaming
- Transaction history and balance queries
- Comprehensive validation and error handling

## Files

### Core Service
- **service.ts** - Main service with all payment and account functions
- **types.ts** - TypeScript interfaces for type safety
- **constants.ts** - Network configuration (testnet URLs, base fees, timeouts)
- **index.ts** - Barrel export for all public APIs

### Utilities
- **utils/validation.ts** - Public key, secret key, and amount validation
- **utils/formatting.ts** - Stroops ↔ XLM conversion and formatting

### Testing
- **stellar.test.ts** - End-to-end integration tests against real testnet

## Installation

The service is already integrated into the payment-service. Dependencies are in package.json:

```json
"@stellar/stellar-sdk": "^16.0.0",
"axios": "^1.6.0"
```

## Usage

### Import the Service

```typescript
import {
  generateKeypair,
  fundAccountWithAirdrop,
  loadAccount,
  sendPayment,
  getBalance,
  getTransactionHistory,
} from '@funti3r/payment-service';
```

### Generate a Keypair

```typescript
const keypair = generateKeypair();
console.log(keypair.publicKey);  // GBRPY...
console.log(keypair.secretKey);  // SBXZY...
```

### Fund Account via Friendbot (Testnet Only)

```typescript
const result = await fundAccountWithAirdrop(keypair.publicKey);
console.log(result.accountCreated); // true
```

### Load Account Information

```typescript
const account = await loadAccount(keypair.publicKey);
console.log(account.sequenceNumber);  // Current sequence number
console.log(account.balances);        // Available assets
```

### Send a Payment

```typescript
const result = await sendPayment({
  fromKeypair: {
    publicKey: senderPublicKey,
    secretKey: senderSecretKey,
  },
  toPublicKey: recipientPublicKey,
  amount: '100.50',
  memo: {
    type: 'text',
    value: 'Payment for services',
  },
});

console.log(result.transactionHash);   // Transaction ID on network
console.log(result.transactionLink);   // Horizon link
```

### Check Balance

```typescript
// XLM (native asset)
const xlmBalance = await getBalance(publicKey, 'XLM');

// USDC on testnet
const usdcBalance = await getBalance(
  publicKey,
  'USDC',
  'GBBD47UZQ5LVKNQYOOKQ7CX3PTMH4NAPCGVXVHMTWVLZKZPQJYCBZZDY'
);
```

### Get Transaction History

```typescript
const transactions = await getTransactionHistory(publicKey, 20);

transactions.forEach((tx) => {
  console.log(tx.hash);           // Transaction hash
  console.log(tx.created_at);     // When it occurred
  console.log(tx.successful);     // Success/failed status
});
```

### Stream Real-Time Transactions

```typescript
const stop = await streamAccountTransactions(
  publicKey,
  (tx) => {
    console.log('New transaction:', tx.id);
  },
  (err) => {
    console.error('Stream error:', err);
  }
);

// Stop streaming later
stop();
```

## React Components

The service includes production-ready React components in both dashboards:

### SendPayment
- Form to send payments with validation
- Real-time balance display
- Transaction hash with link to Horizon

**Location:**
- `apps/enterprise-dashboard/src/components/SendPayment.tsx`
- `apps/worker-dashboard/src/components/SendPayment.tsx`

### ReceivePayment
- Display account public key with copy-to-clipboard
- Real-time transaction streaming
- Transaction history with Horizon links

**Location:**
- `apps/enterprise-dashboard/src/components/ReceivePayment.tsx`
- `apps/worker-dashboard/src/components/ReceivePayment.tsx`

### AccountBalance
- Display XLM and USDC balances
- Auto-refresh capability
- Last updated timestamp

**Location:**
- `apps/enterprise-dashboard/src/components/AccountBalance.tsx`
- `apps/worker-dashboard/src/components/AccountBalance.tsx`

### TransactionHistory
- Table of recent transactions
- Status badges (success/failed)
- Links to Horizon explorer

**Location:**
- `apps/enterprise-dashboard/src/components/TransactionHistory.tsx`
- `apps/worker-dashboard/src/components/TransactionHistory.tsx`

## Key Implementation Details

### Network Configuration
- **Network:** Stellar testnet (`stellar-testnet` passphrase)
- **Horizon URL:** https://horizon-testnet.stellar.org
- **Soroban RPC:** https://soroban-testnet.stellar.org (for future contracts)
- **Friendbot:** https://friendbot.stellar.org

### Base Fee Calculation
The service fetches the current base fee from Horizon using `fetchBaseFee()` instead of hardcoding. This ensures transactions don't fail due to outdated fees.

### Sequence Numbers
**CRITICAL:** The service loads a fresh account before each transaction. Sequence numbers change after every transaction, and using stale numbers causes transaction submission to fail with "bad_seq".

```typescript
// Always load fresh account before sending
const account = await loadAccount(publicKey);
// Use account.sequenceNumber in transaction
```

### Memo Hash Validation
Memo.hash() requires exactly 32 bytes. The implementation uses `crypto.createHash('sha256')` to ensure proper formatting:

```typescript
// Correct: SHA-256 produces 32-byte hash
const memoHash = crypto.createHash('sha256').update(paymentId).digest();
builder.addMemo(Memo.hash(memoHash));

// Incorrect: Variable-length buffer
const memoHash = Buffer.from(paymentId);  // ❌ Wrong!
```

### Validation
All inputs are validated:
- Public keys: Must be 56 chars starting with 'G'
- Secret keys: Must be 56 chars starting with 'S'
- Amounts: Positive numbers with max 7 decimal places
- Asset codes: 1-12 alphanumeric characters

## Error Handling

The service throws specific, actionable errors:

```typescript
try {
  await sendPayment(params);
} catch (error) {
  if (error.message.includes('404')) {
    // Account doesn't exist
  } else if (error.message.includes('bad_seq')) {
    // Sequence number mismatch - retry with fresh account
  } else if (error.message.includes('insufficient')) {
    // Not enough funds
  }
}
```

## Testing

Run end-to-end tests against real testnet:

```bash
# Run all tests
STELLAR_E2E=true pnpm --filter @funti3r/payment-service test

# Or specifically
STELLAR_E2E=true pnpm --filter @funti3r/payment-service test -- stellar.test.ts
```

Tests verify:
- Keypair generation and format
- Account funding via Friendbot
- Payment submission and tracking
- Balance changes
- Transaction history
- Real-time streaming

## Logging

The service uses the shared logger for detailed operation tracking:

```typescript
import { createLogger } from '@funti3r/shared-utils';
const logger = createLogger('StellarService');
```

All major operations log:
- Account load events
- Transaction building and signing
- Submission to Horizon
- Balance queries
- Stream operations

## Performance Considerations

1. **Horizon Connection Pooling:** Server instance is reused (singleton pattern)
2. **Base Fee Caching:** Fetched once per transaction (cheap operation)
3. **Account Caching:** Load fresh only when needed
4. **Stream Cleanup:** Always call the stop function to close EventSource connections

## Limitations

1. **Testnet Only:** Currently configured for Stellar testnet. Mainnet requires network passphrase change.
2. **Single Account Operations:** Service handles one account at a time (but can be called multiple times)
3. **No Automatic Retries:** Application layer should implement retry logic for transient network errors
4. **No Rate Limiting:** Friendbot has rate limits - implement application-level rate limiting

## Next Steps

1. **Integrate with Payment Service Endpoints:** Export from main service.ts to use in Express routes
2. **Add Mainnet Support:** Create mainnet constants and toggle network at runtime
3. **Implement Retry Logic:** Add exponential backoff for transient failures
4. **Add Monitoring:** Log transaction submission to analytics service
5. **Create Webhook Handlers:** Handle payment confirmations in compliance service

## Security Notes

- **Secret Keys:** Never log or transmit. Always store in secure environment variables.
- **Network Calls:** All Horizon calls use HTTPS. Validate URLs in constants.
- **Input Validation:** All public inputs validated before use.
- **Transaction Signing:** Happens client-side (service.ts), never send secret keys to other services.

## References

- [Stellar SDK Documentation](https://developers.stellar.org/docs)
- [Horizon API Reference](https://developers.stellar.org/api/introduction/next)
- [Transaction Building Guide](https://developers.stellar.org/docs/learn/fundamentals/transactions)
- [Soroban Documentation](https://developers.stellar.org/docs/learn/soroban)
