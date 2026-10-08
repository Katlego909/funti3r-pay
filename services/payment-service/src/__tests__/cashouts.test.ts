import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { Keypair, Memo } from '@stellar/stellar-sdk';
import { query } from '@funti3r/database';
import app from '../app.js';
import { ensureCleared, ComplianceBlockedError } from '../lib/clearance.js';
import { payExactWithXlm, spendableXlm } from '../lib/stellar.js';
import * as mg from '../lib/moneygram.js';
import { awaitRampsAcknowledgement } from '../lib/rampsSync.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID } from './helpers.js';

// Only the network calls are replaced; checkDeposit & co. stay real — they ARE the security logic.
vi.mock('../lib/moneygram.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/moneygram.js')>()),
  moneygramConfigured: vi.fn(),
  moneygramPublicKey: vi.fn(() => 'ramps_pk_sbox_public'),
  moneygramSandbox: vi.fn(() => true),
  createSession: vi.fn(),
  listTransactions: vi.fn(),
}));
vi.mock('../lib/rampsSync.js', () => ({ awaitRampsAcknowledgement: vi.fn(), applyRampsRecord: vi.fn(), syncPendingRamps: vi.fn() }));

const workerHeaders = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };
const WALLET = Keypair.random().publicKey();
const DEPOSIT = Keypair.random().publicKey();
const MEMO = '1789043683987597792';
const CASHOUT_ID = 'cashout-1111-1111-1111-111111111111';

const record = (over: Partial<mg.RampsTransaction> = {}): mg.RampsTransaction => ({
  id: 'mg-tx-1', mgiTransactionId: 'mgi-1', customerIdentifier: WORKER_ID, type: 'cash-out', status: 'awaiting_funds',
  depositAddress: DEPOSIT, depositMemo: MEMO, depositExpiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  sendAmount: 10, sendAsset: 'USDC', sendChain: 'stellar', sourceWalletAddress: WALLET, referenceNumber: '33031948',
  receiveAmount: '114.23', receiveCurrency: 'ZAR', destinationCountry: 'ZAF', feeTotal: '3.00', feeCurrency: 'USDC',
  createdAt: null, updatedAt: null, ...over,
});
const body = (over: Record<string, unknown> = {}) => ({ address: DEPOSIT, memo: MEMO, amount: '10', ...over });

const PUBKEY = { match: /^SELECT stellar_public_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_public_key: WALLET }] }) };
const SECRET = { match: /^SELECT stellar_secret_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_secret_key: 'SFAKESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }) };
const PRIOR = (over: Record<string, unknown>) => ({ match: /SELECT worker_id, settlement_hash FROM cashouts/, handler: () => ({ rows: [{ worker_id: WORKER_ID, settlement_hash: null, ...over }] }) });
const TAKE = { match: /INSERT INTO cashouts/, handler: () => ({ rows: [{ id: CASHOUT_ID }] }) };
const TAKE_LOST = { match: /INSERT INTO cashouts/, handler: () => ({ rows: [] }) };

const calls = (re: RegExp) => vi.mocked(query).mock.calls.filter(([sql]) => re.test(sql));
const deposit = (b = body(), headers: Record<string, string> = workerHeaders) =>
  request(app).post('/cashouts/moneygram/deposit').set(headers).send(b);
const session = (headers: Record<string, string> = workerHeaders) =>
  request(app).post('/cashouts/moneygram/session').set(headers);

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(ensureCleared).mockReset().mockResolvedValue({ cleared: true });
  vi.mocked(spendableXlm).mockReset().mockResolvedValue(180.5);
  vi.mocked(payExactWithXlm).mockReset().mockResolvedValue({ hash: 'usdc-payment-hash', sourceAmountXlm: '92.6' });
  vi.mocked(awaitRampsAcknowledgement).mockReset().mockResolvedValue('received');
  vi.mocked(mg.moneygramConfigured).mockReset().mockReturnValue(true);
  vi.mocked(mg.createSession).mockReset();
  vi.mocked(mg.listTransactions).mockReset().mockResolvedValue([record()]);
});

