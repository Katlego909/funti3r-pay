/**
 * Stellar Network Configuration
 * All network constants for testnet operations
 */

import { Networks } from '@stellar/stellar-sdk';

// Network configuration
export const STELLAR_NETWORK = {
  name: 'TESTNET',
  passphrase: Networks.TESTNET_NETWORK_PASSPHRASE,
} as const;

// Horizon API URLs
export const HORIZON_BASE_URL = 'https://horizon-testnet.stellar.org';

// Soroban RPC URL (for future contract interactions)
export const SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';

// Friendbot testnet airdrop
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

// Transaction defaults
export const TX_TIMEOUT_SECONDS = 180; // 3 minutes
export const BASE_FEE_STROOPS = 100; // Current standard

// Minimum account balance
export const MINIMUM_BALANCE_XLM = 1;

// Asset codes
export const NATIVE_ASSET = 'XLM';
export const USDC_CODE = 'USDC';

// Known issuers (testnet)
export const STELLAR_USDC_ISSUER = 'GBBD47UZQ5LVKNQYOOKQ7CX3PTMH4NAPCGVXVHMTWVLZKZPQJYCBZZDY'; // Testnet USDC issuer

// Mark as const to prevent mutations
Object.freeze(STELLAR_NETWORK);
