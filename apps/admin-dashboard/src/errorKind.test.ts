import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { apiErrorKind, apiErrorMessage } from '@funti3r/web-core';

const failed = (status?: number, data?: unknown) =>
  new AxiosError('failed', 'ERR', undefined, undefined,
    status === undefined ? undefined : { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data });

describe('how a failed call is worded', () => {
  it('tells apart no connection, no access, not found and a server failure', () => {
    expect(apiErrorKind(failed())).toBe('offline');
    expect(apiErrorKind(failed(401))).toBe('forbidden');
    expect(apiErrorKind(failed(403))).toBe('forbidden');
    expect(apiErrorKind(failed(404))).toBe('notFound');
    expect(apiErrorKind(failed(503))).toBe('server');
    expect(apiErrorKind(failed(400))).toBe('other');
    expect(apiErrorKind(new Error('a bug in our own code'))).toBe('other');
  });

  it('shows the server\'s own message, and points support at the request on a server failure', () => {
    expect(apiErrorMessage(failed(403, { error: 'Not authorized' }), 'x')).toBe('Not authorized');
    expect(apiErrorMessage(failed(500, { error: 'Something went wrong.', requestId: 'abcdef1234567' }), 'x')).toBe('Something went wrong. · ref abcdef12');
    expect(apiErrorMessage(failed(), 'x')).toMatch(/connection/);
  });
});
