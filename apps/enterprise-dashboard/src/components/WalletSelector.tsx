import { useEffect, useState } from 'react';
import { HiCheck } from 'react-icons/hi2';
import { api } from '../api/client.js';
import '../styles/WalletSelector.css';

export interface Wallet {
  id: string;
  publicKey: string;
  walletProvider?: string;
  status: string;
  isExternal?: boolean;
}

interface WalletSelectorProps {
  userId: string;
  onSelect: (wallet: Wallet) => void;
  selectedWalletId?: string;
  defaultPlatformWallet?: Wallet;
}

export default function WalletSelector({
  userId,
  onSelect,
  selectedWalletId,
  defaultPlatformWallet,
}: WalletSelectorProps) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadWallets();
  }, [userId]);

  async function loadWallets() {
    setLoading(true);
    setError('');

    try {
      // Load external wallets
      const { data } = await api.get<{ wallets: Wallet[] }>(`/wallets/${userId}/external`);
      const externalWallets = data.wallets || [];

      // Combine with platform wallet if available
      const allWallets = [];
      if (defaultPlatformWallet) {
        allWallets.push(defaultPlatformWallet);
      }
      allWallets.push(...externalWallets);

      setWallets(allWallets);

      // Auto-select first wallet if none selected
      if (!selectedWalletId && allWallets.length > 0) {
        onSelect(allWallets[0]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load wallets';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="wallet-selector loading">Loading wallets...</div>;
  }

  if (error) {
    return <div className="wallet-selector error">{error}</div>;
  }

  if (wallets.length === 0) {
    return (
      <div className="wallet-selector empty">
        <p>No wallets available</p>
      </div>
    );
  }

  return (
    <div className="wallet-selector">
      <label>Pay From</label>
      <div className="wallet-list">
        {wallets.map((wallet) => (
          <button
            key={wallet.id}
            className={`wallet-item ${selectedWalletId === wallet.id ? 'selected' : ''}`}
            onClick={() => onSelect(wallet)}
          >
            <div className="wallet-info">
              <div className="wallet-type">
                {wallet.isExternal
                  ? `${getWalletEmoji(wallet.walletProvider)} ${wallet.walletProvider || 'External'}`
                  : '🏢 Platform (Funti3r)'}
              </div>
              <div className="wallet-key">
                {wallet.publicKey.substring(0, 20)}...
              </div>
              {wallet.isExternal && (
                <div className="wallet-status">
                  {wallet.status === 'active' ? '✓ Connected' : wallet.status}
                </div>
              )}
            </div>
            {selectedWalletId === wallet.id && (
              <HiCheck className="selected-icon" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function getWalletEmoji(provider?: string): string {
  const emojis: { [key: string]: string } = {
    freighter: '🔐',
    albedo: '🛡️',
    rabet: '💼',
    mystellar: '⭐',
  };
  return emojis[provider || 'default'] || '💳';
}
