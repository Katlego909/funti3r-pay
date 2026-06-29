# Payment Testing Guide

This guide walks you through creating and testing cross-border payments from the Enterprise Dashboard to worker SmartWallets on Stellar testnet.

## Prerequisites

- ✅ Docker containers running: PostgreSQL, Redis, MongoDB
- ✅ Services running: User Service, Payment Service, Compliance Service
- ✅ Enterprise Dashboard running (typically on port 3100, may be on 3103 if ports are in use)
- ✅ Stellar testnet configured in `.env.local`

## Architecture Overview

### User Types
- **Enterprise**: Platform-custodial. Platform holds encrypted keypair in DB. Enterprise can sign transactions.
- **Worker**: Non-custodial. Each worker has a Soroban SmartWallet contract deployed. Auth is gated by WebAuthn passkey.

### Payment Flow
1. Enterprise user creates a payment in dashboard
2. Payment service routes to appropriate rail (Stellar XLM by default on testnet)
3. If using platform wallet: signed immediately and submitted to Stellar
4. If using external wallet (Freighter, Albedo): returns unsigned XDR for user to sign in their wallet
5. Worker receives funds in their SmartWallet

## Step 1: Create Test Users

### Option A: Automated Setup (Simulated WebAuthn)

Run the test data setup script:

```bash
cd c:\Users\katle\funti3r-pay
pnpm exec tsx setup-test-data.ts
```

This creates:
- **Enterprise user**: `enterprise@test.funti3r.com` (will have a platform wallet)
- **Worker user**: `worker@test.funti3r.com` (will have SmartWallet deployed)
- Both users will be verified and ready for payments

The script outputs:
```
Enterprise credentials:
  Email: enterprise@test.funti3r.com
  User ID: <uuid>
  Stellar Account: G...

Worker credentials:
  Email: worker@test.funti3r.com
  User ID: <uuid>
  SmartWallet: C...
```

### Option B: Manual Registration via Browser (More Realistic)

For a true end-to-end test:

1. **Open Enterprise Dashboard**
   ```
   http://localhost:3103  (or 3100 if available)
   ```

2. **Register Enterprise User**
   - Click "Register as Enterprise"
   - Email: `enterprise-test@yourdomain.com`
   - Use your system's biometric/PIN (Windows Hello, Touch ID, etc.)
   - ✅ User created with encrypted platform wallet, automatically funded via Friendbot

3. **Register Worker User** (in separate browser or incognito)
   - Click "Register as Worker"
   - Email: `worker-test@yourdomain.com`
   - Use your system's biometric/PIN
   - ✅ Worker SmartWallet deploys to Soroban testnet (async, may take 10-30 seconds)
   - ✅ Check deployment status via GET `/wallets/{userId}/deployment-status`

## Step 2: Fund Enterprise Wallet (if needed)

The enterprise wallet is automatically funded on registration via Friendbot if on testnet.

To check balance:
```bash
curl http://localhost:3002/wallets/<enterprise-user-id>
# Returns: { userId, walletType, address, balances }
```

Or manually fund:
```bash
# Using Stellar's official testnet Friendbot
curl "https://friendbot.stellar.org/?addr=<public-key>"
```

## Step 3: Create and Send Payment

1. **Log in to Enterprise Dashboard**
   - Email: Your enterprise user email
   - Authenticate with WebAuthn

2. **Navigate to Payments page**
   - Click "Payments" in sidebar

3. **Create New Payment**
   - Click "+ New Payment" button
   - **Worker ID**: Paste the worker's UUID (from registration or setup script)
   - **Amount**: `100` (XLM)
   - **Currency**: `USD` or `XLM`
   - **Destination Country**: `NG` (Nigeria) or your choice
   - **Recipient Name**: (optional)

4. **Select Payment Rail**
   - System fetches quotes for available rails
   - For testnet, "stellar" rail will be available (default)
   - Other rails (Moneygram, Flutterwave) only appear if API keys are configured

5. **Choose Signer (Optional)**
   - **Platform Wallet** (default): Uses enterprise's encrypted private key
   - **External Wallet**: Opens signing modal for Freighter/Albedo (if configured)

