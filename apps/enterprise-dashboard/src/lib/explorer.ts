/**
 * The Stellar network this build talks to, for explorer links and testnet-only helpers. Set VITE_STELLAR_NETWORK=MAINNET
 * when building against mainnet; anything else is testnet, matching the services' own default.
 */
export const IS_MAINNET = (import.meta.env.VITE_STELLAR_NETWORK ?? '').toUpperCase() === 'MAINNET';

/** stellar.expert base, e.g. `${EXPLORER}/tx/${hash}`. */
export const EXPLORER = `https://stellar.expert/explorer/${IS_MAINNET ? 'public' : 'testnet'}`;
