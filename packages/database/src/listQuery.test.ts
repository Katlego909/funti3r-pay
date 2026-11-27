import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneOf, pageOf, where } from './listQuery.js';

test('a page is the first 50 by default, at most 200, and never negative', () => {
  assert.deepEqual(pageOf({}), { limit: 50, offset: 0 });
  assert.deepEqual(pageOf({ limit: '9999', offset: '20' }), { limit: 200, offset: 20 });
  assert.deepEqual(pageOf({ limit: '-5', offset: '-1' }), { limit: 1, offset: 0 });
  assert.deepEqual(pageOf({ limit: 'abc', offset: '2.7' }), { limit: 50, offset: 2 });
});

test('conditions are numbered in order, skipped ones leave no gap, and none gives no WHERE', () => {
  assert.deepEqual(where([['a = ?', 1], null, false, ['b LIKE ?', 'x%']]), { sql: 'WHERE a = $1 AND b LIKE $2', params: [1, 'x%'] });
  assert.deepEqual(where([null]), { sql: '', params: [] });
  assert.deepEqual(where([['c = ?', 3]], 2), { sql: 'WHERE c = $3', params: [3] });
});

test('only an allowed filter value is used', () => {
  assert.equal(oneOf('worker', ['worker', 'enterprise'] as const), 'worker');
  assert.equal(oneOf("worker' OR 1=1", ['worker'] as const), undefined);
  assert.equal(oneOf(undefined, ['worker'] as const), undefined);
});