describe('POST /cashouts/moneygram/session', () => {
  it('403s anyone but the worker, and 400s when MoneyGram is not configured', async () => {
    expect((await session({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' })).status).toBe(403);
    vi.mocked(mg.moneygramConfigured).mockReturnValue(false);
    expect((await session()).status).toBe(400);
    expect(mg.createSession).not.toHaveBeenCalled();
  });

  it('409s when the wallet has nothing to spare', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([PUBKEY]));
    vi.mocked(spendableXlm).mockResolvedValue(0);
    expect((await session()).status).toBe(409);
    expect(mg.createSession).not.toHaveBeenCalled();
  });

  it('refuses a worker who fails the compliance re-screen', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([PUBKEY]));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker is blocked pending compliance review (sanctions match)'));
    expect((await session()).status).toBe(403);
    expect(mg.createSession).not.toHaveBeenCalled();
  });

  it('opens a custodial session for this worker, capped at what the wallet can spend', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([PUBKEY]));
    vi.mocked(mg.createSession).mockResolvedValue({ sessionId: 's1', sessionToken: 'session-token', widgetUrl: 'https://playground.xramps.moneygram.com/sdk/widget.html?mode=off-ramp' });

    const res = await session();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionToken: 'session-token', widgetUrl: expect.stringContaining('widget.html'),
      publicKey: 'ramps_pk_sbox_public', walletAddress: WALLET, maxXlm: 180.5,
    });
    expect(mg.createSession).toHaveBeenCalledWith({ customerIdentifier: WORKER_ID, walletAddress: WALLET });
  });

  it('never returns the secret key', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([PUBKEY]));
    vi.mocked(mg.createSession).mockResolvedValue({ sessionId: 's1', sessionToken: 't', widgetUrl: 'https://playground.xramps.moneygram.com/sdk/widget.html' });
    process.env.MONEYGRAM_SK = 'ramps_sk_sbox_should_never_leak';
    const res = await session();
    expect(JSON.stringify(res.body)).not.toContain('ramps_sk_');
    delete process.env.MONEYGRAM_SK;
  });
});

