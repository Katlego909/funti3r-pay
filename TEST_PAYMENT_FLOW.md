# Test Payment Flow - Quick Start

## ✅ Setup Complete

All services and test data are ready. Here's how to test end-to-end cross-border payments:

### Test Credentials

**Enterprise User:**
```
Email:    enterprise@test.funti3r.com
User ID:  550e8400-e29b-41d4-a716-446655440000
Wallet:   GB7VG3ONGDRPTW3OS3ZPHQPZ6FQFBBBZ5V4QJGWQWCKGZQMVQXTCXWJ
Status:   ✓ Active platform wallet
```

**Worker User:**
```
Email:    worker@test.funti3r.com
User ID:  550e8400-e29b-41d4-a716-446655440001
Wallet:   CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF (SmartWallet)
Status:   ✓ KYC Verified
```

### Services Running

- **Enterprise Dashboard**: http://localhost:3102
- **User Service**: http://localhost:3001 ✓
- **Payment Service**: http://localhost:3002 ✓
- **Compliance Service**: http://localhost:3003 ✓

---

## 🔧 How to Create a Payment

### Step 1: Open Dashboard
```
Browser: http://localhost:3102
```

### Step 2: Navigate to Payments
Click the **"Payments"** page in the sidebar

### Step 3: Create New Payment
Click **"+ New Payment"** button

Fill in the form:
```
Worker ID:           550e8400-e29b-41d4-a716-446655440001
Amount:              100
Currency:            USD
Destination Country: NG (Nigeria)
Recipient Name:      Test Worker (optional)
```

### Step 4: Select Payment Rail
The system fetches available rails for the destination country.

For testnet, you'll see:
- **Stellar** (always available, uses XLM)

Click **"Send Payment"**

### Step 5: Verify Payment
Wait 5-10 seconds. You should see:
- ✓ Payment submitted message
- ✓ Status transitions: PENDING → COMPLETED
- ✓ Transaction hash (clickable link)

---

## 📊 Verify on Stellar Testnet

After successful payment:

**Enterprise Account Activity:**
```
https://stellar.expert/explorer/testnet/account/GB7VG3ONGDRPTW3OS3ZPHQPZ6FQFBBBZ5V4QJGWQWCKGZQMVQXTCXWJ
```
Should show:
- Outgoing payment to worker SmartWallet
- Memo hash matching payment ID

**Transaction Details:**
```
https://stellar.expert/explorer/testnet/tx/{HASH}
```

---

## 🎯 Expected Behavior

### Happy Path (Payment Success)
```
1. Form submitted
2. Payment service creates payment record (status: PROCESSING)
3. Compliance check passes (KYC verified ✓)
4. Stellar transaction submitted
5. Horizon confirms transaction (status: COMPLETED)
6. UI updates with tx hash (clickable)
7. Payment appears in list with ✓ green status
```

### What Each Step Does

| Step | Service | Details |
|------|---------|---------|
| Form Submit | Dashboard | Validates input, calls API |
| Compliance Check | Compliance Service | Verifies worker KYC |
| Create Payment Record | Payment Service | Stores to PostgreSQL |
| Execute Transaction | Stellar SDK | Submits to testnet |
| Horizon Polling | Payment Service | Watches transaction |
| Status Update | Dashboard | Real-time status feed |

---

## 🔍 Debug / Troubleshoot

### Check Payment Records
```sql
-- In PostgreSQL:
SELECT id, worker_id, amount, currency, status, stellar_tx_hash, created_at
FROM payments
WHERE worker_id = '550e8400-e29b-41d4-a716-446655440001'
ORDER BY created_at DESC
LIMIT 10;
```

### Check Service Logs
```bash
# View real-time payment service logs (in separate terminal)
pnpm --filter @funti3r/payment-service dev 2>&1 | grep -i "payment\|error"
```

### Test Enterprise Wallet Balance
```bash
curl http://localhost:3002/wallets/550e8400-e29b-41d4-a716-446655440000
```

### Force Friendbot Funding (if needed)
```bash
curl "https://friendbot.stellar.org/?addr=GB7VG3ONGDRPTW3OS3ZPHQPZ6FQFBBBZ5V4QJGWQWCKGZQMVQXTCXWJ"
```

---

## 📚 What's Happening Behind the Scenes

### 1. **Enterprise Wallet** (Platform-Custodial)
- Type: Stellar account keypair (managed by platform)
- Custody: Platform holds encrypted secret key in database
- Signing: Platform signs transactions on behalf of enterprise
- Security: AES-256-GCM encryption with MASTER_ENCRYPTION_KEY

### 2. **Worker Wallet** (Non-Custodial SmartWallet)
- Type: Soroban contract (P-256 authenticated)
- Custody: Worker controls via WebAuthn passkey
- Signing: Requires worker's biometric/PIN (never shared)
- Security: secp256r1_verify on-chain

### 3. **Payment Route**
```
Enterprise Dashboard
        ↓
    API Call
        ↓
Payment Service (authorize, route)
        ↓
Compliance Check (KYC verified)
        ↓
Stellar SDK
        ↓
Stellar Testnet
        ↓
Worker SmartWallet Contract
```

### 4. **Settlement**
- **Testnet**: XLM (Lumens)
- **Production**: USDC (if configured)
- **Fallback**: Testnet always uses XLM if USDC not available

---

## 🚀 Next Steps

### Single Payment Working?
- ✓ Verify transaction on Stellar Expert
- → Try **batch payments** (multiple workers at once)
- → Test **external wallet signing** (Freighter)
- → Configure **fiat rails** (Moneygram, Flutterwave)

### Ready for Production?
- [ ] Set `NODE_ENV=production`
- [ ] Use real Stellar public network
- [ ] Configure fiat rail API keys
- [ ] Set up KYC provider webhooks
- [ ] Enable production encryption keys (KMS)
- [ ] Deploy to cloud (AWS, GCP, etc.)
- [ ] Set up monitoring (Datadog, CloudWatch)

---

## 💡 Tips

- **Browser DevTools**: Check Network tab to see API calls
- **PostgreSQL**: Query tables to verify data flow
- **Logs**: Watch payment service output for errors
- **Testnet Free XLM**: Create unlimited accounts via Friendbot
- **Idempotency**: Payments are idempotent (safe to retry)

---

**Questions?** Check PAYMENT_TESTING_GUIDE.md for detailed troubleshooting
