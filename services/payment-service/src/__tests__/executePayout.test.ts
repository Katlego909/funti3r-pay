import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import { amountToUsd, getXlmUsd } from '../lib/fx.js';
import { executePayout, payoutPayloadHash } from '../app.js';

// The claimable-balance fallback prices the payout in XLM via live FX — pin the
// rates so the conversion is assertable (and no real HTTP is attempted).
vi.mock('../lib/fx.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fx.js')>();
  return { ...actual, amountToUsd: vi.fn(), getXlmUsd: vi.fn() };
});
import {
  createQueryMock,
  WORKER_ID,
  ENTERPRISE_ID,
  HANDLER_NO_EXISTING_IDEMPOTENCY_ROW,
  HANDLER_WORKER_FOUND,
  HANDLER_INSERT_PAYMENT,
} from './helpers.js';

const baseOpts = {
  enterpriseId: ENTERPRISE_ID,
  sourceSecret: 'SSOURCESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  workerId: WORKER_ID,
};

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(stellar.sendPayment).mockReset();
  vi.mocked(stellar.ensureTrustline).mockReset();
  vi.mocked(stellar.payExactWithXlm).mockReset();
  vi.mocked(stellar.createClaimableBalance).mockReset();
  // Defaults: USDC is 1:1 with USD, XLM trades at $0.25.
  vi.mocked(amountToUsd).mockReset().mockImplementation(async (code, amount) => (code === 'USDC' ? amount : 0));
  vi.mocked(getXlmUsd).mockReset().mockResolvedValue(0.25);
});

