import type { Escrow, EscrowMilestone } from '../api/escrows.js';

export type Variant = 'completed' | 'failed' | 'pending';

/** What the worker has to do about a milestone: act now, wait on someone else, or nothing. */
export type MilestoneGroup = 'todo' | 'waiting' | 'done';

export interface MilestoneState {
  variant: Variant;
  label: string;
  group: MilestoneGroup;
}

/** Where a milestone is in its life: submit -> review -> approve -> claim. Cashing out is a wallet matter. */
export function milestoneState(e: Escrow, m: EscrowMilestone, now = Date.now()): MilestoneState {
  if (m.status === 'refunded') return { variant: 'failed', label: 'Refunded', group: 'done' };
  if (m.status === 'claimed') return { variant: 'completed', label: 'Claimed', group: 'done' };
  if (e.frozen) return { variant: 'failed', label: 'On compliance hold', group: 'waiting' };
  if (m.status === 'approved') return { variant: 'pending', label: 'Ready to claim', group: 'todo' };
  if (m.reviewStatus === 'submitted') return { variant: 'pending', label: 'Submitted for review', group: 'waiting' };
  if (Date.parse(e.expiresAt) < now) return { variant: 'failed', label: 'Expired', group: 'done' };
  if (m.reviewStatus === 'rejected') return { variant: 'failed', label: 'Changes requested', group: 'todo' };
  return { variant: 'pending', label: 'Not submitted', group: 'todo' };
}

export interface MilestoneRow {
  escrow: Escrow;
  milestone: EscrowMilestone;
  state: MilestoneState;
}

export type MilestoneTab = 'active' | 'finished' | 'all';

const RANK: Record<MilestoneGroup, number> = { todo: 0, waiting: 1, done: 2 };

/** Every milestone as a row: what needs the worker first, finished work last, newest first within each. */
export function buildMilestoneRows(escrows: Escrow[], now = Date.now()): MilestoneRow[] {
  return escrows
    .flatMap((escrow) => escrow.milestones.map((milestone) => ({
      escrow, milestone, state: milestoneState(escrow, milestone, now),
    })))
    .sort((a, b) =>
      RANK[a.state.group] - RANK[b.state.group]
      || Date.parse(b.escrow.createdAt) - Date.parse(a.escrow.createdAt)
      || a.milestone.idx - b.milestone.idx);
}

export function inTab(row: MilestoneRow, tab: MilestoneTab): boolean {
  if (tab === 'all') return true;
  return (row.state.group === 'done') === (tab === 'finished');
}
