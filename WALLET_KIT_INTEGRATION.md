# Stellar Wallet Kit Integration Guide

## Overview

This document describes how to integrate the Stellar Wallet Kit external wallet support into the Funti3r-Pay payment platform.

## Phases Completed

### Phase 1: Database & Types ✅
- Added columns to `wallets` table for external wallet support
- Created `wallet_metadata` table for provider-specific config
- Added `signer_wallet_id` to `payments` table
- Updated shared types with new enums and interfaces

**Files Modified:**
- `packages/database/src/migrations/schema.ts`
- `packages/shared-types/src/index.ts`

### Phase 2: Backend Infrastructure ✅
- Wallet linking endpoints for challenge-response verification
- Wallet Kit integration utilities (signature verification, challenge generation)
- Registered routes in payment service

**Files Created:**
- `services/payment-service/src/routes/wallet-linking.ts` (5 endpoints)
- `services/payment-service/src/lib/wallet-kit-integration.ts` (utilities)

**New Endpoints:**
- `POST /wallets/external/link-request` - Generate verification challenge
- `POST /wallets/external/verify` - Verify signature and link wallet
- `GET /wallets/external/metadata/:walletId` - Get wallet metadata
- `PUT /wallets/external/disconnect/:walletId` - Disconnect wallet
- `GET /wallets/:userId/external` - List user's external wallets

### Phase 3: Payment Signing Flow ✅
- Unsigned transaction builders for external wallets
- Updated `/payouts` endpoint to support dual signing paths
- New `/payouts/submit-signature` endpoint for externally-signed transactions

**Files Modified:**
- `services/payment-service/src/lib/stellar.ts` (added 3 functions)
- `services/payment-service/src/index.ts` (updated /payouts, added /payouts/submit-signature)

**New Stellar Functions:**
- `prepareUnsignedPayment()` - Create unsigned XDR for external signing
- `prepareUnsignedPathPayment()` - Path payment variant
- `submitSignedTransaction()` - Submit after external signing

### Phase 4: Frontend Components ✅
Three new React components for handling wallet connection and signing:

**Components Created:**

1. **`WalletLinking.tsx`** - Link external wallets
   - Provider selection (Freighter, Albedo, Rabet, MySteller)
   - Challenge-response verification flow
   - Success/error states
   - Location: `apps/enterprise-dashboard/src/components/WalletLinking.tsx`

2. **`WalletSelector.tsx`** - Choose wallet for payment
   - Lists both platform and external wallets
   - Auto-loads from API
   - Selection state management
   - Location: `apps/enterprise-dashboard/src/components/WalletSelector.tsx`

3. **`ExternalWalletSigningModal.tsx`** - Sign transactions
   - Displays unsigned XDR
   - Step-by-step signing instructions
   - Progress states (waiting, signing, submitting, success, error)
   - Location: `apps/enterprise-dashboard/src/components/ExternalWalletSigningModal.tsx`

**Styling:**
- `apps/enterprise-dashboard/src/styles/WalletLinking.css`
- `apps/enterprise-dashboard/src/styles/WalletSelector.css`
- `apps/enterprise-dashboard/src/styles/ExternalWalletSigningModal.css`

## Integration into Payments Page

To integrate the wallet kit components into the Payments page, follow these steps:

### Step 1: Import Components
```typescript
import WalletLinking from '../components/WalletLinking.tsx';
import WalletSelector, { type Wallet } from '../components/WalletSelector.tsx';
import ExternalWalletSigningModal from '../components/ExternalWalletSigningModal.tsx';
```

### Step 2: Add State Variables
```typescript
const [selectedWalletId, setSelectedWalletId] = useState<string>('');
const [walletModalOpen, setWalletModalOpen] = useState(false);
const [linkedWallets, setLinkedWallets] = useState<Wallet[]>([]);

// For signing modal
const [signingModalOpen, setSigningModalOpen] = useState(false);
const [pendingPaymentId, setPendingPaymentId] = useState('');
const [unsignedXDR, setUnsignedXDR] = useState('');
const [signerProvider, setSignerProvider] = useState('');
```

### Step 3: Update Payment Submission
```typescript
async function handleSend(e: FormEvent) {
  e.preventDefault();
  setFormError('');
  setFormSuccess('');
  setSubmitting(true);

  try {
    const result = await initiatePayment({
      enterpriseId: user!.userId,
      workerId,
      amount: Number(amount),
      currency,
      destinationCountry: country,
      idempotencyKey: crypto.randomUUID(),
      preferFiat: selectedQuote?.rail !== 'stellar',
      quoteId: selectedQuote?.quoteId,
      recipientName: recipientName || undefined,
      signerWalletId: selectedWalletId || undefined, // NEW: pass selected wallet
    });

    // NEW: Check if payment requires external signing (HTTP 202)
    if (result.status === 202) {
      setPendingPaymentId(result.paymentId);
      setUnsignedXDR(result.unsignedXDR);
      setSignerProvider(result.walletProvider);
      setSigningModalOpen(true);
      return;
    }

    // Platform wallet path (existing flow)
    setFormSuccess(`Payment submitted — ${result.rail} — ${result.status}`);
    setFormOpen(false);
    loadPayments();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Payment failed';
    setFormError(msg);
  } finally {
    setSubmitting(false);
  }
}
```

