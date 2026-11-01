import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryRead } from './retry.js';

const httpError = (status?: number) => Object.assign(new Error(`status ${status}`), status ? { response: { status } } : {});

function flaky(failures: unknown[], value = 'ok') {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls <= failures.length) throw failures[calls - 1];
    return value;
  };
  return { fn, calls: () => calls };
}

test('retries a dropped connection and a 5xx, then succeeds', async () => {
  const f = flaky([httpError(), httpError(503)]);
  assert.equal(await retryRead(f.fn, { baseMs: 1 }), 'ok');
  assert.equal(f.calls(), 3);
});

test('retries a 429', async () => {
  const f = flaky([httpError(429)]);
  assert.equal(await retryRead(f.fn, { baseMs: 1 }), 'ok');
  assert.equal(f.calls(), 2);
});

test('does not retry a 4xx: it is an answer', async () => {
  const f = flaky([httpError(404)]);
  await assert.rejects(retryRead(f.fn, { baseMs: 1 }), /status 404/);
  assert.equal(f.calls(), 1);
});

test('gives up after the last attempt with the last error', async () => {
  const f = flaky([httpError(500), httpError(502), httpError(504)]);
  await assert.rejects(retryRead(f.fn, { attempts: 3, baseMs: 1 }), /status 504/);
  assert.equal(f.calls(), 3);
});
