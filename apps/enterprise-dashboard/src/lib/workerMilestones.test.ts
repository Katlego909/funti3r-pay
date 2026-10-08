import { describe, it, expect } from 'vitest';
import type { Escrow, EscrowMilestone } from '../api/escrows.js';
import { buildMilestoneRows, inTab, milestoneState } from './workerMilestones.js';

const NOW = Date.parse('2026-10-08T12:00:00Z');

const milestone = (over: Partial<EscrowMilestone> = {}): EscrowMilestone => ({
  idx: 0, description: 'Test', amountXlm: 10, status: 'pending', approvedAt: null, claimedAt: null, claimTxHash: null,
  approveTxHash: null, refundTxHash: null, reviewStatus: 'none', ...over,
});
const escrow = (ms: EscrowMilestone[], over: Partial<Escrow> = {}): Escrow => ({
  id: 'e1', workerEmail: 'w@x.io', onchainEscrowId: '1', contractAddress: 'C', tokenCode: 'XLM', totalXlm: 10,
  status: 'active', frozen: false, expiresAt: '2026-10-16T00:00:00Z', createTxHash: null,
  createdAt: '2026-10-08T10:00:00Z', milestones: ms, reviewEvents: [], ...over,
} as Escrow);

describe('milestoneState', () => {
  it('follows the milestone lifecycle', () => {
    const e = escrow([]);
    expect(milestoneState(e, milestone(), NOW)).toMatchObject({ label: 'Not submitted', group: 'todo' });
    expect(milestoneState(e, milestone({ reviewStatus: 'submitted' }), NOW)).toMatchObject({ label: 'Submitted for review', group: 'waiting' });
    expect(milestoneState(e, milestone({ reviewStatus: 'rejected' }), NOW)).toMatchObject({ label: 'Changes requested', group: 'todo' });
    expect(milestoneState(e, milestone({ status: 'approved' }), NOW)).toMatchObject({ label: 'Ready to claim', group: 'todo' });
    expect(milestoneState(e, milestone({ status: 'claimed' }), NOW)).toMatchObject({ label: 'Claimed', group: 'done' });
    expect(milestoneState(e, milestone({ status: 'refunded' }), NOW)).toMatchObject({ label: 'Refunded', group: 'done' });
  });

  it('flags a frozen escrow and an expired unsubmitted milestone', () => {
    expect(milestoneState(escrow([], { frozen: true }), milestone({ status: 'approved' }), NOW)).toMatchObject({ label: 'On compliance hold', group: 'waiting' });
    expect(milestoneState(escrow([], { expiresAt: '2026-10-01T00:00:00Z' }), milestone(), NOW)).toMatchObject({ label: 'Expired', group: 'done' });
  });
});

describe('buildMilestoneRows / inTab', () => {
  const older = escrow([milestone({ status: 'claimed' })], { id: 'old', createdAt: '2026-10-01T00:00:00Z' });
  const claimed = escrow([milestone({ status: 'claimed' })], { id: 'claimed', createdAt: '2026-10-03T00:00:00Z' });
  const ready = escrow([milestone({ status: 'approved' })], { id: 'ready', createdAt: '2026-10-04T00:00:00Z' });
  const review = escrow([milestone({ reviewStatus: 'submitted' })], { id: 'review', createdAt: '2026-10-05T00:00:00Z' });
  const rows = buildMilestoneRows([older, review, claimed, ready], NOW);

  it('puts what needs the worker first, then what waits on others, then finished work', () => {
    expect(rows.map((r) => r.escrow.id)).toEqual(['ready', 'review', 'claimed', 'old']);
  });

  it('splits Active and Finished', () => {
    const ids = (tab: 'active' | 'finished' | 'all') => rows.filter((r) => inTab(r, tab)).map((r) => r.escrow.id);
    expect(ids('active')).toEqual(['ready', 'review']);
    expect(ids('finished')).toEqual(['claimed', 'old']);
    expect(ids('all')).toHaveLength(4);
  });
});
