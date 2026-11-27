import { describe, expect, it } from 'vitest';
import { userFromToken } from '@funti3r/web-core';

/** A token shaped like the gateway's (header.payload.signature); the signature is never checked in the browser. */
const token = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;

describe('who the console thinks is signed in', () => {
  it('is whoever the access token was issued to, so a renewed token for another account is noticed', () => {
    expect(userFromToken(token({ userId: 'u1', email: 'a@x.io', role: 'admin' }))).toEqual({ userId: 'u1', email: 'a@x.io', role: 'admin', companyId: undefined });
    expect(userFromToken(token({ userId: 'u2', email: 'w@x.io', role: 'worker', companyId: 'c1' }))?.role).toBe('worker');
  });

  it('is nobody for no token or a malformed one', () => {
    expect(userFromToken(null)).toBeNull();
    expect(userFromToken('not-a-jwt')).toBeNull();
    expect(userFromToken(token({ email: 'no-id@x.io' }))).toBeNull();
  });
});
