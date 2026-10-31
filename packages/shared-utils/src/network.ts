/**
 * Which Stellar network the platform runs on, decided in one place.
 *
 * STELLAR_NETWORK picks TESTNET (the default) or MAINNET. On testnet the SDF's public endpoints are filled in so a
 * fresh checkout just works. On mainnet nothing is guessed: the Horizon and RPC URLs must be set explicitly, and a
 * STELLAR_NETWORK_PASSPHRASE that disagrees with the chosen network is refused. Every misconfiguration throws, so a
 * service fails at boot instead of quietly signing mainnet transactions against testnet (or the reverse).
 */

export type StellarNetworkName = 'TESTNET' | 'MAINNET';

export interface StellarNetwork {
  name: StellarNetworkName;
  isMainnet: boolean;
  passphrase: string;
  horizonUrl: string;
  sorobanUrl: string;
  /** stellar.expert base for links, e.g. `${explorerUrl}/tx/${hash}`. */
  explorerUrl: string;
}

const PASSPHRASES: Record<StellarNetworkName, string> = {
  TESTNET: 'Test SDF Network ; September 2015',
  MAINNET: 'Public Global Stellar Network ; September 2015',
};

type Env = Record<string, string | undefined>;

export function stellarNetwork(env: Env = process.env): StellarNetwork {
  const raw = (env.STELLAR_NETWORK || 'TESTNET').trim().toUpperCase();
  if (raw !== 'TESTNET' && raw !== 'MAINNET') {
    throw new Error(`STELLAR_NETWORK must be TESTNET or MAINNET, got "${env.STELLAR_NETWORK}"`);
  }
  const name: StellarNetworkName = raw;
  const isMainnet = name === 'MAINNET';
  const passphrase = PASSPHRASES[name];

  if (env.STELLAR_NETWORK_PASSPHRASE && env.STELLAR_NETWORK_PASSPHRASE !== passphrase) {
    throw new Error(`STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK=${name}`);
  }

  const horizonUrl = env.STELLAR_HORIZON_URL || (isMainnet ? '' : 'https://horizon-testnet.stellar.org');
  const sorobanUrl = env.STELLAR_SOROBAN_URL || (isMainnet ? '' : 'https://soroban-testnet.stellar.org');
  if (!horizonUrl || !sorobanUrl) {
    throw new Error('STELLAR_HORIZON_URL and STELLAR_SOROBAN_URL must be set explicitly on MAINNET');
  }
  for (const url of [horizonUrl, sorobanUrl]) {
    if (isMainnet && /testnet|futurenet/i.test(url)) {
      throw new Error(`STELLAR_NETWORK=MAINNET but ${url} is a test endpoint`);
    }
  }

  return {
    name,
    isMainnet,
    passphrase,
    horizonUrl,
    sorobanUrl,
    explorerUrl: `https://stellar.expert/explorer/${isMainnet ? 'public' : 'testnet'}`,
  };
}