6. **Submit Payment**
   - Click "Send Payment"
   - ✅ Payment submitted to Stellar testnet
   - ✅ Transaction hash appears after ~5-10 seconds (Horizon confirms)
   - Payment status transitions: PENDING → PROCESSING → COMPLETED

## Step 4: Verify Payment

### In Dashboard
- Payments page shows new payment with:
  - Worker ID
  - Amount & Currency
  - Status (COMPLETED)
  - Stellar transaction hash (clickable link to Stellar Expert)

### On Stellar Testnet
- Visit: `https://stellar.expert/explorer/testnet/tx/<tx-hash>`
- See operations:
  - Payment from enterprise account → worker SmartWallet contract
  - Memo hash = payment ID (for correlation)

### In Database
```sql
-- Check payment record
SELECT id, enterprise_id, worker_id, amount, currency, status, stellar_tx_hash
FROM payments
WHERE worker_id = '<worker-id>'
ORDER BY created_at DESC
LIMIT 5;

-- Check worker wallet received funds
SELECT contract_address, status
FROM wallets
WHERE user_id = '<worker-id>' AND wallet_type = 'worker';
```

## Troubleshooting

### "Worker SmartWallet is still being deployed"
- Worker wallet deploys asynchronously (background task)
- Wait 30-60 seconds and retry
- Check deployment status:
  ```bash
  curl http://localhost:3002/wallets/<worker-id>/deployment-status
  ```

### "Worker KYC not verified"
- Compliance service auto-approves on testnet if `COMPLIANCE_AUTO_APPROVE=true`
- Or manually set KYC status:
  ```sql
  INSERT INTO kyc_records (user_id, tier, status, verified_at)
  VALUES ('<worker-id>', 'tier1', 'verified', NOW());
  ```

### Payment status stuck on PENDING
- Check payment service logs for Horizon submission errors
- Verify enterprise wallet is funded: `curl http://localhost:3002/wallets/<enterprise-id>`
- Check balance on Stellar Expert: https://stellar.expert/explorer/testnet/account/<public-key>

### "Port X already in use"
- Services default to specific ports; if in use, they increment
- Check which port a service is actually running on in the startup logs
- Update dashboard URL accordingly (3103, 3104, etc.)

## Testing Scenarios

### 1. Basic Platform Wallet Payment
1. Create enterprise + worker users
2. Send 100 USD via Stellar rail
3. Verify transaction on Stellar Expert

### 2. External Wallet Signing
1. Link external wallet (Freighter) to enterprise user account
2. Create payment with "External Wallet" signer
3. Sign transaction in Freighter modal
4. Verify signed transaction submitted

### 3. Batch Payments (Coming Soon)
```bash
curl -X POST http://localhost:3002/payouts/batch \
  -H 'Content-Type: application/json' \
  -d '{
    "enterpriseId": "<enterprise-id>",
    "payments": [
      { "workerId": "<worker-1>", "amount": 50, "currency": "USD", "destinationCountry": "NG" },
      { "workerId": "<worker-2>", "amount": 75, "currency": "USD", "destinationCountry": "GH" }
    ],
    "idempotencyKey": "'$(uuidgen)'"
  }'
```

### 4. Fiat Rail Testing
- Configure fiat rail API keys in `.env.local`:
  - `MONEYGRAM_API_KEY`, `FLUTTERWAVE_SECRET_KEY`, etc.
- Select fiat rail in payment form
- Payment routes to external provider instead of Stellar

## Environment Variables

Check `.env.local` for:
- `STELLAR_NETWORK=TESTNET` ✅
- `STELLAR_OPERATOR_SECRET=S...` ✅ (for wallet deployment)
- `COMPLIANCE_AUTO_APPROVE=true` (optional, for quick testing)
- `MASTER_ENCRYPTION_KEY=...` ✅ (for enterprise wallet encryption)

## Viewing Logs

Services use structured logging. View real-time logs:

```bash
# Payment service
tail -f logs/payment-service.log

# User service
tail -f logs/user-service.log

# Compliance service
tail -f logs/compliance-service.log
```

## Next Steps

- ✅ Basic payment flow tested
- [ ] Test with multiple workers
- [ ] Test external wallet integration (Freighter)
- [ ] Configure fiat rails
- [ ] Set up production deployment
- [ ] Monitor live payments with observability stack
