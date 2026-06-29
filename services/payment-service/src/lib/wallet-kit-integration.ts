import { Keypair, sign } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('WalletKitIntegration');

export const CHALLENGE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generate a random challenge for wallet verification.
 * The user will sign this challenge with their wallet to prove ownership.
 */
export function generateChallenge(): string {
  const randomPart = randomBytes(32).toString('hex');
  const timestamp = Date.now().toString(16);
  return `Challenge:${timestamp}:${randomPart}`;
}

/**
 * Verify a signature against a challenge using the wallet's public key.
 * Uses Stellar's signature verification.
 */
export function verifySignature(challenge: string, signatureHex: string, publicKey: string): boolean {
  try {
    // Convert signature from hex to Buffer
    const signatureBuffer = Buffer.from(signatureHex, 'hex');

    // Create a keypair from the public key (public-key-only keypair for verification)
    const keypair = Keypair.fromPublicKey(publicKey);

    // Verify the signature
    const challengeBuffer = Buffer.from(challenge, 'utf8');
    const isValid = keypair.verify(challengeBuffer, signatureBuffer);

    if (!isValid) {
      logger.debug('Signature verification failed', {
        publicKey: publicKey.substring(0, 10) + '...',
      });
    }

    return isValid;
  } catch (err) {
    logger.error('Error verifying signature', { error: String(err) });
    return false;
  }
}

/**
 * Prepare an unsigned payment transaction for signing by an external wallet.
 * Returns the XDR transaction envelope that can be signed externally.
 */
export function getNetworkPassphrase(): string {
  const network = process.env.STELLAR_NETWORK || 'TESTNET';
  return network === 'MAINNET'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';
}

/**
 * Extract metadata about a wallet provider for client-side integration
 */
export interface WalletProviderConfig {
  name: string;
  displayName: string;
  logo?: string;
  supportedMethods: string[];
}

export const WALLET_PROVIDERS: Record<string, WalletProviderConfig> = {
  freighter: {
    name: 'freighter',
    displayName: 'Freighter Wallet',
    supportedMethods: ['signTransaction'],
  },
  albedo: {
    name: 'albedo',
    displayName: 'Albedo Wallet',
    supportedMethods: ['signTransaction'],
  },
  rabet: {
    name: 'rabet',
    displayName: 'Rabet Wallet',
    supportedMethods: ['signTransaction'],
  },
  mystellar: {
    name: 'mystellar',
    displayName: 'MySteller Wallet',
    supportedMethods: ['signTransaction'],
  },
};

/**
 * Validate wallet provider is supported
 */
export function isValidWalletProvider(provider: string): boolean {
  return provider in WALLET_PROVIDERS;
}

/**
 * Get wallet provider configuration for client
 */
export function getWalletProviderConfig(provider: string): WalletProviderConfig | null {
  return WALLET_PROVIDERS[provider] || null;
}

/**
 * Supported networks for external wallets
 */
export const SUPPORTED_NETWORKS = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanUrl: 'https://soroban-testnet.stellar.org',
  },
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    sorobanUrl: 'https://soroban.stellar.org',
  },
};

/**
 * Validate wallet signature format
 */
export function isValidSignatureFormat(signature: string): boolean {
  try {
    // Should be hex-encoded 64-byte signature
    const buffer = Buffer.from(signature, 'hex');
    return buffer.length === 64;
  } catch (err) {
    return false;
  }
}
