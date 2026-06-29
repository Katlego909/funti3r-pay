# Stellar Wallet Kit Testing Guide

## Test Environment Setup

### Prerequisites
- Payment service running: `pnpm --filter @funti3r/payment-service dev`
- Compliance service running: `pnpm --filter @funti3r/compliance-service dev`
- PostgreSQL running (via docker-compose)
- Enterprise dashboard running: `pnpm --filter @funti3r/enterprise-dashboard dev`

### Test Data
Use these test accounts:
- Enterprise user: `enterprise@test.funti3r.io`
- Worker user: `worker@test.funti3r.io`

## Test Plan

### Phase 1: Wallet Linking

#### Test 1.1: Challenge Generation
```bash
curl -X POST http://localhost:3002/wallets/external/link-request \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "enterprise-user-id",
    "walletProvider": "freighter"
  }'
```

**Expected Response (HTTP 200):**
```json
{
  "challenge": "Challenge:...",
  "walletProvider": "freighter",
  "expiresAt": "2026-...",
  "expiresIn": 900000
}
```

**Test Cases:**
- ✓ Valid provider (freighter, albedo, rabet, mystellar)
- ✓ Invalid provider → HTTP 400
- ✓ Missing userId → HTTP 400
- ✓ Missing walletProvider → HTTP 400

#### Test 1.2: Signature Verification & Wallet Linking
```bash
# First get a challenge
CHALLENGE=$(curl -s -X POST http://localhost:3002/wallets/external/link-request \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user", "walletProvider": "freighter"}' | jq -r '.challenge')

# Sign with wallet (generate signature)
# In test: use Keypair.fromSecret() to sign the challenge

curl -X POST http://localhost:3002/wallets/external/verify \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "publicKey": "GXXXXXX...",
    "challenge": "'"$CHALLENGE"'",
    "signature": "hex-encoded-signature",
    "walletProvider": "freighter"
  }'
```

**Expected Response (HTTP 201):**
```json
{
  "walletId": "uuid",
  "publicKey": "GXXXXXX...",
  "walletProvider": "freighter",
  "status": "connected",
  "message": "Wallet linked successfully"
}
```

**Test Cases:**
- ✓ Valid signature → HTTP 201, wallet created
- ✓ Invalid signature → HTTP 400
- ✓ Duplicate wallet link → HTTP 409
- ✓ Wallet already linked to different user → HTTP 409
- ✓ Missing fields → HTTP 400

#### Test 1.3: List External Wallets
```bash
curl http://localhost:3002/wallets/user-id/external
```

**Expected Response (HTTP 200):**
```json
{
  "wallets": [
    {
      "id": "wallet-id",
      "publicKey": "GXXXXXX...",
      "walletProvider": "freighter",
      "status": "active",
      "connectionStatus": "connected",
      "verifiedAt": "2026-..."
    }
  ]
}
```

**Test Cases:**
- ✓ User with external wallets
- ✓ User with no wallets → empty array
- ✓ Invalid user ID → 404

#### Test 1.4: Disconnect Wallet
```bash
curl -X PUT http://localhost:3002/wallets/wallet-id/external/disconnect \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-id"}'
```

**Expected Response (HTTP 200):**
```json
{
  "message": "Wallet disconnected successfully"
}
```

**Test Cases:**
- ✓ User's own wallet → success
- ✓ Different user's wallet → HTTP 403
- ✓ Non-existent wallet → HTTP 404

### Phase 2: Payment Signing Flow

#### Test 2.1: Payment with Platform Wallet (Existing Flow)
```bash
curl -X POST http://localhost:3002/payouts \
  -H "Content-Type: application/json" \
  -d '{
    "enterpriseId": "enterprise-user-id",
    "workerId": "worker-user-id",
    "amount": 100,
    "currency": "USD",
    "destinationCountry": "NG"
  }'
```

**Expected Response (HTTP 201):**
```json
{
  "paymentId": "uuid",
  "status": "completed|pending",
  "rail": "stellar|puntored|...",
  "stellarTxHash": "hash"
}
```

**Verification:**
- [ ] Payment created in database
- [ ] Status is PROCESSING or COMPLETED
- [ ] Stellar transaction submitted (if on stellar rail)
- [ ] Audit log records payment

#### Test 2.2: Payment with External Wallet
```bash
# First link an external wallet
# Then use its ID in the payment request

curl -X POST http://localhost:3002/payouts \
  -H "Content-Type: application/json" \
  -d '{
    "enterpriseId": "enterprise-user-id",
    "workerId": "worker-user-id",
    "amount": 100,
    "currency": "USD",
    "destinationCountry": "NG",
    "signerWalletId": "external-wallet-id"
  }'
```

**Expected Response (HTTP 202):**
```json
{
  "paymentId": "uuid",
  "status": "pending_signature",
  "walletProvider": "freighter",
  "unsignedXDR": "AAAAAgAAAA...",
  "message": "Sign the transaction with your wallet and submit it to /payouts/submit-signature"
}
```

