import React, { useState, useEffect } from 'react';
import { getTransactionHistory, streamAccountTransactions } from '@funti3r/payment-service';
import '../styles/ReceivePayment.css';

interface ReceivePaymentProps {
  publicKey?: string;
}

export function ReceivePayment({ publicKey }: ReceivePaymentProps) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (publicKey) {
      loadTransactionHistory();
      setupStream();
    }
  }, [publicKey]);

  const loadTransactionHistory = async () => {
    if (!publicKey) return;

    setLoading(true);
    setError(null);

    try {
      const txs = await getTransactionHistory(publicKey, 20);
      setTransactions(txs);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load transactions';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const setupStream = async () => {
    if (!publicKey) return;

    try {
      const stop = await streamAccountTransactions(
        publicKey,
        (tx) => {
          setTransactions((prev) => [
            {
              id: tx.id,
              hash: tx.hash,
              created_at: tx.created_at,
              successful: tx.successful,
            },
            ...prev.slice(0, 19),
          ]);
        },
        (err) => {
          console.error('Stream error:', err);
        }
      );

      return () => stop();
    } catch (err) {
      console.error('Failed to setup stream:', err);
    }
  };

  const copyToClipboard = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const shortenHash = (hash: string) => {
    return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
  };

  return (
    <div className="receive-payment-container">
      <h2>Receive Payment</h2>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="public-key-section">
        <h3>Your Public Key</h3>
        <div className="key-display">
          <code>{publicKey}</code>
          <button onClick={copyToClipboard} className="btn btn-small">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="transaction-history-section">
        <div className="section-header">
          <h3>Transaction History</h3>
          <button onClick={loadTransactionHistory} disabled={loading} className="btn btn-small">
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {transactions.length === 0 ? (
          <p className="empty-state">No transactions yet</p>
        ) : (
          <div className="transactions-list">
            {transactions.map((tx) => (
              <div key={tx.id} className="transaction-item">
                <div className="tx-header">
                  <span className={`tx-status ${tx.successful ? 'successful' : 'failed'}`}>
                    {tx.successful ? '✓ Success' : '✗ Failed'}
                  </span>
                  <span className="tx-hash">{shortenHash(tx.hash)}</span>
                </div>
                <div className="tx-time">{formatDate(tx.created_at)}</div>
                <a
                  href={`https://horizon-testnet.stellar.org/transactions/${tx.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-link"
                >
                  View on Horizon →
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
