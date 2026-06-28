import { useEffect, useState, useCallback } from 'react';
import { useAtom } from 'jotai';
import { authAtom } from '../store/authStore';

export interface WalletDeploymentStatus {
  status: 'idle' | 'deploying' | 'deployed' | 'error';
  contractAddress?: string;
  errorMessage?: string;
  deployedAt?: string;
}

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
const MAX_WAIT_MS = 40000; // Max wait 40 seconds

export function useWalletDeployment() {
  const [auth] = useAtom(authAtom);
  const [deploymentStatus, setDeploymentStatus] = useState<WalletDeploymentStatus>({
    status: 'idle'
  });
  const [isPolling, setIsPolling] = useState(false);

  const checkDeploymentStatus = useCallback(async () => {
    if (!auth?.userId || !auth?.accessToken) return null;

    try {
      const response = await fetch(
        `/api/wallets/${auth.userId}/deployment-status`,
        {
          headers: {
            'Authorization': `Bearer ${auth.accessToken}`
          }
        }
      );

      if (!response.ok) {
        console.warn(`Status check returned ${response.status}`);
        return null;
      }

      const data = await response.json() as WalletDeploymentStatus;
      return data.status;
    } catch (err) {
      console.warn('Deployment status check failed:', err);
      return null;
    }
  }, [auth?.userId, auth?.accessToken]);

  useEffect(() => {
    // Only start polling if:
    // 1. User is authenticated
    // 2. User is a worker (indicated by wallet deployment status being set)
    // 3. We haven't already deployed
    if (!auth?.userId) return;
    if (!auth?.walletDeployment || auth.walletDeployment.status !== 'deploying') return;
    if (deploymentStatus.status === 'deployed') return;

    setIsPolling(true);
    const startTime = Date.now();
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
      pollCount++;
      const status = await checkDeploymentStatus();

      if (status === 'deployed') {
        // Wallet is deployed, fetch full details
        try {
          const response = await fetch(
            `/api/wallets/${auth.userId}`,
            {
              headers: {
                'Authorization': `Bearer ${auth.accessToken}`
              }
            }
          );
          if (response.ok) {
            const walletData = await response.json() as {
              contract_address?: string;
              contractAddress?: string;
              deployed_at?: string;
              deployedAt?: string;
            };
            const contractAddress = walletData.contract_address || walletData.contractAddress;
            const deployedAt = walletData.deployed_at || walletData.deployedAt;
            setDeploymentStatus({
              status: 'deployed',
              contractAddress,
              deployedAt
            });
          }
        } catch (err) {
          console.warn('Failed to fetch wallet details:', err);
          // Still consider it deployed if status says so
          setDeploymentStatus({
            status: 'deployed'
          });
        }
        setIsPolling(false);
        clearInterval(pollInterval);
      } else if (Date.now() - startTime > MAX_WAIT_MS) {
        // Timeout
        setDeploymentStatus({
          status: 'error',
          errorMessage: 'Wallet deployment timed out after 40 seconds'
        });
        setIsPolling(false);
        clearInterval(pollInterval);
        console.error('Wallet deployment timeout after', pollCount, 'polls');
      } else if (status === 'error') {
        setDeploymentStatus({
          status: 'error',
          errorMessage: 'Wallet deployment failed'
        });
        setIsPolling(false);
        clearInterval(pollInterval);
      } else if (status === 'deploying' || status === null) {
        // Still deploying or couldn't check - continue polling
        // Update status to show we're still polling
        if (!deploymentStatus.status || deploymentStatus.status === 'idle') {
          setDeploymentStatus({ status: 'deploying' });
        }
      }
    }, POLL_INTERVAL_MS);

    // Cleanup interval on unmount or when dependencies change
    return () => {
      clearInterval(pollInterval);
      setIsPolling(false);
    };
  }, [auth?.userId, auth?.walletDeployment, auth?.accessToken, checkDeploymentStatus, deploymentStatus.status]);

  return {
    ...deploymentStatus,
    isPolling
  };
}
