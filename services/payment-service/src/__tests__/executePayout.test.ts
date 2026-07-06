import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import { executePayout, payoutPayloadHash } from '../app.js';
import {
  createQueryMock,
  WORKER_ID,
  ENTERPRISE_ID,
  WORKER_ROW,
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
      createQueryMock([{ match: /SELECT stellar_public_key, stellar_secret_key, email FROM users/, handler: () => ({ rows: [] }) }]),
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
    vi.mocked(stellar.payExactWithXlm).mockRejectedValue({
      response: { data: { extras: { result_codes: { operations: ['op_no_trust'] } } } },
    });
    vi.mocked(stellar.createClaimableBalance).mockResolvedValue('tx-hash-claimable-1');

    const result = await executePayout({ ...baseOpts, amountNum: 10, asset: 'USDC' });

    expect(result.status).toBe('pending_claim');
    expect(result.stellarTxHash).toBe('tx-hash-claimable-1');
    expect(stellar.createClaimableBalance).toHaveBeenCalledTimes(1);
  });

  it('a genuine Stellar submission error marks the payment failed', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]));
    vi.mocked(stellar.sendPayment).mockRejectedValue(new Error('tx_failed: op_underfunded'));

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

  it('an initiated (in-flight) row under the same key returns 409, zero Stellar calls', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([{
        match: /idempotency_key = \$2/,
        handler: () => ({ rows: [{ id: 'existing-payment-id', status: 'initiated', payload_hash: matchingHash }] }),
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
