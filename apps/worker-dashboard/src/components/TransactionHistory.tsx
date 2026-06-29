import React, { useState, useEffect } from 'react';
import { getTransactionHistory } from '@funti3r/payment-service';
import '../styles/TransactionHistory.css';

interface TransactionHistoryProps {
  publicKey?: string;
  limit?: number;
}

export function TransactionHistory({ publicKey, limit = 20 }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (publicKey) {
      loadHistory();
    }
  }, [publicKey]);

  const loadHistory = async () => {
    if (!publicKey) return;

    setLoading(true);
    setError(null);

    try {
      const txs = await getTransactionHistory(publicKey, Math.min(limit, 200));
      setTransactions(txs);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load transactions';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const shortenHash = (hash: string): string => {
    return `${hash.substring(0, 10)}...${hash.substring(hash.length - 10)}`;
  };

  const getStatusBadge = (successful: boolean): string => {
    return successful ? 'success' : 'failed';
  };

  if (error) {
    return (
      <div className="transaction-history-container">
        <h2>Transaction History</h2>
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!publicKey) {
    return (
      <div className="transaction-history-container">
        <h2>Transaction History</h2>
        <div className="alert alert-warning">Public key not provided</div>
      </div>
    );
  }

  return (
    <div className="transaction-history-container">
      <div className="history-header">
        <h2>Transaction History</h2>
        <button onClick={loadHistory} disabled={loading} className="btn-reload">
          {loading ? 'Loading...' : 'Reload'}
        </button>
      </div>

      {transactions.length === 0 ? (
        <div className="empty-state">
          <p>No transactions found</p>
        </div>
      ) : (
        <div className="transactions-table-wrapper">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Hash</th>
                <th>Status</th>
                <th>Operations</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="date-cell">{formatDate(tx.created_at)}</td>
                  <td className="hash-cell">{shortenHash(tx.hash)}</td>
                  <td className="status-cell">
                    <span className={`status-badge ${getStatusBadge(tx.successful)}`}>
                      {tx.successful ? 'Success' : 'Failed'}
                    </span>
                  </td>
                  <td className="operations-cell">{tx.operations_count}</td>
                  <td className="link-cell">
                    <a
                      href={`https://horizon-testnet.stellar.org/transactions/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      View →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
