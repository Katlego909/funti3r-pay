# Stellar Integration Guide

## Overview

Funti3r-Pay now includes complete Stellar SDK integration using the official `@stellar/stellar-sdk` package. Workers automatically receive Stellar ed25519 accounts upon registration, and enterprises can create payments to these accounts.

## Service Startup & Logging

### Payment Service Startup

When the Payment Service starts, you'll see:

```
╔════════════════════════════════════════════════════════╗
║         Funti3r-Pay Payment Service Started            ║
╠════════════════════════════════════════════════════════╣
║ Port: 3002                                              ║
║ Database: ✓ Connected                                  ║
║ Stellar: ✓ Connected                                  ║
╠════════════════════════════════════════════════════════╣
║ Available Endpoints:                                   ║
║ - POST   /payments (create payment)                    ║
║ - GET    /payments (list payments)                     ║
║ - GET    /payments/:id (get payment)                   ║
║ - POST   /payments/:id/submit (to Stellar)             ║
║ - POST   /payments/:id/confirm-stellar (with sig)      ║
║ - GET    /payments/:id/stellar-status (check tx)       ║
║ - GET    /health (service health)                      ║
║ - GET    /health/stellar (Stellar connectivity)        ║
║ - GET    /logs (view all logs)                         ║
║ - GET    /logs/summary (log summary)                   ║
║ - GET    /logs/payment/:id (payment logs)              ║
╚════════════════════════════════════════════════════════╝
```

### Startup Logs Example

```
[2026-06-29T15:57:15.660Z] [INFO] [PaymentService] [StartUp] Initializing Payment Service
[2026-06-29T15:57:15.662Z] [INFO] [PaymentService] [StartUp] Connecting to PostgreSQL
[2026-06-29T15:57:15.728Z] [INFO] [Database:PostgreSQL] Connected to PostgreSQL
[2026-06-29T15:57:15.729Z] [INFO] [PaymentService] [StartUp] ✓ PostgreSQL connected
[2026-06-29T15:57:15.729Z] [INFO] [PaymentService] [StartUp] Testing Stellar network connectivity
[2026-06-29T15:57:15.729Z] [INFO] [StellarService] [Stellar] Initializing Horizon server
[2026-06-29T15:57:17.148Z] [INFO] [StellarService] [Stellar] Connected to Stellar network
[2026-06-29T15:57:17.149Z] [INFO] [PaymentService] [StartUp] ✓ Stellar network connected
[2026-06-29T15:57:17.158Z] [INFO] [PaymentService] [StartUp] ✓ Payment Service running on port 3002
```

## Worker Stellar Account Creation

When a user registers with role `"worker"`, the system automatically:

1. Generates a new Stellar ed25519 keypair using `Keypair.random()`
2. Stores the public key in `users.stellar_public_key`
3. Stores the secret key encrypted in `users.stellar_secret_key`

### Example: Worker Registration

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "Password123!",
    "role": "worker",
    "firstName": "Alice"
  }'
```

**Response:**
```json
{
  "userId": "0e0933ae-e277-4f50-ad16-bc73cadc4cad",
  "email": "alice@example.com",
  "role": "worker",
  "accessToken": "eyJhbGci..."
}
```

### Retrieving Worker's Stellar Account

```bash
curl http://localhost:3000/wallets/{userId} \
  -H "Authorization: Bearer {token}"
```

**Response:**
```json
{
  "userId": "0e0933ae-e277-4f50-ad16-bc73cadc4cad",
  "walletType": "worker",
  "stellarPublicKey": "GAB4F3MBMKKB45QM6QGKLUXOHO2F65R7IFIPUQV7ID76PE5QWRSLQACD"
}
```

## Payment Flow with Stellar

### Step 1: Create Payment

Enterprise creates a payment to a worker:

```bash
curl -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer {enterprise_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "workerId": "0e0933ae-e277-4f50-ad16-bc73cadc4cad",
    "amount": "100.00",
    "currency": "XLM",
    "description": "Monthly salary"
  }'
