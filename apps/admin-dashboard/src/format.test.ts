import { describe, expect, it } from 'vitest';
import { money, short, when } from './format';

describe('when', () => {
  it('shows a dash for nothing or an unreadable date', () => {
    expect(when(null)).toBe('—');
    expect(when(undefined)).toBe('—');
    expect(when('not a date')).toBe('—');
  });

  it('shows a real timestamp with its year', () => {
    expect(when('2026-11-26T10:15:00Z')).toMatch(/2026/);
  });
});

describe('short', () => {
  it('keeps both ends of a long id, hash or address', () => {
    expect(short('GCTJUFKWH7PJ6NPW4FG67C2AIBOSW5QPHXOS7UAF2MEKE7ZHATSB3YFN')).toBe('GCTJUF…3YFN');
    expect(short('f41f159d-4f8d-4f53-9435-15f3f1c889c1', 8)).toBe('f41f159d…89c1');
  });

  it('leaves short values whole and shows a dash for none', () => {
    expect(short('abc')).toBe('abc');
    expect(short(null)).toBe('—');
  });
});

describe('money', () => {
  it('keeps up to 7 decimals (Stellar amounts) and drops trailing zeros', () => {
    expect(money('11.1747451', 'XLM')).toMatch(/^11\.1747451 XLM$/);
    expect(money('5.0000000', 'USDC')).toBe('5 USDC');
  });

  it('shows a dash for no amount, and passes through a value that is not a number', () => {
    expect(money(null)).toBe('—');
    expect(money('')).toBe('—');
    expect(money('n/a')).toBe('n/a');
  });
});
