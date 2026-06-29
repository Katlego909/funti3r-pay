import { useEffect, useState } from 'react';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { HiXMark, HiCheck, HiExclamationTriangle } from 'react-icons/hi2';
import '../styles/ExternalWalletSigningModal.css';

interface ExternalWalletSigningModalProps {
  isOpen: boolean;
  paymentId: string;
  unsignedXDR: string;
  walletProvider: string;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}

export default function ExternalWalletSigningModal({
  isOpen,
  paymentId,
  unsignedXDR,
  walletProvider,
  onClose,
  onSuccess,
}: ExternalWalletSigningModalProps) {
  const [stage, setStage] = useState<'waiting' | 'signing' | 'submitting' | 'success' | 'error'>('waiting');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setStage('waiting');
      setError('');
    }
  }, [isOpen]);

  async function handleSign() {
    setStage('signing');
    setError('');

    try {
      // Sign transaction with the wallet using the kit
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(unsignedXDR);

      setStage('submitting');

      // Submit signed transaction to server
      const resp = await fetch('/api/payouts/submit-signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, signedXDR: signedTxXdr }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to submit payment');
      }

      const result = await resp.json();
      setTxHash(result.stellarTxHash);
      setStage('success');

      setTimeout(() => {
        onSuccess(result.stellarTxHash);
      }, 2000);
    } catch (err: unknown) {
      setStage('error');
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal external-wallet-signing" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Approve Transaction</h2>
          <button className="modal-close" onClick={onClose}>
            <HiXMark />
          </button>
        </div>

        <div className="modal-body">
          {stage === 'waiting' && (
            <>
              <div className="signing-info">
                <h3>Sign Transaction</h3>
                <p>Review and approve the transaction in your connected wallet</p>
              </div>

              <div className="xdr-preview">
                <label>Transaction Details</label>
                <div className="xdr-box">
                  <code>{unsignedXDR.substring(0, 100)}...</code>
                </div>
              </div>

              <div className="signing-steps">
                <ol>
                  <li>Click "Sign Transaction" below</li>
                  <li>Your wallet will request approval</li>
                  <li>Review the transaction details</li>
                  <li>Approve the signing request</li>
                  <li>Wait for confirmation on the blockchain</li>
                </ol>
              </div>

              <button onClick={handleSign} className="btn btn-primary btn-large">
                Sign Transaction
              </button>
            </>
          )}

          {stage === 'signing' && (
            <div className="signing-progress">
              <div className="spinner" />
              <h3>Waiting for signature...</h3>
              <p>Approve the transaction in your wallet</p>
            </div>
          )}

          {stage === 'submitting' && (
            <div className="signing-progress">
              <div className="spinner" />
              <h3>Submitting to Stellar...</h3>
              <p>Your signed transaction is being submitted to the blockchain</p>
            </div>
          )}

          {stage === 'success' && (
            <div className="signing-result success">
              <HiCheck className="result-icon" />
              <h3>Payment Successful!</h3>
              <p className="tx-hash">
                Transaction: <code>{txHash.substring(0, 16)}...</code>
              </p>
              <p>Your payment has been submitted to the Stellar network</p>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
              >
                View on Stellar Expert
              </a>
              <button onClick={onClose} className="btn btn-primary" style={{ marginTop: '8px' }}>
                Close
              </button>
            </div>
          )}

          {stage === 'error' && (
            <div className="signing-result error">
              <HiExclamationTriangle className="result-icon" />
              <h3>Signing Failed</h3>
              <p>{error}</p>
              <button
                onClick={() => setStage('waiting')}
                className="btn btn-secondary"
                style={{ marginRight: '8px' }}
              >
                Try Again
              </button>
              <button onClick={onClose} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
