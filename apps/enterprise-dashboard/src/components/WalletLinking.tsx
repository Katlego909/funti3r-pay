import { useState } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { Account, TransactionBuilder, Memo, Operation, BASE_FEE } from '@stellar/stellar-sdk';

interface WalletLinkingProps {
  userId: string;
  onLinked?: () => void;
}

export default function WalletLinking({ userId, onLinked }: WalletLinkingProps) {
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!window.__walletKitReady) {
      setError('Wallet kit not ready');
      return;
    }

    if (isLinking) return;

    setIsLinking(true);
    setError(null);

    try {
      console.log('[WalletLinking] Opening wallet modal');
      await StellarWalletsKit.authModal();

      console.log('[WalletLinking] Getting wallet address');
      const { address } = await StellarWalletsKit.getAddress();

      if (!address) {
        setIsLinking(false);
        return;
      }

      console.log('[WalletLinking] Got address:', address.substring(0, 10) + '...');

      // Request challenge
      console.log('[WalletLinking] Requesting challenge');
      const challengeResp = await fetch('/api/wallets/external/link-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, walletProvider: 'albedo' }),
      });

      if (!challengeResp.ok) throw new Error('Challenge request failed');
      const { challenge } = await challengeResp.json();

      // Create transaction
      console.log('[WalletLinking] Creating transaction');
      const testnetPassphrase = 'Test SDF Network ; September 2015';
      const account = new Account(address, '0');
      const txn = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: testnetPassphrase,
        memo: Memo.text(challenge.substring(0, 28)),
      })
        .addOperation(Operation.bumpSequence({ bumpTo: '1' }))
        .setNetworkPassphrase(testnetPassphrase)
        .setTimeout(0)
        .build();

      const xdr = txn.toXDR();

      // Sign with wallet
      console.log('[WalletLinking] Signing with wallet', { xdrPreview: xdr.substring(0, 50) });
      let signResult;
      try {
        signResult = await StellarWalletsKit.signTransaction(xdr);
      } catch (signErr) {
        console.error('[WalletLinking] Wallet signing error:', signErr);
        throw new Error(`Wallet signing failed: ${signErr instanceof Error ? signErr.message : String(signErr)}`);
      }

      console.log('[WalletLinking] Got wallet response:', {
        hasSignedTxXdr: !!signResult?.signedTxXdr,
        signedTxXdrType: typeof signResult?.signedTxXdr,
        signedTxXdrLength: signResult?.signedTxXdr?.length,
        signedTxXdrPreview: signResult?.signedTxXdr?.substring(0, 50),
        fullResponse: JSON.stringify(signResult),
      });

      const signedXdr = signResult?.signedTxXdr;
      if (!signedXdr || typeof signedXdr !== 'string') {
        throw new Error(`Invalid signed XDR: expected string, got ${typeof signedXdr}. Response: ${JSON.stringify(signResult)}`);
      }

      // Verify
      console.log('[WalletLinking] Verifying with backend', {
        signedXdrLength: signedXdr.length,
        signedXdrPreview: signedXdr.substring(0, 50),
      });

      const payload = {
        userId,
        publicKey: address,
        challenge,
        signature: signedXdr,
        walletProvider: 'albedo',
      };

      console.log('[WalletLinking] Sending verification payload:', {
        ...payload,
        signature: payload.signature.substring(0, 50) + '...',
      });

      const verifyResp = await fetch('/api/wallets/external/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!verifyResp.ok) {
        const errText = await verifyResp.text();
        throw new Error(`Verification failed: ${errText}`);
      }

      console.log('[WalletLinking] Success!');
      onLinked?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WalletLinking] Error:', msg);
      setError(msg);
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        onClick={handleClick}
        disabled={isLinking || !window.__walletKitReady}
        style={{
          padding: '12px 24px',
          backgroundColor: window.__walletKitReady ? '#2563eb' : '#ccc',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: window.__walletKitReady && !isLinking ? 'pointer' : 'not-allowed',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        {isLinking ? 'Connecting Wallet...' : 'Connect Wallet'}
      </button>

      {error && (
        <div style={{ padding: '8px', backgroundColor: '#fee', color: '#c33', borderRadius: '4px', fontSize: '12px' }}>
          {error}
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    __walletKitReady: boolean;
  }
}