```

**Response:**
```json
{
  "id": "4d47be09-9432-4445-8367-43b6239db34b",
  "status": "initiated",
  "amount": 100,
  "currency": "XLM",
  "workerId": "0e0933ae-e277-4f50-ad16-bc73cadc4cad",
  "createdAt": "2026-06-29T14:01:26.787Z"
}
```

**Service Logs:**
```
[Payment] Payment initiated
[Payment] Building Stellar transaction
[Stellar] Building payment transaction
[Stellar] Loading source account
[Stellar] Fetching base fee from network
[Stellar] Verifying destination account
[Stellar] Adding native XLM payment operation
[Stellar] Transaction built successfully
[Stellar] Transaction signed
[Stellar] Transaction XDR generated
```

### Step 2: Check Payment Details

```bash
curl http://localhost:3000/payments/4d47be09-9432-4445-8367-43b6239db34b \
  -H "Authorization: Bearer {enterprise_token}"
```

**Response:**
```json
{
  "id": "4d47be09-9432-4445-8367-43b6239db34b",
  "status": "initiated",
  "amount": "100.00000000",
  "currency": "XLM",
  "workerId": "0e0933ae-e277-4f50-ad16-bc73cadc4cad",
  "stellarDestination": "GAB4F3MBMKKB45QM6QGKLUXOHO2F65R7IFIPUQV7ID76PE5QWRSLQACD",
  "stellarTxHash": null,
  "description": "Monthly salary",
  "createdAt": "2026-06-29T14:01:26.787Z"
}
```

## Logging Endpoints

### View All Logs

```bash
curl http://localhost:3002/logs
```

**Response:**
```json
{
  "count": 45,
  "logs": [
    {
      "timestamp": "2026-06-29T15:57:17.148Z",
      "level": "info",
      "component": "StellarService",
      "action": "[Stellar] Connected to Stellar network",
      "details": {
        "horizonVersion": "27.0.0-338710d61f7057cd160ca26c0112cef32db9fdcd",
        "stellarCoreVersion": "..."
      }
    },
    ...
  ]
}
```

### Filter Logs by Payment

```bash
curl http://localhost:3002/logs/payment/4d47be09-9432-4445-8367-43b6239db34b
```

### View Log Summary

```bash
curl http://localhost:3002/logs/summary
```

**Response:**
```json
{
  "total": 45,
  "byComponent": {
    "PaymentService": 15,
    "StellarService": 20,
    "Database": 10
  },
  "byLevel": {
    "info": 40,
    "warn": 4,
    "error": 1
  },
  "recent": [...]
}
```

### Clear Logs

```bash
curl -X POST http://localhost:3002/logs/clear
```

## Stellar Network Status

### Check Stellar Connectivity

```bash
curl http://localhost:3002/health/stellar
```

**Response (Connected):**
```json
{
  "status": "healthy",
  "service": "payment-service",
  "stellar": "connected"
}
```

**Response (Disconnected):**
```json
{
  "status": "degraded",
  "service": "payment-service",
  "stellar": "disconnected"
}
```

## Stellar SDK Usage

### Building Transactions

The service uses the official Stellar SDK pattern:

```typescript
import { Horizon, TransactionBuilder, Networks, Operation, Asset, Keypair } from '@stellar/stellar-sdk';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');

// Load account to get sequence number
const account = await server.loadAccount(sourcePublicKey);

// Fetch current network fee
const baseFee = await server.fetchBaseFee();

// Build transaction
const transaction = new TransactionBuilder(account, {
  fee: baseFee,
  networkPassphrase: Networks.TESTNET
})
  .addOperation(
    Operation.payment({
      destination: recipientAddress,
      asset: Asset.native(), // XLM
      amount: '100.00'
    })
  )
  .setTimeout(30)
  .build();

