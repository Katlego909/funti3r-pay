import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { Keypair } from '@stellar/stellar-sdk';
import {
  apiBase, checkDeposit, createSession, findClaimedTransaction, listTransactions, moneygramConfigured,
  parseTransaction, type RampsTransaction,
} from '../lib/moneygram.js';

const WORKER = 'fa1714c8-e1a8-40b1-8801-2be113f08766';
const WALLET = Keypair.random().publicKey();
const DEPOSIT = Keypair.random().publicKey();
const NOW = Date.UTC(2026, 9, 8, 14, 0, 30);

/** Shaped like MoneyGram's real record, including the personal data we must never touch. */
const RAW = {
  transactionId: 'tx-1', mgiTransactionId: 'mgi-1', customerIdentifier: WORKER, transactionType: 'cash-out',
  status: 'awaiting_funds', depositAddress: DEPOSIT, depositMemo: '1789043683987597792',
  depositExpiresAt: new Date(NOW + 9 * 60_000).toISOString(), sendAmount: 10, sendAsset: 'USDC', sendChain: 'stellar',
  sourceWalletAddress: WALLET, referenceNumber: '33031948', receiveAmount: '114.23', receiveCurrency: 'ZAR',
  destinationCountry: 'ZAF', quote: { fees: { total: { value: '3.00', currency: 'USDC' } } },
  createdAt: '2026-10-08T14:00:11.103Z', updatedAt: '2026-10-08T14:00:15.639Z',
  kycData: { firstName: 'Katlego', idNumber: '0000000000000', phone: '0000000000', addressLine1: '1 Test Street' },
};

const claim = (over: Partial<{ address: string; memo: string; amount: string }> = {}) => ({
  address: DEPOSIT, memo: '1789043683987597792', amount: '10', ...over,
});
const tx = (over: Partial<RampsTransaction> = {}): RampsTransaction => ({ ...parseTransaction(RAW)!, ...over });
const expectFor = (c = claim()) => ({ customerIdentifier: WORKER, walletAddress: WALLET, claim: c, now: NOW });

const ENV = ['MONEYGRAM_SK', 'MONEYGRAM_PK', 'MONEYGRAM_API_BASE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MONEYGRAM_SK = 'ramps_sk_sbox_test';
  process.env.MONEYGRAM_PK = 'ramps_pk_sbox_test';
  delete process.env.MONEYGRAM_API_BASE;
  vi.mocked(axios.get).mockReset();
  vi.mocked(axios.post).mockReset();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('configuration', () => {
  it('needs both keys', () => {
    expect(moneygramConfigured()).toBe(true);
    delete process.env.MONEYGRAM_SK;
    expect(moneygramConfigured()).toBe(false);
  });

  it('only ever sends the secret key to a moneygram.com host', () => {
    expect(apiBase()).toBe('https://playground.xramps.moneygram.com/api/v1');
    process.env.MONEYGRAM_API_BASE = 'https://api.moneygram.com/v1/';
    expect(apiBase()).toBe('https://api.moneygram.com/v1');
    for (const evil of ['https://evil.example/api/v1', 'https://moneygram.com.evil.example/x', 'https://notmoneygram.com/x']) {
      process.env.MONEYGRAM_API_BASE = evil;
      expect(() => apiBase()).toThrow(/Refusing to send the MoneyGram secret key/);
    }
  });
});

describe('parseTransaction', () => {
  it('copies only the fields we use and never the customer\'s personal data', () => {
    const t = parseTransaction(RAW)!;
    expect(t).toMatchObject({
      id: 'tx-1', status: 'awaiting_funds', depositAddress: DEPOSIT, depositMemo: '1789043683987597792',
      sendAmount: 10, referenceNumber: '33031948', receiveAmount: '114.23', receiveCurrency: 'ZAR', feeTotal: '3.00',
    });
    const json = JSON.stringify(t);
    expect(json).not.toContain('kycData');
    expect(json).not.toContain('Katlego');
    expect(json).not.toContain('idNumber');
    expect(json).not.toContain('Test Street');
  });

  it('rejects records without an id or status', () => {
    expect(parseTransaction({ status: 'x' })).toBeNull();
    expect(parseTransaction({ transactionId: 'x' })).toBeNull();
    expect(parseTransaction(null)).toBeNull();
  });
});

describe('API calls', () => {
  it('createSession posts the custodial body with the secret in x-api-key', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { sessionId: 's1', sessionToken: 'tok', widgetUrl: 'https://playground.xramps.moneygram.com/sdk/widget.html?mode=off-ramp' } });
    const s = await createSession({ customerIdentifier: WORKER, walletAddress: WALLET });
    expect(s).toEqual({ sessionId: 's1', sessionToken: 'tok', widgetUrl: expect.stringContaining('widget.html') });
    const [url, body, cfg] = vi.mocked(axios.post).mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(url).toBe('https://playground.xramps.moneygram.com/api/v1/sessions');
    expect(body).toEqual({ customerIdentifier: WORKER, walletAddress: WALLET, chain: 'stellar' });
    expect(cfg.headers['x-api-key']).toBe('ramps_sk_sbox_test');
  });

  it('createSession rejects an incomplete session', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { sessionId: 's1' } });
    await expect(createSession({ customerIdentifier: WORKER, walletAddress: WALLET })).rejects.toThrow(/incomplete session/);
  });

  it('listTransactions parses the list and drops malformed rows', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { transactions: [RAW, { nope: true }] } });
    const list = await listTransactions();
    expect(list).toHaveLength(1);
    expect(list[0].referenceNumber).toBe('33031948');
  });
});

