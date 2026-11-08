import { describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { apiErrorMessage } from './errors.js';

function apiError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, {
    status, statusText: '', headers: {}, config, data,
  });
}

describe('apiErrorMessage', () => {
  it("shows the server's message for a client error", () => {
    expect(apiErrorMessage(apiError(403, { error: 'Worker KYC not verified' }), 'Failed')).toBe('Worker KYC not verified');
  });

  it('appends a short request reference to a server failure', () => {
    const err = apiError(500, { error: 'Something went wrong. Please try again.', requestId: '0f3c9a1e-7b2d-4c55-9e10-2a6d1b8c4f00' });
    expect(apiErrorMessage(err, 'Failed')).toBe('Something went wrong. Please try again. · ref 0f3c9a1e');
  });

  it('uses the fallback when the server sent no message', () => {
    expect(apiErrorMessage(apiError(502, '<html>Bad Gateway</html>'), 'Failed to load payment')).toBe('Failed to load payment');
  });

  it('says the server is unreachable when there was no response', () => {
    const err = new AxiosError('Network Error', 'ERR_NETWORK');
    expect(apiErrorMessage(err, 'Failed')).toMatch(/Can't reach Funti3rPay/);
  });

  it('never shows the message of a non-API error', () => {
    expect(apiErrorMessage(new TypeError("Cannot read properties of undefined (reading 'id')"), 'Failed')).toBe('Failed');
  });
});