**Verification:**
- [ ] Payment created with PENDING status
- [ ] Payment has signer_wallet_id set
- [ ] Unsigned XDR is valid (starts with AAAAAgAAAA or similar)
- [ ] XDR can be parsed by stellar-sdk
- [ ] Includes payment memo hash

#### Test 2.3: Submit Signed Transaction
```bash
# Sign the XDR with the wallet (in test: use Keypair.sign(xdr))
SIGNED_XDR="AAAAAgAAAA...[signed]" # Signed transaction envelope

curl -X POST http://localhost:3002/payouts/submit-signature \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "uuid",
    "signedXDR": "'"$SIGNED_XDR"'"
  }'
```

**Expected Response (HTTP 200):**
```json
{
  "paymentId": "uuid",
  "status": "completed",
  "stellarTxHash": "hash",
  "message": "Payment submitted successfully"
}
```

**Verification:**
- [ ] Payment status updated to COMPLETED
- [ ] Stellar transaction hash stored
- [ ] Transaction confirmed on Stellar network (check via Horizon)
- [ ] Audit log records signing event

#### Test 2.4: Error Handling
```bash
# Test with invalid XDR
curl -X POST http://localhost:3002/payouts/submit-signature \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "uuid",
    "signedXDR": "invalid"
  }'
```

**Expected:** HTTP 502 with error message

**Test Cases:**
- ✓ Invalid XDR → Error
- ✓ Non-existent payment → HTTP 404
- ✓ Non-pending payment → HTTP 409
- ✓ Submission failure → HTTP 502

### Phase 3: Database Integrity

#### Test 3.1: Wallet Table Constraints
```sql
-- Verify UNIQUE constraint on (user_id, wallet_type, is_external)
INSERT INTO wallets (user_id, wallet_type, is_external, public_key, status)
VALUES ('same-user', 'external', true, 'key1', 'active');

INSERT INTO wallets (user_id, wallet_type, is_external, public_key, status)
VALUES ('same-user', 'external', true, 'key2', 'active');
-- Should fail with UNIQUE constraint violation
```

#### Test 3.2: Wallet Metadata Relationship
```sql
-- Verify wallet_metadata cascade
SELECT COUNT(*) FROM wallet_metadata WHERE wallet_id IN (
  SELECT id FROM wallets WHERE is_external = true
);
-- Should have one metadata row per external wallet
```

#### Test 3.3: Payment Signer Reference
```sql
-- Verify signer_wallet_id references valid wallets
SELECT COUNT(*) FROM payments WHERE signer_wallet_id IS NOT NULL
  AND signer_wallet_id NOT IN (SELECT id FROM wallets);
-- Should return 0
```

### Phase 4: Frontend Integration

#### Test 4.1: Wallet Selector Component
- [ ] Loads and displays platform wallet
- [ ] Loads and displays linked external wallets
- [ ] Allows wallet selection
- [ ] Auto-selects first wallet if none selected
- [ ] Handles API errors gracefully

#### Test 4.2: Payment Form with External Wallet
- [ ] Select external wallet from dropdown
- [ ] Submit payment form
- [ ] API returns HTTP 202 with XDR
- [ ] Signing modal opens automatically
- [ ] Modal displays wallet provider info
- [ ] Steps are clear and actionable

#### Test 4.3: Signing Modal Flow
- [ ] Displays unsigned XDR preview
- [ ] Shows step-by-step instructions
- [ ] Sign button available
- [ ] Spinner shows during signing
- [ ] Success screen after signature submission
- [ ] Error state with retry option
- [ ] Modal can be closed at any point

#### Test 4.4: Wallet Linking Flow
- [ ] Provider dropdown works
- [ ] Challenge generated via API
- [ ] User prompted for wallet signing
- [ ] Success message shown
- [ ] Linked wallet appears in selector
- [ ] Error handling for invalid signatures

### Phase 5: Security Tests

#### Test 5.1: Signature Verification
- [ ] Invalid signature rejected
- [ ] Modified challenge rejected
- [ ] Signature verification uses correct public key
- [ ] Challenge expiry enforced (if implemented)

#### Test 5.2: Access Control
- [ ] User cannot link wallet to another user's account
- [ ] User cannot disconnect another user's wallet
- [ ] User cannot use another user's wallet for payment

#### Test 5.3: Audit Logging
- [ ] Wallet linking logged with user ID
- [ ] Wallet disconnection logged
- [ ] Payment signing logged
- [ ] All logs include timestamp and details

### Phase 6: Load Testing

#### Test 6.1: Concurrent Challenge Requests
```bash
# Generate 100 concurrent challenges
for i in {1..100}; do
  curl -X POST http://localhost:3002/wallets/external/link-request \
    -H "Content-Type: application/json" \
    -d "{\"userId\": \"user-$i\", \"walletProvider\": \"freighter\"}" &
done
wait
```

**Expected:** All requests succeed, no race conditions

#### Test 6.2: Concurrent Payment Submissions
- Multiple users submit payments simultaneously
- No database locking issues
- All payments created correctly

## Test Scripts

### Bash Test Script
Create `test-wallet-kit.sh`:

