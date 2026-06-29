import React, { useState, useEffect } from 'react';
import { getBalance } from '@funti3r/payment-service';
import '../styles/AccountBalance.css';

interface AccountBalanceProps {
  publicKey?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function AccountBalance({ publicKey, autoRefresh = false, refreshInterval = 10000 }: AccountBalanceProps) {
  const [xlmBalance, setXlmBalance] = useState('0');
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const USDC_ISSUER = 'GBBD47UZQ5LVKNQYOOKQ7CX3PTMH4NAPCGVXVHMTWVLZKZPQJYCBZZDY'; // Testnet USDC

  const loadBalances = async () => {
    if (!publicKey) {
      setError('Public key not provided');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [xlm, usdc] = await Promise.all([
        getBalance(publicKey, 'XLM'),
        getBalance(publicKey, 'USDC', USDC_ISSUER).catch(() => '0'),
      ]);

      setXlmBalance(xlm);
      setUsdcBalance(usdc);
      setLastUpdated(new Date());
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load balances';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBalances();

    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(loadBalances, refreshInterval);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [publicKey, autoRefresh, refreshInterval]);

  const formatBalance = (balance: string, decimals: number = 2): string => {
    const num = parseFloat(balance);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString();
  };

  return (
    <div className="account-balance-container">
      <div className="balance-header">
        <h2>Account Balance</h2>
        <button onClick={loadBalances} disabled={loading} className="btn-refresh">
          {loading ? '⟳ Refreshing...' : '⟳ Refresh'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="balances-grid">
        <div className="balance-card">
          <div className="balance-label">XLM Balance</div>
          <div className="balance-amount">
            {loading ? '—' : formatBalance(xlmBalance, 7)}
            <span className="currency">XLM</span>
          </div>
        </div>

        <div className="balance-card">
          <div className="balance-label">USDC Balance</div>
          <div className="balance-amount">
            {loading ? '—' : formatBalance(usdcBalance, 6)}
            <span className="currency">USDC</span>
          </div>
        </div>
      </div>

      {lastUpdated && (
        <div className="last-updated">
          Last updated: {formatTime(lastUpdated)}
        </div>
      )}
    </div>
  );
}
