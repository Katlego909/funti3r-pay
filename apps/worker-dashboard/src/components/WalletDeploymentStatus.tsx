import React from 'react';
import { useWalletDeployment } from '../hooks/useWalletDeployment';
import './WalletDeploymentStatus.css';

export function WalletDeploymentStatus() {
  const { status, contractAddress, errorMessage, isPolling } = useWalletDeployment();

  if (status === 'idle') {
    return null;
  }

  if (status === 'deploying') {
    return (
      <div className="wallet-deployment-status deploying">
        <div className="status-content">
          <div className="spinner"></div>
          <div className="text-content">
            <h3>Setting up your wallet...</h3>
            <p>Your SmartWallet is being deployed to the Stellar blockchain.</p>
            <p className="estimate">This usually takes 20-30 seconds.</p>
            <div className="progress-indicator">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'deployed') {
    return (
      <div className="wallet-deployment-status deployed">
        <div className="status-content">
          <div className="checkmark">✓</div>
          <div className="text-content">
            <h3>Wallet ready!</h3>
            <p>Your non-custodial wallet is active and ready to receive payments.</p>
            {contractAddress && (
              <div className="address-section">
                <label>Contract Address:</label>
                <div className="address-container">
                  <code className="address">{contractAddress}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(contractAddress);
                      alert('Wallet address copied to clipboard!');
                    }}
                    className="copy-button"
                    title="Copy to clipboard"
                  >
                    📋 Copy
                  </button>
                </div>
                <p className="address-hint">Share this address with enterprises to receive payments</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="wallet-deployment-status error">
        <div className="status-content">
          <div className="error-icon">⚠️</div>
          <div className="text-content">
            <h3>Wallet Setup Failed</h3>
            <p>{errorMessage || 'An error occurred during wallet setup.'}</p>
            <button
              onClick={() => window.location.reload()}
              className="retry-button"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
