import { describe, expect, it } from 'vitest';
import { withPatch } from './listParams';

describe('withPatch', () => {
  it('sets a filter, removes an emptied one, and goes back to the first page', () => {
    const next = withPatch(new URLSearchParams('tab=escrows&status=active&offset=100'), { status: '', q: 'abc' });
    expect(next.toString()).toBe('tab=escrows&q=abc');
  });

  it('keeps the other filters when only the page changes', () => {
    const next = withPatch(new URLSearchParams('role=worker&status=suspended'), { offset: '50' });
    expect(next.toString()).toBe('role=worker&status=suspended&offset=50');
  });

  it('does not change the URL it was given', () => {
    const current = new URLSearchParams('role=admin');
    withPatch(current, { role: null });
    expect(current.toString()).toBe('role=admin');
  });
});
