import { z } from 'zod';

/** A real UUID: ids go straight into UUID columns, and a malformed one would be a database error (500), not a 400. */
const id = z.guid('must be a valid id');
/** An amount typed as a number or a numeric string; the routes apply their own range and currency rules. */
const amountLike = z.union([z.number(), z.string().max(40)]);
const memo = z.string().max(200);
/** Clients mint these (UUIDs or short tokens); capped so a key cannot be used to smuggle a payload. */
const idempotencyKey = z.string().min(1).max(128);
/** An amount above zero, as a number or a numeric string; parsed to a number. */
const positiveAmount = amountLike
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n) && n > 0, 'must be a positive number');

/**
 * A positive amount kept as an exact decimal string (at most 7 places, Stellar's precision), for token math that must
 * not pass through a float: escrow tranches become i128 stroops.
 */
const positiveDecimal = amountLike
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d{1,7})?$/.test(v) && Number(v) > 0, 'must be a positive amount with at most 7 decimal places');

/** The most payments one batch (or one scheduled run, which is a batch) may make. */
export const MAX_BATCH_ITEMS = 100;

export const payoutBody = z.object({
  workerId: id,
  amount: amountLike.optional(),
  amountUsd: amountLike.optional(),
  currency: z.string().max(12).optional(),
  memo: memo.optional(),
  idempotencyKey: idempotencyKey.optional(),
});

export const batchPayoutBody = z.object({
  items: z.array(z.object({ workerId: id, amountUsd: positiveAmount, memo: memo.optional() })).min(1).max(MAX_BATCH_ITEMS),
  idempotencyKey: idempotencyKey.optional(),
});

export const createScheduleBody = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  runDay: z.string().trim().min(1, 'runDay is required').max(20),
  timezone: z.string().max(64).default('UTC'),
  items: z.array(z.object({ workerId: id, amountUsd: positiveAmount, memo: memo.optional() })).min(1).max(MAX_BATCH_ITEMS),
});

export const createEscrowBody = z.object({
  workerId: id,
  milestones: z.array(z.object({
    description: z.string().max(200).optional(),
    /** In the escrow's token (USDC: dollars). */
    amount: positiveDecimal,
  })).min(1).max(50),
  expiresAt: z.string().max(40),
  idempotencyKey: idempotencyKey.optional(),
});
