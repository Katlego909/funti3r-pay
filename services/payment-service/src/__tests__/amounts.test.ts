import { describe, it, expect } from 'vitest';
import { fromStroops, toStroops } from '../lib/amounts.js';

describe('exact token amounts', () => {
  it('converts to and from the 7-decimal smallest unit without float drift', () => {
    expect(toStroops('0.1')).toBe(1_000_000n);
    expect(toStroops(25.5)).toBe(255_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(fromStroops(toStroops('0.1') + toStroops('0.2'))).toBe('0.3000000'); // 0.1 + 0.2 is exactly 0.3 here
    expect(fromStroops(355_000_000n)).toBe('35.5000000');
  });

  it('refuses what is not a plain non-negative amount with at most 7 decimals', () => {
    for (const bad of ['1.00000001', '-1', 'abc', '1e-7', '']) {
      expect(() => toStroops(bad), bad).toThrow();
    }
  });
});