```bash
#!/bin/bash

API="http://localhost:3002"
USER_ID="test-user-$(date +%s)"
WALLET_PROVIDER="freighter"

echo "Testing Wallet Kit Integration..."

# Test 1: Generate challenge
echo "1. Generating challenge..."
CHALLENGE=$(curl -s -X POST $API/wallets/external/link-request \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"$USER_ID\", \"walletProvider\": \"$WALLET_PROVIDER\"}" | jq -r '.challenge')

if [ -z "$CHALLENGE" ]; then
  echo "❌ Failed to generate challenge"
  exit 1
fi
echo "✓ Challenge: ${CHALLENGE:0:30}..."

# Test 2: Create test keypair and sign
echo "2. Creating keypair..."
KEYPAIR=$(node -e "
  const { Keypair } = require('@stellar/stellar-sdk');
  const kp = Keypair.random();
  console.log(JSON.stringify({ public: kp.publicKey(), secret: kp.secret() }));
")
PUBLIC=$(echo $KEYPAIR | jq -r '.public')
SECRET=$(echo $KEYPAIR | jq -r '.secret')
echo "✓ Public Key: ${PUBLIC:0:20}..."

# Test 3: Sign challenge
echo "3. Signing challenge..."
SIGNATURE=$(node -e "
  const { Keypair } = require('@stellar/stellar-sdk');
  const kp = Keypair.fromSecret(process.argv[1]);
  const sig = kp.sign(Buffer.from(process.argv[2]));
  console.log(sig.toString('hex'));
" "$SECRET" "$CHALLENGE")
echo "✓ Signature: ${SIGNATURE:0:20}..."

# Test 4: Verify wallet
echo "4. Verifying wallet..."
RESULT=$(curl -s -X POST $API/wallets/external/verify \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"publicKey\": \"$PUBLIC\",
    \"challenge\": \"$CHALLENGE\",
    \"signature\": \"$SIGNATURE\",
    \"walletProvider\": \"$WALLET_PROVIDER\"
  }")

WALLET_ID=$(echo $RESULT | jq -r '.walletId')
if [ "$WALLET_ID" == "null" ] || [ -z "$WALLET_ID" ]; then
  echo "❌ Wallet verification failed"
  echo "$RESULT"
  exit 1
fi
echo "✓ Wallet ID: $WALLET_ID"

# Test 5: List wallets
echo "5. Listing external wallets..."
WALLETS=$(curl -s http://localhost:3002/wallets/$USER_ID/external | jq '.wallets | length')
if [ "$WALLETS" -lt 1 ]; then
  echo "❌ Wallet not listed"
  exit 1
fi
echo "✓ Found $WALLETS wallet(s)"

echo ""
echo "✅ All tests passed!"
```

## Manual Testing Checklist

### Wallet Linking
- [ ] Can request challenge without errors
- [ ] Challenge format is correct
- [ ] Can sign challenge with test keypair
- [ ] Wallet verification succeeds with valid signature
- [ ] Duplicate linking is prevented
- [ ] Can list linked wallets
- [ ] Can disconnect wallet

### Payment Flow
- [ ] Platform wallet payment completes (HTTP 201)
- [ ] External wallet payment returns XDR (HTTP 202)
- [ ] XDR can be parsed by stellar-sdk
- [ ] Signed XDR submission succeeds
- [ ] Payment status updated to COMPLETED
- [ ] Stellar transaction confirmed on Horizon

### Error Cases
- [ ] Invalid walletProvider returns 400
- [ ] Invalid signature returns 400
- [ ] Duplicate wallet link returns 409
- [ ] Invalid payment data returns 400
- [ ] Non-existent payment returns 404

## Performance Benchmarks

Target metrics:
- Challenge generation: < 100ms
- Signature verification: < 50ms
- Wallet listing: < 200ms
- Unsigned XDR generation: < 200ms
- Signed transaction submission: < 2s

Monitor with:
```bash
curl -w "Time: %{time_total}s\n" ...
```

## Deployment Checklist

Before deploying to production:

- [ ] All tests pass
- [ ] Code review completed
- [ ] Database migrations tested on staging
- [ ] Error messages are user-friendly
- [ ] Audit logging works correctly
- [ ] Performance is acceptable
- [ ] Security review completed
- [ ] Wallet provider SDKs integrated (optional)
- [ ] Documentation updated
- [ ] Team trained on new features

## Troubleshooting

### Challenge verification fails
- Check that signature matches the exact challenge string
- Ensure signature is hex-encoded
- Verify public key is valid Stellar format (G prefix)

### XDR submission fails
- Verify XDR comes from the same server that generated it
- Check network passphrase matches (testnet vs mainnet)
- Ensure account has sufficient balance
- Check Horizon for transaction error details

### Wallet not appearing in list
- Verify wallet status is 'active' in database
- Check is_external column is true
- Verify wallet belongs to correct user

### Integration issues
- Check API endpoints are registered in payment-service
- Verify database migrations ran successfully
- Ensure cors/auth middleware doesn't block wallet endpoints
- Check browser console for frontend errors
