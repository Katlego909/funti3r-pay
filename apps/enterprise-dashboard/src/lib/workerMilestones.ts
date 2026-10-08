import type { Escrow, EscrowMilestone } from '../api/escrows.js';

export type Variant = 'completed' | 'failed' | 'pending';

/** What the worker has to do about a milestone: act now, wait on someone else, or nothing. */
export type MilestoneGroup = 'todo' | 'waiting' | 'done';

export interface MilestoneState {
  variant: Variant;
  label: string;
  group: MilestoneGroup;
}

export interface PayoutState {
  variant: Variant;
  label: string;
  /** Whether trying the anchor payout again can succeed. */
  retryable: boolean;
}

/** The test anchor refuses payouts above its own limit; asking again never helps. */
const ANCHOR_LIMIT_ERROR = /maximum disbursement|only pays out up to/i;

/** Where a milestone is in its life: submit -> review -> approve -> claim. Cash-outs are not part of it. */
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

/** The separate bank payout through the anchor; null when none was ever started. */
export function payoutState(m: EscrowMilestone): PayoutState | null {
  if (m.status !== 'claimed') return null;
  switch (m.cashoutStatus) {
    case 'completed': return { variant: 'completed', label: 'Paid out via anchor', retryable: false };
    case 'pending': return { variant: 'pending', label: 'In progress', retryable: false };
    case 'action_required': return { variant: 'pending', label: 'Needs your step', retryable: false };
    case 'failed':
      return ANCHOR_LIMIT_ERROR.test(m.cashoutError ?? '')
        ? { variant: 'failed', label: 'Over the test anchor limit', retryable: false }
        : { variant: 'failed', label: 'Payout failed', retryable: true };
    default: return null;
  }
}

export interface MilestoneRow {
  escrow: Escrow;
  milestone: EscrowMilestone;
  state: MilestoneState;
  payout: PayoutState | null;
}

export type MilestoneTab = 'active' | 'finished' | 'all';

/** A claimed milestone whose bank payout still needs the worker is not finished. */
function effectiveGroup(row: MilestoneRow): MilestoneGroup {
  if (row.state.group === 'done' && row.milestone.status === 'claimed'
    && (row.milestone.cashoutStatus === 'action_required' || row.payout?.retryable)) return 'todo';
  return row.state.group;
}

const RANK: Record<MilestoneGroup, number> = { todo: 0, waiting: 1, done: 2 };

/** Every milestone as a row: what needs the worker first, finished work last, newest first within each. */
export function buildMilestoneRows(escrows: Escrow[], now = Date.now()): MilestoneRow[] {
  return escrows
    .flatMap((escrow) => escrow.milestones.map((milestone) => ({
      escrow, milestone, state: milestoneState(escrow, milestone, now), payout: payoutState(milestone),
    })))
    .sort((a, b) =>
      RANK[effectiveGroup(a)] - RANK[effectiveGroup(b)]
      || Date.parse(b.escrow.createdAt) - Date.parse(a.escrow.createdAt)
      || a.milestone.idx - b.milestone.idx);
}

export function inTab(row: MilestoneRow, tab: MilestoneTab): boolean {
  if (tab === 'all') return true;
  return (effectiveGroup(row) === 'done') === (tab === 'finished');
}
