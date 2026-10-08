import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { Keypair, Memo } from '@stellar/stellar-sdk';
import { query } from '@funti3r/database';
import app from '../app.js';
import { ensureCleared, ComplianceBlockedError } from '../lib/clearance.js';
import { payExactWithXlm } from '../lib/stellar.js';
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

const ESCROW_ID = 'escrow-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const workerHeaders = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };
const WALLET = Keypair.random().publicKey();
const DEPOSIT = Keypair.random().publicKey();
const MEMO = '1789043683987597792';

const record = (over: Partial<mg.RampsTransaction> = {}): mg.RampsTransaction => ({
  id: 'mg-tx-1', mgiTransactionId: 'mgi-1', customerIdentifier: WORKER_ID, type: 'cash-out', status: 'awaiting_funds',
  depositAddress: DEPOSIT, depositMemo: MEMO, depositExpiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  sendAmount: 10, sendAsset: 'USDC', sendChain: 'stellar', sourceWalletAddress: WALLET, referenceNumber: '33031948',
  receiveAmount: '114.23', receiveCurrency: 'ZAR', destinationCountry: 'ZAF', feeTotal: '3.00', feeCurrency: 'USDC',
  createdAt: null, updatedAt: null, ...over,
});
const body = (over: Record<string, unknown> = {}) => ({ address: DEPOSIT, memo: MEMO, amount: '10', ...over });

function milestone(over: Record<string, unknown> = {}) {
  return {
    match: /SELECT m\.status, m\.amount, m\.cashout_status, m\.cashout_rail/,
    handler: () => ({
      rows: [{
        status: 'claimed', amount: '100', cashout_status: 'action_required', cashout_rail: 'moneygram',
        anchor_tx_id: null, anchor_settlement_hash: null, frozen: false, ...over,
      }],
    }),
  };
}
const NO_MILESTONE = { match: /SELECT m\.status, m\.amount, m\.cashout_status/, handler: () => ({ rows: [] }) };
const PUBKEY = { match: /^SELECT stellar_public_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_public_key: WALLET }] }) };
const SECRET = { match: /^SELECT stellar_secret_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_secret_key: 'SFAKESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }) };
const TAKE = { match: /SET cashout_status = 'pending', anchor_tx_id = \$3/, handler: () => ({ rows: [{ amount: '100' }] }) };
const TAKE_LOST = { match: /SET cashout_status = 'pending', anchor_tx_id = \$3/, handler: () => ({ rows: [] }) };

const calls = (re: RegExp) => vi.mocked(query).mock.calls.filter(([sql]) => re.test(sql));
const deposit = (b = body(), headers: Record<string, string> = workerHeaders) =>
  request(app).post(`/escrows/${ESCROW_ID}/milestones/0/ramps/deposit`).set(headers).send(b);
const session = (headers: Record<string, string> = workerHeaders) =>
  request(app).post(`/escrows/${ESCROW_ID}/milestones/0/ramps/session`).set(headers);

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(ensureCleared).mockReset().mockResolvedValue({ cleared: true });
  vi.mocked(payExactWithXlm).mockReset().mockResolvedValue({ hash: 'usdc-payment-hash', sourceAmountXlm: '92.6' });
  vi.mocked(awaitRampsAcknowledgement).mockReset().mockResolvedValue('received');
  vi.mocked(mg.moneygramConfigured).mockReset().mockReturnValue(true);
  vi.mocked(mg.createSession).mockReset();
  vi.mocked(mg.listTransactions).mockReset().mockResolvedValue([record()]);
});

