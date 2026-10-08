import { describe, it, expect } from 'vitest';
import { interactiveUrlUsable } from '../lib/anchor.js';

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

/** A SEP-24 style link: a JWT whose payload carries `exp` (unix seconds). */
function link(path: string, expSeconds?: number) {
  const payload = Buffer.from(JSON.stringify(expSeconds === undefined ? {} : { exp: expSeconds })).toString('base64url');
  return `https://anchor.example${path}?transaction_id=abc&token=h.${payload}.s`;
}

describe('interactiveUrlUsable', () => {
  it('accepts an interactive form link with a token that is still valid', () => {
    expect(interactiveUrlUsable(link('/', NOW / 1000 + 3600), NOW)).toBe(true);
  });

  it('rejects the read-only transaction status page — it has no form', () => {
    expect(interactiveUrlUsable(link('/txn', NOW / 1000 + 3600), NOW)).toBe(false);
  });

  it('rejects a link whose token has expired, or expires within a minute', () => {
    expect(interactiveUrlUsable(link('/', NOW / 1000 - 10), NOW)).toBe(false);
    expect(interactiveUrlUsable(link('/', NOW / 1000 + 30), NOW)).toBe(false);
  });

  it('rejects missing, malformed and token-less links', () => {
    expect(interactiveUrlUsable(null, NOW)).toBe(false);
    expect(interactiveUrlUsable(undefined, NOW)).toBe(false);
    expect(interactiveUrlUsable('not a url', NOW)).toBe(false);
    expect(interactiveUrlUsable('https://anchor.example/?transaction_id=abc', NOW)).toBe(false);
    expect(interactiveUrlUsable(link('/'), NOW)).toBe(false); // token without exp
  });
});