### Step 4: Add Wallet Selector to Payment Form
```typescript
// In the payment form JSX, add before the "Send Payment" button:
<WalletSelector
  userId={user!.userId}
  onSelect={(wallet) => setSelectedWalletId(wallet.id)}
  selectedWalletId={selectedWalletId}
/>
```

### Step 5: Add Components to JSX
```typescript
// Add to the JSX return:
{walletModalOpen && (
  <WalletLinking
    userId={user!.userId}
    onLinked={() => {
      setWalletModalOpen(false);
      // Reload wallet list if needed
    }}
  />
)}

<ExternalWalletSigningModal
  isOpen={signingModalOpen}
  paymentId={pendingPaymentId}
  unsignedXDR={unsignedXDR}
  walletProvider={signerProvider}
  onClose={() => setSigningModalOpen(false)}
  onSuccess={(txHash) => {
    setSigningModalOpen(false);
    setFormSuccess(`Payment submitted with tx: ${txHash}`);
    setFormOpen(false);
    loadPayments();
  }}
/>

{/* Link to open wallet linking modal */}
<button onClick={() => setWalletModalOpen(true)} className="btn btn-secondary btn-small">
  Link External Wallet
</button>
```

## API Integration

### Wallet Linking Flow
```
1. GET /wallets/external/link-request (userId, walletProvider)
   → Returns: { challenge, walletProvider, expiresAt }

2. User signs challenge with wallet extension
   → Gets: signature (hex-encoded)

3. POST /wallets/external/verify
   → Body: { userId, publicKey, challenge, signature, walletProvider }
   → Returns: { walletId, publicKey, walletProvider, status }

4. GET /wallets/:userId/external
   → Returns: List of external wallets for user
```

### Payment with External Wallet
```
1. POST /payouts (with signerWalletId for external wallet)
   → If external: Returns HTTP 202 with { paymentId, unsignedXDR, walletProvider }
   → If platform: Returns HTTP 201 (existing flow)

2. User signs XDR with wallet extension

3. POST /payouts/submit-signature
   → Body: { paymentId, signedXDR }
   → Returns: { paymentId, status, stellarTxHash }
```

## Frontend API Helpers

Add these helper functions to `apps/enterprise-dashboard/src/api/wallets.ts`:

```typescript
export async function requestWalletLinkChallenge(
  userId: string,
  walletProvider: string
): Promise<{ challenge: string; expiresAt: Date }> {
  const resp = await fetch('/api/wallets/external/link-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, walletProvider }),
  });
  if (!resp.ok) throw new Error('Failed to request challenge');
  return resp.json();
}

export async function verifyWalletSignature(
  userId: string,
  publicKey: string,
  challenge: string,
  signature: string,
  walletProvider: string
): Promise<{ walletId: string; publicKey: string; walletProvider: string }> {
  const resp = await fetch('/api/wallets/external/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, publicKey, challenge, signature, walletProvider }),
  });
  if (!resp.ok) throw new Error('Verification failed');
  return resp.json();
}

export async function listExternalWallets(userId: string): Promise<Wallet[]> {
  const resp = await fetch(`/api/wallets/${userId}/external`);
  if (!resp.ok) throw new Error('Failed to list wallets');
  const data = await resp.json();
  return data.wallets;
}
```

## Wallet Kit Libraries (Optional)

For production, integrate actual wallet SDK libraries:

### Freighter
```bash
pnpm add @stellar/freighter-api
```

### Albedo
```bash
pnpm add @albedo-link/intent
```

### Rabet
```bash
pnpm add rabet
```

Then update `ExternalWalletSigningModal.tsx` to use actual wallet SDK methods instead of `prompt()`.

## Testing Checklist

- [ ] Wallet linking: Challenge generation and signature verification
- [ ] External wallet list retrieval and filtering
- [ ] Payment with external wallet returns HTTP 202 + unsigned XDR
- [ ] Signature submission for externally-signed payments
- [ ] Platform wallet payments still work (HTTP 201 path)
- [ ] Error handling for invalid signatures and mismatched wallets
- [ ] Database constraints prevent duplicate wallet links
- [ ] Audit logs record wallet linking and signing events

## Security Considerations

1. **No Secret Storage**: External wallets never store private keys
2. **Challenge Expiry**: Challenges expire after 15 minutes
3. **Signature Verification**: Ed25519 signatures verified server-side
4. **Audit Trail**: All wallet operations logged in `audit_logs` table
5. **Public Key Verification**: Wallet ownership proven via signature challenge
6. **Network Isolation**: Separate wallet types prevent unauthorized access

## Next Steps

1. **Browser Wallet SDK Integration**: Replace prompt-based signing with actual wallet extensions
2. **Multi-signature**: Support multiple signers for enterprise approvals
3. **Wallet Recovery**: Allow users to recover/manage linked wallets
4. **Mobile Support**: Extend to worker mobile app with QR code signing
5. **Batch Operations**: Support batch payments with external wallets

## Support

For questions or issues, refer to:
- Backend: `services/payment-service/src/routes/wallet-linking.ts`
- Frontend: `apps/enterprise-dashboard/src/components/Wallet*.tsx`
- Types: `packages/shared-types/src/index.ts`