describe('POST .../ramps/session', () => {
  it('403s anyone but the worker, and 400s when MoneyGram is not configured', async () => {
    expect((await session({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' })).status).toBe(403);
    vi.mocked(mg.moneygramConfigured).mockReturnValue(false);
    expect((await session()).status).toBe(400);
    expect(mg.createSession).not.toHaveBeenCalled();
  });

  it('404s a milestone that is not the worker\'s; 409s one that is unclaimed, in flight or done', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([NO_MILESTONE]));
    expect((await session()).status).toBe(404);
    for (const over of [{ status: 'approved' }, { cashout_status: 'pending' }, { cashout_status: 'completed' }]) {
      vi.mocked(query).mockImplementation(createQueryMock([milestone(over), PUBKEY]));
      expect((await session()).status).toBe(409);
    }
    expect(mg.createSession).not.toHaveBeenCalled();
  });

  it('refuses a frozen escrow and a worker who fails the compliance re-screen', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([milestone({ frozen: true }), PUBKEY]));
    expect((await session()).status).toBe(403);

    vi.mocked(query).mockImplementation(createQueryMock([milestone(), PUBKEY]));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker is blocked pending compliance review (sanctions match)'));
    const res = await session();
    expect(res.status).toBe(403);
    expect(mg.createSession).not.toHaveBeenCalled();
  });

  it('opens a custodial session for this worker and marks the cash-out as awaiting the widget', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([milestone({ cashout_status: 'none', cashout_rail: 'anchor' }), PUBKEY]));
    vi.mocked(mg.createSession).mockResolvedValue({ sessionId: 's1', sessionToken: 'session-token', widgetUrl: 'https://playground.xramps.moneygram.com/sdk/widget.html?mode=off-ramp' });

    const res = await session();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionToken: 'session-token', widgetUrl: expect.stringContaining('widget.html'),
      publicKey: 'ramps_pk_sbox_public', walletAddress: WALLET, maxXlm: 100,
    });
    expect(mg.createSession).toHaveBeenCalledWith({ customerIdentifier: WORKER_ID, walletAddress: WALLET });
    expect(calls(/SET cashout_rail = 'moneygram', cashout_status = 'action_required'/)).toHaveLength(1);
  });

  it('never returns the secret key', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([milestone(), PUBKEY]));
    vi.mocked(mg.createSession).mockResolvedValue({ sessionId: 's1', sessionToken: 't', widgetUrl: 'https://playground.xramps.moneygram.com/sdk/widget.html' });
    process.env.MONEYGRAM_SK = 'ramps_sk_sbox_should_never_leak';
    const res = await session();
    expect(JSON.stringify(res.body)).not.toContain('ramps_sk_');
    delete process.env.MONEYGRAM_SK;
  });
});

describe('POST .../ramps/deposit', () => {
  const base = [milestone(), PUBKEY, SECRET];

  it('400s a malformed request before touching anything', async () => {
    for (const bad of [{}, { address: DEPOSIT }, body({ memo: '' }), body({ amount: '0' }), body({ address: 5 })]) {
      expect((await deposit(bad as never)).status).toBe(400);
    }
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('is idempotent: a repeated request after we paid returns the same payment and pays nothing', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([milestone({ anchor_settlement_hash: 'usdc-payment-hash' })]));
    const res = await deposit();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ txHash: 'usdc-payment-hash', alreadyPaid: true });
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('409s unless the MoneyGram cash-out was started first', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([milestone({ cashout_rail: 'anchor', cashout_status: 'none' })]));
    expect((await deposit()).status).toBe(409);
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

  it('refuses a swapped address, an inflated amount, and another customer\'s transaction', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(base));
    const attacker = Keypair.random().publicKey();
    expect((await deposit(body({ address: attacker }))).status).toBe(409);
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

  it('409s when another request already took this cash-out, and when the MoneyGram transaction was used before', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...base, TAKE_LOST]));
    expect((await deposit()).status).toBe(409);

    vi.mocked(query).mockImplementation(vi.fn(async (sql: string, params?: unknown[]) => {
      if (/SET cashout_status = 'pending', anchor_tx_id = \$3/.test(sql)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      return createQueryMock(base)(sql, params);
    }) as never);
    const res = await deposit();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already used/);
    expect(payExactWithXlm).not.toHaveBeenCalled();
  });

  it('pays exactly the USDC MoneyGram asked for, straight to its deposit address with its memo, capped at the milestone\'s XLM', async () => {
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
    expect(opts.sendMaxXlm).toBe('100.0000000'); // the milestone's own amount — a hard on-chain ceiling
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
    expect(calls(/SET anchor_settlement_hash = \$3, cashout_xlm_spent = \$4/)[0][1]).toEqual([ESCROW_ID, 0, 'usdc-payment-hash', '92.6']);
    expect(awaitRampsAcknowledgement).toHaveBeenCalledWith(ESCROW_ID, 0, 'mg-tx-1');
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
    vi.mocked(payExactWithXlm).mockRejectedValue(new Error('No DEX path to deliver 10 USDC'));
    const res = await deposit();
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/No DEX path/);
    expect(calls(/cashout_status = 'failed', cashout_error = \$3/)).toHaveLength(1);
    expect(calls(/SET anchor_settlement_hash/)).toHaveLength(0);
    expect(awaitRampsAcknowledgement).not.toHaveBeenCalled();
  });
});
