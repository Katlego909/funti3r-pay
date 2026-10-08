import { z } from 'zod';

/** A real UUID: ids go straight into UUID columns, and a malformed one would be a database error (500), not a 400. */
const id = z.string().uuid('must be a valid id');
/** An amount typed as a number or a numeric string; the routes apply their own range and currency rules. */
const amountLike = z.union([z.number(), z.string().max(40)]);
const memo = z.string().max(200);
/** Clients mint these (UUIDs or short tokens); capped so a key cannot be used to smuggle a payload. */
const idempotencyKey = z.string().min(1).max(128);

export const payoutBody = z.object({
  workerId: id,
  amount: amountLike.optional(),
  amountUsd: amountLike.optional(),
  currency: z.string().max(12).optional(),
  memo: memo.optional(),
  idempotencyKey: idempotencyKey.optional(),
});

export const batchPayoutBody = z.object({
  // More than 100 is refused by the route with its own message; the schema just keeps the array bounded.
  items: z.array(z.object({ workerId: id, amountUsd: amountLike, memo: memo.optional() })).max(1000),
  idempotencyKey: idempotencyKey.optional(),
});

export const createEscrowBody = z.object({
  workerId: id,
  milestones: z.array(z.object({
    description: z.string().max(200).optional(),
    amountXlm: amountLike,
  })).min(1).max(50),
  expiresAt: z.string().max(40),
});