describe('executePayout — legacy path (no idempotency key)', () => {
  it('records and completes a native XLM payment', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-hash-native-1');

    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    expect(result.status).toBe('completed');
    expect(result.stellarTxHash).toBe('tx-hash-native-1');
    expect(stellar.sendPayment).toHaveBeenCalledTimes(1);
  });

  it('unsupported currency fails before any DB or Stellar call', async () => {
    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'ZZZ' });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Unsupported currency/);
    expect(query).not.toHaveBeenCalled();
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('KYC gate failure blocks the payout before any Stellar call', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'pending' } });
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));

    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/KYC not verified/);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('worker with no Stellar account fails, no payment row inserted', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([{ match: /SELECT stellar_public_key, stellar_secret_key, email/, handler: () => ({ rows: [] }) }]),
    );

    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/Worker Stellar account not found/);
  });

  it('issued asset (USDC) success sets up trustline and pays via path payment', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-hash-usdc-1', sourceAmountXlm: '5.1234567' });

    const result = await executePayout({ ...baseOpts, amountNum: 10, asset: 'USDC' });

    expect(result.status).toBe('completed');
    expect(result.sourceAmountXlm).toBe('5.1234567');
    expect(stellar.ensureTrustline).toHaveBeenCalledTimes(1);
    expect(stellar.payExactWithXlm).toHaveBeenCalledTimes(1);
  });

  it('op_no_trust falls back to a claimable balance (pending_claim)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.payExactWithXlm).mockRejectedValue(new stellar.HorizonRejectedError({ operations: ['op_no_trust'] }, null));
    vi.mocked(stellar.createClaimableBalance).mockResolvedValue('tx-hash-claimable-1');

    const result = await executePayout({ ...baseOpts, amountNum: 10, asset: 'USDC' });

    expect(result.status).toBe('pending_claim');
    expect(result.stellarTxHash).toBe('tx-hash-claimable-1');
    expect(stellar.createClaimableBalance).toHaveBeenCalledTimes(1);
    // $10 of USDC at $0.25/XLM → 40 XLM held for the worker.
    expect(vi.mocked(stellar.createClaimableBalance).mock.calls[0][3]).toBe('40.0000000');
  });

  it('op_no_trust fallback converts a local-currency amount to XLM, not the raw number', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.payExactWithXlm).mockRejectedValue(new stellar.HorizonRejectedError({ operations: ['op_no_trust'] }, null));
    vi.mocked(stellar.createClaimableBalance).mockResolvedValue('tx-hash-claimable-ngn');
    vi.mocked(amountToUsd).mockResolvedValue(50); // 75,000 NGN ≈ $50

    const result = await executePayout({ ...baseOpts, amountNum: 75000, asset: 'NGN' });

    expect(result.status).toBe('pending_claim');
    // $50 at $0.25/XLM → 200 XLM — NOT a 75,000 XLM claimable balance.
    expect(vi.mocked(stellar.createClaimableBalance).mock.calls[0][3]).toBe('200.0000000');
  });

  it('op_no_trust fallback fails the payout when FX is unavailable instead of guessing an amount', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.payExactWithXlm).mockRejectedValue(new stellar.HorizonRejectedError({ operations: ['op_no_trust'] }, null));
    vi.mocked(getXlmUsd).mockResolvedValue(0);

    const result = await executePayout({ ...baseOpts, amountNum: 75000, asset: 'NGN' });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/XLM price .* unavailable or out of date/);
    expect(stellar.createClaimableBalance).not.toHaveBeenCalled();
  });

  it('a submission Horizon never answered is left submitted (202), not failed', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.sendPayment).mockRejectedValue(new stellar.SubmitOutcomeUnknownError('txhash', new Error('timeout')));

    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    expect(result.status).toBe('submitted');
    expect(result.httpStatus).toBe(202);
    const sql = vi.mocked(query).mock.calls.map(([q]) => String(q));
    expect(sql.some((q) => q.includes("status = 'submitted'"))).toBe(true);
    expect(sql.some((q) => q.includes("status = 'failed'"))).toBe(false);
  });

  it('stores the signed hash and time bound before submitting', async () => {
    const intent = { match: /SET stellar_tx_hash = \$1, tx_max_time = \$2/, handler: () => ({ rows: [{ id: 'p' }] }) };
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT, intent]));
    const order: string[] = [];
    vi.mocked(stellar.sendPayment).mockImplementation(async (...args: any[]) => {
      await args[6]('tx-signed', new Date('2026-11-09T10:01:00Z'));
      order.push('submit');
      return 'tx-signed';
    });

    await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    const call = vi.mocked(query).mock.calls.find(([q]) => intent.match.test(String(q)))!;
    expect(String(call[0])).toContain("status = 'initiated'");
    expect(call[1]?.slice(0, 2)).toEqual(['tx-signed', new Date('2026-11-09T10:01:00Z')]);
    expect(order).toEqual(['submit']);
  });

  it('submits nothing when the row is no longer initiated (the watchdog settled it meanwhile)', async () => {
    const intentLost = { match: /SET stellar_tx_hash = \$1, tx_max_time = \$2/, handler: () => ({ rows: [] }) };
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT, intentLost]));
    const submit = vi.fn();
    vi.mocked(stellar.sendPayment).mockImplementation(async (...args: any[]) => {
      await args[6]('tx-late', new Date());
      submit();
      return 'tx-late';
    });

    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    expect(submit).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    // Its failure write is guarded too, so it cannot overwrite whatever the watchdog recorded.
    const failed = vi.mocked(query).mock.calls.find(([q]) => String(q).includes("SET status = 'failed'"))!;
    expect(String(failed[0])).toContain("AND status = 'initiated'");
  });

  it('a payment that landed but whose success write is lost stays submitted (202) — never failed, so a retry cannot pay twice', async () => {
    const settleFails = { match: /WHERE id = \$4 AND status IN \('initiated', 'submitted'\)/, handler: () => { throw new Error('connection reset'); } };
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT, settleFails]));
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-landed');

    const result = await executePayout({ ...baseOpts, amountNum: 5, asset: 'XLM' });

    expect(result.status).toBe('submitted');
    expect(result.httpStatus).toBe(202);
    expect(result.stellarTxHash).toBe('tx-landed');
    const sql = vi.mocked(query).mock.calls.map(([q]) => String(q));
    expect(sql.some((q) => q.includes("status = 'failed'"))).toBe(false);
  });

  it('a genuine Stellar submission error marks the payment failed', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.sendPayment).mockRejectedValue(new stellar.HorizonRejectedError({ transaction: 'tx_failed', operations: ['op_underfunded'] }, null));

    const result = await executePayout({ ...baseOpts, amountNum: 999999999, asset: 'XLM' });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/op_underfunded/);
  });
});

