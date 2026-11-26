import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Account, FeeBumpTransaction, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

// setup.ts replaces lib/stellar.js for the route tests; here the real sponsorship logic is the unit under test, with
// Horizon's network calls stubbed on the SDK prototype (the module builds its Horizon.Server at load time).
const sponsor = Keypair.random();
process.env.STELLAR_SPONSOR_SECRET = sponsor.secret();
// A real key: these tests build real transactions, and setup.ts's issuer is only a placeholder string.
const USDC = { code: 'USDC', issuer: Keypair.random().publicKey() };

/** What Horizon reports for an account: its sequence and native balance (no other entries). */
interface Fake { sequence: string; xlm: string }
const accounts = new Map<string, Fake>();
const submitted: Array<Parameters<Horizon.Server['submitTransaction']>[0]> = [];
/** An account on chain with `xlm` of its own, on top of the 1 XLM minimum balance an account with no entries keeps. */
const onChain = (kp: Keypair, xlm: string) => accounts.set(kp.publicKey(), { sequence: '100', xlm });

vi.spyOn(Horizon.Server.prototype, 'loadAccount').mockImplementation(async (id: string) => {
  const a = accounts.get(id);
  if (!a) throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  // A real Account (it carries the sequence number the builder uses) with the fields Horizon adds.
  return Object.assign(new Account(id, a.sequence), {
    subentry_count: 0, num_sponsoring: 0, num_sponsored: 0,
    balances: [{ asset_type: 'native', balance: String(Number(a.xlm) + 1), selling_liabilities: '0', buying_liabilities: '0' }],
  }) as never;
});
vi.spyOn(Horizon.Server.prototype, 'fetchBaseFee').mockResolvedValue(100);
vi.spyOn(Horizon.Server.prototype, 'submitTransaction').mockImplementation(async (tx) => {
  submitted.push(tx);
  return { hash: tx.hash().toString('hex') } as never;
});

const stellar = await vi.importActual<typeof import('../lib/stellar.js')>('../lib/stellar.js');

beforeEach(() => { accounts.clear(); submitted.length = 0; onChain(sponsor, '1000'); });

describe('buildSponsoredAccountTx', () => {
  it('creates the account with no XLM of its own and its trustlines, every reserve paid by the sponsor', () => {
    const worker = Keypair.random();
    const tx = stellar.buildSponsoredAccountTx({
      sponsorAccount: new Account(sponsor.publicKey(), '7'), sponsor, account: worker, trustlines: [USDC],
      fee: '1000', networkPassphrase: Networks.TESTNET,
    });
    expect(tx.source).toBe(sponsor.publicKey()); // the sponsor is the source and pays the fee
    expect(tx.operations.map((o) => o.type)).toEqual([
      'beginSponsoringFutureReserves', 'createAccount', 'changeTrust', 'endSponsoringFutureReserves',
    ]);
    const [begin, create, trust, end] = tx.operations as any[];
    expect(begin.sponsoredId).toBe(worker.publicKey());
    expect(create.destination).toBe(worker.publicKey());
    expect(create.startingBalance).toBe('0.0000000');
    expect(trust.source).toBe(worker.publicKey());
    expect(trust.line.code).toBe('USDC');
    expect(end.source).toBe(worker.publicKey()); // the sponsored account closes the sponsorship: it must sign
    expect(tx.signatures).toHaveLength(2);
    expect(stellar.sponsoredReserveXlm(1)).toBe('1.5000000');
  });
});

describe('feeEnvelope', () => {
  const inner = (source: Keypair) => {
    const tx = new TransactionBuilder(new Account(source.publicKey(), '1'), { fee: '1000', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.bumpSequence({ bumpTo: '2' })).setTimeout(60).build();
    tx.sign(source);
    return tx;
  };

  it('leaves a transaction alone when its source can pay its own fee', () => {
    const tx = inner(Keypair.random());
    expect(stellar.feeEnvelope(tx, 10_000n)).toBe(tx);
  });

  it('wraps it in a fee bump paid and signed by the sponsor when the source has no XLM', () => {
    const tx = inner(Keypair.random());
    const env = stellar.feeEnvelope(tx, 0n);
    expect(env).toBeInstanceOf(FeeBumpTransaction);
    const bump = env as FeeBumpTransaction;
    expect(bump.feeSource).toBe(sponsor.publicKey());
    expect(bump.innerTransaction.hash().equals(tx.hash())).toBe(true);
    expect(bump.signatures).toHaveLength(1);
  });
});

describe('activateAccount', () => {
  it('creates a missing account, sponsored, in one transaction', async () => {
    const worker = Keypair.random();
    const r = await stellar.activateAccount(worker.secret(), [USDC]);
    expect(r.created).toBe(true);
    expect(submitted).toHaveLength(1);
    const tx = submitted[0] as any;
    expect(tx.source).toBe(sponsor.publicKey());
    expect(tx.operations.map((o: any) => o.type)).toContain('createAccount');
  });

  it('does not create an account that exists; it only adds a missing trustline, sponsored and fee-bumped when the account has no XLM', async () => {
    const worker = Keypair.random();
    onChain(worker, '0');
    const r = await stellar.activateAccount(worker.secret(), [USDC]);
    expect(r.created).toBe(false);
    expect(submitted).toHaveLength(1);
    const bump = submitted[0] as FeeBumpTransaction;
    expect(bump).toBeInstanceOf(FeeBumpTransaction); // the worker cannot pay the fee
    expect(bump.feeSource).toBe(sponsor.publicKey());
    expect(bump.innerTransaction.source).toBe(worker.publicKey()); // still the worker's own transaction
    expect(bump.innerTransaction.operations.map((o) => o.type)).toEqual([
      'beginSponsoringFutureReserves', 'changeTrust', 'endSponsoringFutureReserves',
    ]);
  });

  it('lets an account with XLM of its own open its trustline itself', async () => {
    const worker = Keypair.random();
    onChain(worker, '10');
    await stellar.activateAccount(worker.secret(), [USDC]);
    const tx = submitted[0] as any;
    expect(tx).not.toBeInstanceOf(FeeBumpTransaction);
    expect(tx.operations.map((o: any) => o.type)).toEqual(['changeTrust']);
  });

  it('turns a creation with no verdict into a plain failure, never a "submitted" payment', async () => {
    vi.mocked(Horizon.Server.prototype.submitTransaction).mockRejectedValueOnce(new Error('socket hang up'));
    await expect(stellar.activateAccount(Keypair.random().secret(), [USDC])).rejects.toMatchObject({ code: 'account_activation_unconfirmed' });
  });
});
