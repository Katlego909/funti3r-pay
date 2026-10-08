import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { query } from '@funti3r/database';
import * as escrowLib from '../lib/escrow.js';
import app from '../app.js';
import { createQueryMock, ENTERPRISE_ID } from './helpers.js';
import { diffEscrow, reconcileEscrows } from '../lib/escrowReconcile.js';

const ESCROW_ID = 'escrow-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
process.env.ESCROW_CONTRACT_ADDRESS = 'CESCROWCONTRACT';

const getEscrow = vi.mocked(escrowLib.getEscrow);

function chainState(overrides: Partial<escrowLib.OnchainEscrow> = {}): escrowLib.OnchainEscrow {
  return {
    enterprise: 'GENT', worker: 'GWORK', token: 'CTOKEN',
    amounts: [100n, 200n],
    milestones: ['Pending', 'Pending'],
    expiry: 0n, status: 'Active', frozen: false,
    ...overrides,
  };
}

/** Database view of the escrow + its milestones. */
function mockDb(opts: { status?: string; frozen?: boolean; milestones?: string[] } = {}) {
  const milestones = opts.milestones ?? ['pending', 'pending'];
  vi.mocked(query).mockImplementation(createQueryMock([
    {
      match: /FROM escrows\s+WHERE contract_address/,
      handler: () => ({ rows: [{ id: ESCROW_ID, onchain_escrow_id: '3', status: opts.status ?? 'active', frozen: opts.frozen ?? false }] }),
    },
    {
      match: /SELECT idx, status FROM escrow_milestones/,
      handler: () => ({ rows: milestones.map((status, idx) => ({ idx, status })) }),
    },
  ]));
}

const writes = () => vi.mocked(query).mock.calls.filter(([sql]) => /^\s*UPDATE/.test(sql));

beforeEach(() => {
  vi.mocked(query).mockReset();
  getEscrow.mockReset();
  process.env.ESCROW_CONTRACT_ADDRESS = 'CESCROWCONTRACT';
});

describe('diffEscrow', () => {
  const db = { id: ESCROW_ID, onchain_escrow_id: '3', status: 'active', frozen: false };

  it('reports nothing when the mirror matches the chain', () => {
    expect(diffEscrow(db, [{ idx: 0, status: 'pending' }, { idx: 1, status: 'pending' }], chainState())).toEqual([]);
  });

  it('maps chain enum names onto the database vocabulary', () => {
    const d = diffEscrow(db, [{ idx: 0, status: 'approved' }, { idx: 1, status: 'pending' }], chainState({ milestones: ['Claimed', 'Pending'], status: 'Completed' }));
    expect(d.map((x) => [x.field, x.db, x.chain])).toEqual([
      ['status', 'active', 'completed'],
      ['milestone[0].status', 'approved', 'claimed'],
    ]);
  });

  it('refuses to guess when the milestone counts differ', () => {
    const d = diffEscrow(db, [{ idx: 0, status: 'pending' }], chainState());
    expect(d).toEqual([expect.objectContaining({ field: 'milestones.length', db: '1', chain: '2' })]);
  });
});