describe('checkDeposit — the browser is not trusted', () => {
  it('accepts a deposit that matches MoneyGram\'s record for this worker', () => {
    const r = checkDeposit(tx(), expectFor());
    expect(r.ok).toBe(true);
  });

  it('finds the record by address + memo', () => {
    expect(findClaimedTransaction([tx({ id: 'other', depositMemo: '1' }), tx()], claim())?.id).toBe('tx-1');
    expect(findClaimedTransaction([tx()], claim({ memo: '999' }))).toBeUndefined();
  });

  const reject = (t: RampsTransaction | undefined, c = claim()) => {
    const r = checkDeposit(t, expectFor(c));
    expect(r.ok).toBe(false);
    return (r as { reason: string }).reason;
  };

  it('rejects when MoneyGram has no such transaction', () => {
    expect(reject(undefined)).toMatch(/no matching transaction/);
  });

  it('rejects another customer\'s transaction (cannot make us pay someone else\'s deposit)', () => {
    expect(reject(tx({ customerIdentifier: 'someone-else' }))).toMatch(/different customer/);
  });

  it('rejects a transaction opened for a different wallet', () => {
    expect(reject(tx({ sourceWalletAddress: Keypair.random().publicKey() }))).toMatch(/different wallet/);
  });

  it('rejects a swapped deposit address or memo — the attacker-controlled claim loses to MoneyGram\'s record', () => {
    expect(reject(tx(), claim({ address: Keypair.random().publicKey() }))).toMatch(/address or memo/);
    expect(reject(tx(), claim({ memo: '42' }))).toMatch(/address or memo/);
  });

  it('rejects an inflated amount', () => {
    expect(reject(tx(), claim({ amount: '1000' }))).toMatch(/amount/);
  });

  it('rejects anything but USDC on Stellar, and non-cash-out transactions', () => {
    expect(reject(tx({ sendAsset: 'XLM' }))).toMatch(/USDC on Stellar/);
    expect(reject(tx({ sendChain: 'solana' }))).toMatch(/USDC on Stellar/);
    expect(reject(tx({ type: 'cash-in' }))).toMatch(/cash-out/);
  });

  it('rejects a transaction that is already paid or otherwise past awaiting_funds (no double payment)', () => {
    expect(reject(tx({ status: 'completed' }))).toMatch(/not awaiting funds/);
    expect(reject(tx({ status: 'funds_received' }))).toMatch(/not awaiting funds/);
  });

  it('rejects an expired or nearly expired deposit window', () => {
    expect(reject(tx({ depositExpiresAt: new Date(NOW - 1000).toISOString() }))).toMatch(/expired/);
    expect(reject(tx({ depositExpiresAt: new Date(NOW + 5_000).toISOString() }))).toMatch(/expired/);
    expect(reject(tx({ depositExpiresAt: null }))).toMatch(/expired/);
  });

  it('rejects a deposit address or memo that isn\'t valid on Stellar', () => {
    const bad = tx({ depositAddress: 'GNOTAKEY', depositMemo: '1789043683987597792' });
    expect(reject(bad, claim({ address: 'GNOTAKEY' }))).toMatch(/invalid deposit address/);
    const badMemo = tx({ depositMemo: 'not-a-number' });
    expect(reject(badMemo, claim({ memo: 'not-a-number' }))).toMatch(/invalid deposit memo/);
  });
});
