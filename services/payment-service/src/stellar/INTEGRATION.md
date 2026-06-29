# Stellar Service - API Integration Guide

How to integrate the Stellar service into Express routes and API endpoints.

## Overview

The Stellar service provides low-level functions for account and payment management. To expose these via API, create Express routes that:

1. Validate input
2. Call Stellar service functions
3. Handle errors appropriately
4. Return formatted responses

## Integration Points

### 1. Wallet Management Endpoints

#### Create/Generate Wallet

```typescript
import { generateKeypair, fundAccountWithAirdrop } from '../stellar/service.js';

router.post('/wallets/generate', async (req, res) => {
  try {
    const keypair = generateKeypair();
    
    // Store keypair securely in database (encrypted)
    // await saveWalletKeypair(userId, keypair);
    
    res.json({
      success: true,
      publicKey: keypair.publicKey,
      message: 'Wallet generated. Fund via Friendbot if testnet.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### Fund Testnet Account

```typescript
router.post('/wallets/fund-testnet', async (req, res) => {
  const { publicKey } = req.body;
  
  try {
    const result = await fundAccountWithAirdrop(publicKey);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

#### Get Wallet Balance

```typescript
import { getBalance } from '../stellar/service.js';

router.get('/wallets/:userId/balance', async (req, res) => {
  const { userId } = req.params;
  
  try {
    // Get user's Stellar public key from database
    const publicKey = await getUserStellarPublicKey(userId);
    
    if (!publicKey) {
      return res.status(404).json({ error: 'User has no Stellar wallet' });
    }
    
    const [xlmBalance, usdcBalance] = await Promise.all([
      getBalance(publicKey, 'XLM'),
      getBalance(publicKey, 'USDC', STELLAR_USDC_ISSUER).catch(() => '0'),
    ]);
    
    res.json({
      publicKey,
      xlm: {
        balance: xlmBalance,
        asset: 'XLM',
      },
      usdc: {
        balance: usdcBalance,
        asset: 'USDC',
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 2. Payment Endpoints

#### Send Payment

```typescript
import { sendPayment, getKeypairFromSecret } from '../stellar/service.js';

router.post('/payments/send', async (req, res) => {
  const { recipientPublicKey, amount, memo } = req.body;
  const userId = req.user.id;
  
  try {
    // Get sender's secret key from secure storage
    const secretKey = await getEncryptedWalletSecret(userId);
    const publicKey = await getUserStellarPublicKey(userId);
    
    const result = await sendPayment({
      fromKeypair: {
        publicKey,
        secretKey,
      },
      toPublicKey: recipientPublicKey,
      amount,
      memo: memo ? { type: 'text', value: memo } : undefined,
    });
    
    // Store payment record in database
    await logPaymentTransaction({
      userId,
      recipient: recipientPublicKey,
      amount,
      transactionHash: result.transactionHash,
      status: 'confirmed',
    });
    
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

#### Send Payment with Retry

```typescript
import { retryPayment } from '../stellar/service.js';

router.post('/payments/send-with-retry', async (req, res) => {
  const { recipientPublicKey, amount, maxRetries = 3 } = req.body;
  const userId = req.user.id;
  
  try {
    const secretKey = await getEncryptedWalletSecret(userId);
    const publicKey = await getUserStellarPublicKey(userId);
    
    const result = await retryPayment(
      {
        fromKeypair: { publicKey, secretKey },
        toPublicKey: recipientPublicKey,
        amount,
      },
      maxRetries
    );
    
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

#### Send Batch Payments

```typescript
import { sendPaymentBatch } from '../stellar/service.js';

router.post('/payments/batch', async (req, res) => {
  const { recipients } = req.body; // [{publicKey, amount}, ...]
  const userId = req.user.id;
  
  try {
    const secretKey = await getEncryptedWalletSecret(userId);
    const publicKey = await getUserStellarPublicKey(userId);
    
    const results = await sendPaymentBatch(
      { publicKey, secretKey },
      recipients
    );
    
    // Log all batch results
    for (const result of results) {
      if (result.success) {
        await logPaymentTransaction({
          userId,
          recipient: result.recipient,
          amount: result.amount,
          transactionHash: result.transactionHash,
          status: 'confirmed',
        });
      } else {
        await logPaymentFailure({
          userId,
          recipient: result.recipient,
          amount: result.amount,
          error: result.error,
        });
      }
    }
    
    res.json({
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

### 3. Transaction History Endpoints

#### Get Payment Operations

```typescript
import { getPaymentOperations, filterIncomingPayments } from '../stellar/service.js';

router.get('/payments/incoming', async (req, res) => {
  const { limit = 20 } = req.query;
  const userId = req.user.id;
  
  try {
    const publicKey = await getUserStellarPublicKey(userId);
    
    if (!publicKey) {
      return res.status(404).json({ error: 'User has no Stellar wallet' });
    }
    
    const operations = await getPaymentOperations(publicKey, limit);
    const incoming = filterIncomingPayments(publicKey, operations);
    
    res.json({
      publicKey,
      count: incoming.length,
      payments: incoming,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### Get Transaction History

```typescript
import { getTransactionHistory } from '../stellar/service.js';

router.get('/payments/history', async (req, res) => {
  const { limit = 20 } = req.query;
  const userId = req.user.id;
  
  try {
    const publicKey = await getUserStellarPublicKey(userId);
    
    const transactions = await getTransactionHistory(publicKey, limit);
    
    res.json({
      publicKey,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 4. Account Management Endpoints

#### Get Account Details

```typescript
import { loadAccount, getAccountBalances } from '../stellar/service.js';

router.get('/accounts/:publicKey', async (req, res) => {
  const { publicKey } = req.params;
  
  try {
    const account = await loadAccount(publicKey);
    
    if (!account.exists) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    res.json({
      publicKey: account.publicKey,
      sequenceNumber: account.sequenceNumber,
      balances: account.balances,
      exists: account.exists,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

#### Check Account Existence

```typescript
import { verifyAccountExists } from '../stellar/service.js';

router.get('/accounts/:publicKey/exists', async (req, res) => {
  const { publicKey } = req.params;
  
  try {
    const exists = await verifyAccountExists(publicKey);
    res.json({ publicKey, exists });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

## Error Handling

Implement consistent error handling:

```typescript
const handleStellarError = (error: any, res: any) => {
  const message = error.message || String(error);
  
  // Validation errors
  if (message.includes('Invalid')) {
    return res.status(400).json({ error: message });
  }
  
  // Account not found
  if (message.includes('404')) {
    return res.status(404).json({ error: 'Account not found' });
  }
  
  // Insufficient balance
  if (message.includes('insufficient')) {
    return res.status(402).json({ error: 'Insufficient balance' });
  }
  
  // Network errors
  if (message.includes('Network') || message.includes('timeout')) {
    return res.status(503).json({ error: 'Network unavailable, please retry' });
  }
  
  // Other errors
  res.status(500).json({ error: message });
};
```

## Storing Keypairs Securely

**CRITICAL:** Secret keys must NEVER be stored in plain text:

```typescript
import crypto from 'crypto';

// Encrypt secret key before storing
async function saveWalletKeypair(userId: string, keypair: KeypairData) {
  const encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
  const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
  
  const encryptedSecret = cipher.update(keypair.secretKey, 'utf8', 'hex') + 
                          cipher.final('hex');
  
  await db.wallet.create({
    userId,
    publicKey: keypair.publicKey,
    encryptedSecret,
    createdAt: new Date(),
  });
}

// Decrypt secret key for transaction signing
async function getEncryptedWalletSecret(userId: string): string {
  const wallet = await db.wallet.findOne({ userId });
  
  if (!wallet) {
    throw new Error('Wallet not found');
  }
  
  const encryptionKey = process.env.WALLET_ENCRYPTION_KEY;
  const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey);
  
  const secret = decipher.update(wallet.encryptedSecret, 'hex', 'utf8') +
                 decipher.final('utf8');
  
  return secret;
}
```

## Request/Response Examples

### Send Payment

**Request:**
```json
POST /payments/send
{
  "recipientPublicKey": "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47",
  "amount": "100.50",
  "memo": "Payment for services"
}
```

**Response (200):**
```json
{
  "transactionHash": "abc123def456...",
  "transactionLink": "https://horizon-testnet.stellar.org/transactions/abc123def456...",
  "status": "success",
  "timestamp": "2025-06-29T12:00:00Z",
  "amount": "100.50",
  "destination": "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47"
}
```

### Get Account Balance

**Request:**
```
GET /wallets/:userId/balance
```

**Response (200):**
```json
{
  "publicKey": "GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47",
  "xlm": {
    "balance": "1500.5000000",
    "asset": "XLM"
  },
  "usdc": {
    "balance": "0",
    "asset": "USDC"
  }
}
```

### Send Batch Payments

**Request:**
```json
POST /payments/batch
{
  "recipients": [
    { "publicKey": "GBRPY...", "amount": "10" },
    { "publicKey": "GABCD...", "amount": "20" },
    { "publicKey": "GXYZ1...", "amount": "15" }
  ]
}
```

**Response (200):**
```json
{
  "total": 3,
  "successful": 2,
  "failed": 1,
  "results": [
    {
      "recipient": "GBRPY...",
      "amount": "10",
      "success": true,
      "transactionHash": "abc123..."
    },
    {
      "recipient": "GABCD...",
      "amount": "20",
      "success": true,
      "transactionHash": "def456..."
    },
    {
      "recipient": "GXYZ1...",
      "amount": "15",
      "success": false,
      "error": "Insufficient balance"
    }
  ]
}
```

## Testing Integration

```bash
# Start the service
pnpm --filter @funti3r/payment-service dev

# In another terminal, test endpoints
curl http://localhost:3000/payments/send \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "recipientPublicKey": "GBRPY...",
    "amount": "10.5",
    "memo": "Test payment"
  }'
```

## Best Practices

1. **Always load fresh account** before sending payments
2. **Implement exponential backoff** for retries
3. **Store secret keys encrypted** in secure location
4. **Validate all inputs** before calling Stellar functions
5. **Log all transactions** for auditing
6. **Use rate limiting** on batch endpoints
7. **Handle network timeouts** gracefully
8. **Return meaningful error messages** to client
9. **Monitor payment confirmations** in real-time
10. **Test on testnet first** before going to mainnet

## Migration to Mainnet

To switch to mainnet, update constants:

```typescript
// In constants.ts
export const STELLAR_NETWORK = {
  name: 'PUBLIC',
  passphrase: Networks.PUBLIC_NETWORK_PASSPHRASE,
} as const;

export const HORIZON_BASE_URL = 'https://horizon.stellar.org';
export const SOROBAN_RPC_URL = 'https://soroban-rpc.stellar.org';

// Remove Friendbot (only for testnet)
// export const FRIENDBOT_URL = undefined;
```

Then test thoroughly on testnet before deploying!