describe('reconcileEscrows', () => {
  it('does nothing when the database already matches the chain', async () => {
    mockDb();
    getEscrow.mockResolvedValue(chainState());
    const r = await reconcileEscrows();
    expect(r).toEqual({ checked: 1, repaired: 0, unreadable: 0, drift: [] });
    expect(writes()).toHaveLength(0);
  });

  it('repairs a milestone the database still shows as approved but the chain shows claimed', async () => {
    mockDb({ milestones: ['approved', 'pending'] });
    getEscrow.mockResolvedValue(chainState({ milestones: ['Claimed', 'Pending'] }));

    const r = await reconcileEscrows();
    expect(r.repaired).toBe(1);
    expect(r.drift).toEqual([expect.objectContaining({ field: 'milestone[0].status', db: 'approved', chain: 'claimed' })]);
    const w = writes().find(([sql]) => /UPDATE escrow_milestones/.test(sql));
    expect(w?.[1]).toEqual([ESCROW_ID, 0, 'claimed']);
  });

  it('closes the escrow when the chain says it completed', async () => {
    mockDb({ milestones: ['approved'] });
    getEscrow.mockResolvedValue(chainState({ amounts: [100n], milestones: ['Claimed'], status: 'Completed' }));

    await reconcileEscrows();
    const w = writes().find(([sql]) => /UPDATE escrows /.test(sql));
    expect(w?.[1]).toEqual([ESCROW_ID, 'completed', false]);
  });

  it('mirrors a compliance freeze that happened on-chain', async () => {
    mockDb();
    getEscrow.mockResolvedValue(chainState({ frozen: true }));

    const r = await reconcileEscrows();
    expect(r.drift).toEqual([expect.objectContaining({ field: 'frozen', db: 'false', chain: 'true' })]);
    const w = writes().find(([sql]) => /UPDATE escrows /.test(sql));
    expect(w?.[1]).toEqual([ESCROW_ID, 'active', true]);
  });

  it('a dry run reports the drift without writing anything', async () => {
    mockDb({ milestones: ['approved', 'pending'] });
    getEscrow.mockResolvedValue(chainState({ milestones: ['Claimed', 'Pending'] }));

    const r = await reconcileEscrows({ repair: false });
    expect(r.drift).toHaveLength(1);
    expect(r.repaired).toBe(0);
    expect(writes()).toHaveLength(0);
  });

  it('leaves an escrow untouched when the chain cannot be read', async () => {
    mockDb({ milestones: ['approved', 'pending'] });
    getEscrow.mockRejectedValue(new Error('rpc timeout'));

    const r = await reconcileEscrows();
    expect(r).toMatchObject({ checked: 1, unreadable: 1, repaired: 0, drift: [] });
    expect(writes()).toHaveLength(0);
  });

  it('reports but never "repairs" a milestone-count mismatch', async () => {
    mockDb({ milestones: ['pending'] });
    getEscrow.mockResolvedValue(chainState());

    const r = await reconcileEscrows();
    expect(r.drift).toEqual([expect.objectContaining({ field: 'milestones.length' })]);
    expect(r.repaired).toBe(0);
    expect(writes()).toHaveLength(0);
  });

  it('is a no-op when no escrow contract is configured', async () => {
    delete process.env.ESCROW_CONTRACT_ADDRESS;
    expect(await reconcileEscrows()).toEqual({ checked: 0, repaired: 0, unreadable: 0, drift: [] });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('POST /escrows/reconcile', () => {
  it('403s anyone who is not a platform admin', async () => {
    const res = await request(app).post('/escrows/reconcile').set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' });
    expect(res.status).toBe(403);
    expect(getEscrow).not.toHaveBeenCalled();
  });

  it('runs a repair by default and returns the report', async () => {
    mockDb({ milestones: ['approved', 'pending'] });
    getEscrow.mockResolvedValue(chainState({ milestones: ['Claimed', 'Pending'] }));

    const res = await request(app).post('/escrows/reconcile').set({ 'x-user-id': 'admin-1', 'x-user-role': 'admin' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repair: true, checked: 1, repaired: 1 });
  });

  it('supports a dry run', async () => {
    mockDb({ milestones: ['approved', 'pending'] });
    getEscrow.mockResolvedValue(chainState({ milestones: ['Claimed', 'Pending'] }));

    const res = await request(app).post('/escrows/reconcile').set({ 'x-user-id': 'admin-1', 'x-user-role': 'admin' }).send({ repair: false });
    expect(res.body).toMatchObject({ repair: false, repaired: 0 });
    expect(res.body.drift).toHaveLength(1);
    expect(writes()).toHaveLength(0);
  });
});
