import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stellarNetwork } from './network.js';

test('defaults to testnet with the SDF endpoints', () => {
  const n = stellarNetwork({});
  assert.equal(n.name, 'TESTNET');
  assert.equal(n.isMainnet, false);
  assert.equal(n.passphrase, 'Test SDF Network ; September 2015');
  assert.equal(n.horizonUrl, 'https://horizon-testnet.stellar.org');
  assert.equal(n.explorerUrl, 'https://stellar.expert/explorer/testnet');
});

test('mainnet with explicit endpoints uses the public passphrase and explorer', () => {
  const n = stellarNetwork({
    STELLAR_NETWORK: 'mainnet',
    STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
    STELLAR_SOROBAN_URL: 'https://rpc.example.com',
  });
  assert.equal(n.isMainnet, true);
  assert.equal(n.passphrase, 'Public Global Stellar Network ; September 2015');
  assert.equal(n.explorerUrl, 'https://stellar.expert/explorer/public');
});

test('mainnet without endpoints refuses to start', () => {
  assert.throws(() => stellarNetwork({ STELLAR_NETWORK: 'MAINNET' }), /must be set explicitly/);
});

test('mainnet pointed at a testnet endpoint refuses to start', () => {
  assert.throws(
    () => stellarNetwork({
      STELLAR_NETWORK: 'MAINNET',
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      STELLAR_SOROBAN_URL: 'https://rpc.example.com',
    }),
    /test endpoint/,
  );
});

test('a passphrase that disagrees with the network is refused', () => {
  assert.throws(
    () => stellarNetwork({ STELLAR_NETWORK: 'TESTNET', STELLAR_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015' }),
    /does not match/,
  );
});

test('an unknown network name is refused', () => {
  assert.throws(() => stellarNetwork({ STELLAR_NETWORK: 'PUBNET' }), /TESTNET or MAINNET/);
});
