import { describe, it, expect, beforeAll } from 'vitest';
import { verifyIdentity } from '@funti3r/shared-utils';
import { scheduleRunHeaders } from '../scheduler.js';

describe('scheduleRunHeaders', () => {
  beforeAll(() => {
    process.env.INTERNAL_AUTH_SECRET ??= 'x'.repeat(32);
  });

  it('acts as the schedule owner, signed so the payout routes trust it', () => {
    const now = Date.now();
    const headers = scheduleRunHeaders('ent-1', now);
    expect(headers['x-user-id']).toBe('ent-1');
    expect(headers['x-user-role']).toBe('enterprise');
    expect(verifyIdentity(headers, now)).toBe(true);
  });

  it('cannot be reused as a different enterprise', () => {
    const now = Date.now();
    const headers = scheduleRunHeaders('ent-1', now);
    expect(verifyIdentity({ ...headers, 'x-user-id': 'ent-2' }, now)).toBe(false);
  });
});
