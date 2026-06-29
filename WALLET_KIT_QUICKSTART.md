# Stellar Wallet Kit — Quick Start Guide

## 30-Second Overview

Funti3r-Pay now supports external (non-custodial) Stellar wallets. Users can connect Freighter, Albedo, Rabet, or MySteller wallets to make cross-border payments without the platform holding their private keys.

## For Users

### Linking Your Wallet (2 minutes)

1. **Go to Payments** page in Enterprise Dashboard
2. **Click "Link External Wallet"**
3. **Select your wallet provider** (Freighter, Albedo, etc.)
4. **Click "Link Wallet"**
5. Your wallet extension will prompt for approval
6. **Done!** Wallet is now linked to your account

### Making a Payment with External Wallet (3 minutes)

1. **Go to Payments** → **New Payment**
2. **Choose "Pay From"** dropdown and select your external wallet
3. **Fill in payment details**:
   - Worker email or ID
   - Amount
   - Currency (USD, EUR, XLM, etc.)
   - Destination country
4. **Click "Send Payment"**
5. **Review the signing modal**
6. **Click "Sign Transaction"**
7. Your wallet extension opens → **approve signing**
8. **Paste the signed transaction** in the prompt
9. **Done!** Payment submitted to Stellar

## For Developers

### Running Locally

```bash
# 1. Start services
pnpm dev

# 2. Create enterprise user
# (existing flow)

# 3. Test wallet linking
curl -X POST http://localhost:3002/wallets/external/link-request \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your-user-id",
    "walletProvider": "freighter"
  }'
```

### Integration in Your Code

```typescript
// Import components
import WalletLinking from './components/WalletLinking';
import WalletSelector from './components/WalletSelector';
import ExternalWalletSigningModal from './components/ExternalWalletSigningModal';

// In your payment form:
const [selectedWalletId, setSelectedWalletId] = useState('');
const [signingOpen, setSigningOpen] = useState(false);
const [paymentXDR, setPaymentXDR] = useState('');

// User selects wallet
<WalletSelector 
  userId={userId}
  onSelect={(wallet) => setSelectedWalletId(wallet.id)}
/>

// Submit payment
const result = await fetch('/api/payouts', {
  method: 'POST',
  body: JSON.stringify({
    enterpriseId, workerId, amount, currency, destinationCountry,
    signerWalletId: selectedWalletId // NEW: external wallet ID
  })
});

// If HTTP 202: return unsigned XDR, show signing modal
if (result.status === 202) {
  const { unsignedXDR, walletProvider } = await result.json();
  setPaymentXDR(unsignedXDR);
  setSigningOpen(true);
}

// Signing modal handles the rest
<ExternalWalletSigningModal
  isOpen={signingOpen}
  unsignedXDR={paymentXDR}
  walletProvider={walletProvider}
  onSuccess={(txHash) => {
    // Payment completed
  }}
/>
```

### API Endpoints

**Wallet Linking:**
```
POST   /wallets/external/link-request        → Challenge
POST   /wallets/external/verify              → Link wallet
GET    /wallets/:userId/external             → List wallets
PUT    /wallets/external/disconnect/:id      → Unlink wallet
```

**Payments:**
```
POST   /payouts (+ signerWalletId)           → HTTP 202 + XDR
POST   /payouts/submit-signature             → Submit signed XDR
```

### Environment Variables

No new environment variables required. Uses existing:
- `STELLAR_NETWORK` (TESTNET or MAINNET)
- `STELLAR_HORIZON_URL`
- `STELLAR_SOROBAN_URL`

## Architecture

### Data Flow

```
User links wallet:
  Challenge generation
  ↓
  User signs with wallet extension
  ↓
  Signature verification (Ed25519)
  ↓
  Wallet stored in DB (public key only, no secrets)

User makes payment:
  1. Select external wallet
  ↓
  2. Submit payment request
  ↓
  3. Server generates unsigned XDR
  ↓
  4. Return to client (HTTP 202)
  ↓
  5. User signs with wallet extension
  ↓
  6. Submit signed XDR to server
  ↓
  7. Server submits to Stellar
  ↓
  8. Transaction confirmed
```

## Security Model

| Aspect | Platform Wallet | External Wallet |
|--------|---|---|
| **Secret Storage** | Encrypted in DB | Never stored |
| **Signing** | Server-side | Client-side |
| **Key Control** | Platform | User |
| **Recovery** | Lost if user loses access | User recovers via wallet backup |
| **Trust Model** | Custodial | Non-custodial |

## Common Questions

**Q: Can I use the same wallet for multiple accounts?**
A: No, each wallet can only be linked to one Funti3r account.

**Q: What if I lose my wallet?**
A: You can disconnect and link a different wallet. Your payment history remains.

**Q: How long does linking take?**
A: Usually < 30 seconds. Challenge expires after 15 minutes.

**Q: Can I revoke linked wallets?**
A: Yes, click "Disconnect" next to any linked wallet.

**Q: What happens to payments while signing?**
A: Nothing — the payment waits in PENDING status until you submit the signed XDR.

**Q: Can someone else sign my transactions?**
A: No — only your wallet has the private key to sign.

## Troubleshooting

### "Wallet not found"
- Check wallet is installed as browser extension
- Reload the page
- Try different wallet provider

### "Signature verification failed"
- Ensure you signed with the correct wallet
- Check challenge hasn't expired (15 min limit)
- Try requesting a new challenge

### "Payment submission failed"
- Check account has XLM for fees
- Verify trustline for target asset exists
- Check Horizon for detailed error

### XDR signing prompt doesn't appear
- Check browser console for errors
- Try refreshing page
- Test with different wallet provider

## Next Features

Coming soon:
- Hardware wallet support (Ledger)
- Mobile app wallet integration
- Batch payment signing
- Multi-signature support
- Spending limits

## Support

- **Documentation**: See `WALLET_KIT_INTEGRATION.md`
- **Testing**: See `WALLET_KIT_TESTING_GUIDE.md`
- **Issues**: File GitHub issue with error details

## Code Locations

**Backend:**
- Routes: `services/payment-service/src/routes/wallet-linking.ts`
- Utilities: `services/payment-service/src/lib/wallet-kit-integration.ts`
- Payment logic: `services/payment-service/src/index.ts`

**Frontend:**
- Components: `apps/enterprise-dashboard/src/components/Wallet*.tsx`
- Styles: `apps/enterprise-dashboard/src/styles/Wallet*.css`

**Database:**
- Schema: `packages/database/src/migrations/schema.ts`
- Types: `packages/shared-types/src/index.ts`

## Version Info

**Implementation Date**: June 2026  
**Version**: 1.0.0  
**Status**: Stable  
**Supported Networks**: Testnet, Mainnet  
**Supported Wallets**: Freighter, Albedo, Rabet, MySteller  

---

**Ready to get started?** Jump to the integration section or check out the full guides in the repo root.