// Sign and submit
transaction.sign(keypair);
const result = await server.submitTransaction(transaction);
```

## Configuration

### Environment Variables

```bash
# Stellar Network Configuration
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK=Test SDF Network ; September 2015  # testnet passphrase
```

## Error Handling & Logging

Each operation is logged with detailed error information:

### Example: Stellar Connection Failure

```
[2026-06-29T15:57:15.729Z] [ERROR] [StellarService] [Stellar] Failed to connect to Stellar network
{
  "url": "https://invalid-horizon.stellar.org",
  "error": "getaddrinfo ENOTFOUND invalid-horizon.stellar.org"
}
```

### Example: Transaction Submission Failure

```
[2026-06-29T15:57:17.149Z] [ERROR] [Stellar] Transaction submission failed
{
  "resultCode": "tx_failed",
  "resultXdr": "AAAAAgAAAAA...",
  "paymentId": "4d47be09-9432-4445-8367-43b6239db34b"
}
```

## Testing the Integration

### Complete Flow Test

```bash
# 1. Register worker (auto-creates Stellar account)
WORKER=$(curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Pass!","role":"worker"}')
WORKER_ID=$(echo $WORKER | grep -o '"userId":"[^"]*' | cut -d'"' -f4)
WORKER_TOKEN=$(echo $WORKER | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# 2. Get worker's Stellar account
curl http://localhost:3000/wallets/$WORKER_ID \
  -H "Authorization: Bearer $WORKER_TOKEN"

# 3. Register enterprise
ENTERPRISE=$(curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"biz@test.com","password":"Pass!","role":"enterprise"}')
ENTERPRISE_TOKEN=$(echo $ENTERPRISE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# 4. Create payment
PAYMENT=$(curl -s -X POST http://localhost:3000/payments \
  -H "Authorization: Bearer $ENTERPRISE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"workerId\":\"$WORKER_ID\",\"amount\":\"100\",\"currency\":\"XLM\"}")
PAYMENT_ID=$(echo $PAYMENT | grep -o '"id":"[^"]*' | cut -d'"' -f4)

# 5. View payment logs
curl http://localhost:3002/logs/payment/$PAYMENT_ID

# 6. Check Stellar status
curl http://localhost:3002/health/stellar
```

## Next Steps

1. **Implement Transaction Signing**
   - Add enterprise wallet signing capability
   - Support multi-signature scenarios

2. **Actual Stellar Submission**
   - Replace `POST /payments/:id/submit` with actual Horizon submission
   - Track transaction hash after submission

3. **Transaction Monitoring**
   - Implement polling for transaction confirmation
   - Update payment status to "completed" when confirmed

4. **Compliance Integration**
   - Add KYC/AML checks before Stellar submission
   - Log compliance decisions

5. **Error Recovery**
   - Implement retry logic for failed submissions
   - Add transaction resubmission capability

## Troubleshooting

### Stellar Connection Issues

Check service logs:
```bash
curl http://localhost:3002/logs/summary
```

If `stellar: "disconnected"`, verify:
- Internet connectivity
- Horizon server URL is correct
- Network passphrase matches target network

### Payment Status Stuck

View payment-specific logs:
```bash
curl http://localhost:3002/logs/payment/{payment_id}
```

Look for error-level entries indicating what failed.

### Database/Stellar Sync Issues

Clear and restart:
```bash
curl -X POST http://localhost:3002/logs/clear
# Restart payment service
```

## References

- [Stellar JavaScript SDK](https://developers.stellar.org/docs/building-apps/js-stellar-sdk)
- [Horizon API Documentation](https://developers.stellar.org/api/introduction/index.html)
- [Transaction Building Guide](https://developers.stellar.org/docs/building-apps/connect-to-testnet)
- [Testnet Information](https://developers.stellar.org/docs/building-apps/connect-to-testnet)