describe('POST /cashouts/moneygram/deposit', () => {
  const base = [PUBKEY, SECRET];

  it('400s a malformed request before touching anything', async () => {
    for (const bad of [{}, { address: DEPOSIT }, body({ memo: '' }), body({ amount: '0' }), body({ address: 5 })]) {
      expect((await deposit(bad as never)).status).toBe(400);
    }
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('is idempotent: a repeated request after we paid returns the same payment and pays nothing', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, PRIOR({ settlement_hash: 'usdc-payment-hash' })]));
    const res = await deposit();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ txHash: 'usdc-payment-hash', alreadyPaid: true });
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('refuses a deposit MoneyGram has no record of — a forged request cannot make us pay', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    vi.mocked(mg.listTransactions).mockResolvedValue([record({ depositAddress: Keypair.random().publicKey() })]);
    const res = await deposit();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('deposit_rejected');
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it("refuses a swapped address, an inflated amount, and another customer's transaction", async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    expect((await deposit(body({ address: Keypair.random().publicKey() }))).status).toBe(409);
    expect((await deposit(body({ amount: '1000' }))).status).toBe(409);

    vi.mocked(mg.listTransactions).mockResolvedValue([record({ customerIdentifier: 'someone-else' })]);
    expect((await deposit()).status).toBe(409);
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('refuses a transaction MoneyGram already moved past awaiting_funds (no double payment)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    vi.mocked(mg.listTransactions).mockResolvedValue([record({ status: 'completed' })]);
    expect((await deposit()).status).toBe(409);
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('refuses an expired deposit window', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    vi.mocked(mg.listTransactions).mockResolvedValue([record({ depositExpiresAt: new Date(Date.now() - 1000).toISOString() })]);
    const res = await deposit();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/expired/);
  });

  it('re-screens the worker before any money moves', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker KYC not verified'));
    expect((await deposit()).status).toBe(403);
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('409s when the wallet has nothing to spare, paying nothing', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    vi.mocked(spendableXlm).mockResolvedValue(0);
    expect((await deposit()).status).toBe(409);
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('409s when this MoneyGram transaction was already used (by anyone, or paid already)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, TAKE_LOST]));
    const res = await deposit();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already used/);
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('pays exactly the USDC MoneyGram asked for, straight to its deposit address with its memo, capped at the spendable XLM', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, TAKE]));
    const res = await deposit();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ txHash: 'usdc-payment-hash', status: 'pending' });
    const [, destination, code, issuer, amount, , , opts] = vi.mocked(payExactWithXlm).mock.calls[0] as unknown as [
      string, string, string, string, string, number, undefined, { sendMaxXlm: string; memo: Memo },
    ];
    expect(destination).toBe(DEPOSIT);
    expect(code).toBe('USDC');
    expect(issuer).toBe(process.env.STELLAR_USDC_ISSUER);
    expect(amount).toBe('10');
    expect(opts.sendMaxXlm).toBe('180.5000000'); // the wallet's spendable XLM — a hard on-chain ceiling
    expect(opts.memo.type).toBe('id');
    expect(opts.memo.value).toBe(MEMO);
  });

  it('persists the payment hash first, then answers without waiting on MoneyGram (the gateway cuts off slow requests)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, TAKE]));
    // MoneyGram never acknowledges in this test — the response must not depend on it.
    vi.mocked(awaitRampsAcknowledgement).mockImplementation((() => new Promise(() => {})) as never);
    vi.mocked(awaitRampsAcknowledgement).mockClear();
    const res = await deposit();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ txHash: 'usdc-payment-hash', status: 'pending' });
    // what the cash-out actually cost (sourceAmountXlm from the path payment) is kept alongside the hash
    expect(calls(/SET settlement_hash = \$2, xlm_spent = \$3/)[0][1]).toEqual([CASHOUT_ID, 'usdc-payment-hash', '92.6']);
    expect(awaitRampsAcknowledgement).toHaveBeenCalledWith(CASHOUT_ID, 'mg-tx-1');
  });

  it('a failing background acknowledgement never turns a successful payment into an error', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, TAKE]));
    vi.mocked(awaitRampsAcknowledgement).mockRejectedValue(new Error('MoneyGram down'));
    const res = await deposit();
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('usdc-payment-hash');
  });

  it('marks the cash-out failed (retryable) when the on-chain payment fails, and never records a hash', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, TAKE]));
    vi.mocked(payExactWithXlm).mockRejectedValue(new Error('Delivering 500 USDC needs 532.57 XLM, above the 180.5 XLM limit'));
    const res = await deposit();
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/above the/);
    expect(calls(/SET status = 'failed', error = \$2/)).toHaveLength(1);
    expect(calls(/SET settlement_hash/)).toHaveLength(0);
    expect(awaitRampsAcknowledgement).not.toHaveBeenCalled();
  });
});

describe('GET /cashouts', () => {
  it("403s non-workers and returns only the worker's own cash-outs, newest first", async () => {
    expect((await request(app).get('/cashouts').set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' })).status).toBe(403);

    vi.mocked(query).mockImplementation(createQueryMock([{
      match: /FROM cashouts WHERE worker_id = \$1 ORDER BY created_at DESC/,
      handler: () => ({ rows: [{
        id: CASHOUT_ID, status: 'completed', mg_status: 'processing', settlement_hash: 'h', xlm_spent: '319.5447867',
        send_usdc: '300', reference_number: '99373343', destination_country: 'ZAF', receive_amount: '4728.32',
        receive_currency: 'ZAR', fee: '10.5', fee_currency: 'USDC', error: null, created_at: '2026-10-08', completed_at: '2026-10-08',
      }] }),
    }]));
    const res = await request(app).get('/cashouts').set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body.cashouts[0]).toMatchObject({ id: CASHOUT_ID, xlmSpent: 319.5447867, referenceNumber: '99373343', sandbox: true });
    expect(vi.mocked(query).mock.calls.find(([sql]) => /FROM cashouts/.test(sql))![1]).toEqual([WORKER_ID]);
  });
});
