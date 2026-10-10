import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Asset, Keypair, Networks, Operation, TransactionBuilder, Account } from '@stellar/stellar-sdk';

const deleteKey = vi.fn();
vi.mock('@funti3r/database', () => ({ deleteKey: (k: string) => deleteKey(k) }));

const { accountsTouchedBy, balanceCacheKey, forgetBalances } = await import('../lib/balanceCache.js');

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const C = Keypair.random().publicKey();

beforeEach(() => deleteKey.mockReset().mockResolvedValue(undefined));

describe('forgetBalances', () => {
  it('uses the same key the balance cache reads', () => {
    expect(balanceCacheKey(A)).toBe(`stellar:balance:${A}`);
  });

  it('deletes each distinct account once and ignores empty values', async () => {
    await forgetBalances(A, B, A, undefined, null, '');
    expect(deleteKey).toHaveBeenCalledTimes(2);
    expect(deleteKey).toHaveBeenCalledWith(balanceCacheKey(A));
    expect(deleteKey).toHaveBeenCalledWith(balanceCacheKey(B));
  });

  it('never throws when Redis is down, and still clears the other accounts', async () => {
    deleteKey.mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(undefined);
    await expect(forgetBalances(A, B)).resolves.toBeUndefined();
    expect(deleteKey).toHaveBeenCalledTimes(2);
  });
});

describe('accountsTouchedBy', () => {
  const build = (op: any) =>
    new TransactionBuilder(new Account(A, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(op).setTimeout(30).build();

  it('returns the source and the destination of a payment', () => {
    const tx = build(Operation.payment({ destination: B, asset: Asset.native(), amount: '1' }));
    expect(accountsTouchedBy(tx).sort()).toEqual([A, B].sort());
  });

  it('includes an operation-level source', () => {
    const tx = build(Operation.payment({ source: C, destination: B, asset: Asset.native(), amount: '1' }));
    expect(accountsTouchedBy(tx).sort()).toEqual([A, B, C].sort());
  });

  it('includes the fee payer and the wrapped transaction of a fee bump', () => {
    const inner = build(Operation.payment({ destination: B, asset: Asset.native(), amount: '1' }));
    const feePayer = Keypair.random();
    inner.sign(Keypair.random());
    const bump = TransactionBuilder.buildFeeBumpTransaction(feePayer, '200', inner, Networks.TESTNET);
    expect(accountsTouchedBy(bump).sort()).toEqual([A, B, feePayer.publicKey()].sort());
  });

  it('copes with something that is not a transaction', () => {
    expect(accountsTouchedBy(undefined)).toEqual([]);
    expect(accountsTouchedBy({})).toEqual([]);
  });
});