describe('executePayout — idempotency state machine', () => {
  const KEY = 'idem-key-1';
  const AMOUNT = 5;
  const ASSET = 'XLM';
  const matchingHash = payoutPayloadHash(WORKER_ID, AMOUNT, ASSET);

  it('no existing row proceeds normally and stores the key + payload hash', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([HANDLER_NO_EXISTING_IDEMPOTENCY_ROW, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-hash-idem-1');

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.status).toBe('completed');
    expect(stellar.sendPayment).toHaveBeenCalledTimes(1);
  });

  it('a different payload under the same key is rejected (422), zero Stellar calls', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([{
        match: /idempotency_key = \$2/,
        handler: () => ({ rows: [{ id: 'p1', status: 'completed', payload_hash: 'not-the-real-hash' }] }),
      }]),
    );

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.httpStatus).toBe(422);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('a completed row under the same key replays the cached result, zero Stellar calls', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([{
        match: /idempotency_key = \$2/,
        handler: () => ({
          rows: [{ id: 'p1', status: 'completed', payload_hash: matchingHash, stellar_tx_hash: 'cached-tx-hash', fee_paid_xlm: null }],
        }),
      }]),
    );

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.status).toBe('completed');
    expect(result.stellarTxHash).toBe('cached-tx-hash');
    expect(stellar.sendPayment).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1); // only the idempotency lookup — nothing else
  });

  it('a failed row under the same key resumes via CAS and re-attempts Stellar', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([
        { match: /idempotency_key = \$2/, handler: () => ({ rows: [{ id: 'existing-payment-id', status: 'failed', payload_hash: matchingHash }] }) },
        { match: /UPDATE payments SET status = 'initiated'/, handler: () => ({ rows: [{ id: 'existing-payment-id' }] }) },
        HANDLER_WORKER_FOUND,
      ]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-hash-resumed');

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.status).toBe('completed');
    expect(result.paymentId).toBe('existing-payment-id');
    expect(stellar.sendPayment).toHaveBeenCalledTimes(1); // real re-attempt, not a cached replay
  });

  it('a failed row that loses the CAS race returns 409, zero Stellar calls', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([
        { match: /idempotency_key = \$2/, handler: () => ({ rows: [{ id: 'existing-payment-id', status: 'failed', payload_hash: matchingHash }] }) },
        { match: /UPDATE payments SET status = 'initiated'/, handler: () => ({ rows: [] }) }, // lost the race
      ]),
    );

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.httpStatus).toBe(409);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it.each(['initiated', 'submitted'])('a %s (in-flight) row under the same key returns 409, zero Stellar calls', async (status) => {
    vi.mocked(query).mockImplementation(
      createQueryMock([{
        match: /idempotency_key = \$2/,
        handler: () => ({ rows: [{ id: 'existing-payment-id', status, payload_hash: matchingHash }] }),
      }]),
    );

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.httpStatus).toBe(409);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('a concurrent insert race (23505) is reported as 409, not a generic failure', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([
        HANDLER_NO_EXISTING_IDEMPOTENCY_ROW,
        HANDLER_WORKER_FOUND,
        {
          match: /INSERT INTO payments/,
          handler: () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }); },
        },
      ]),
    );

    const result = await executePayout({ ...baseOpts, amountNum: AMOUNT, asset: ASSET, idempotencyKey: KEY });

    expect(result.httpStatus).toBe(409);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });
});
