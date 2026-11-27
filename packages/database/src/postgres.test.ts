import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { utcTimestamp } from './postgres.js';

test('a timestamp without a time zone is read as the UTC time it holds, wherever the server runs', () => {
  assert.equal(utcTimestamp('2026-11-27 04:48:45.655072').toISOString(), '2026-11-27T04:48:45.655Z');
  assert.equal(utcTimestamp('2026-11-27 04:48:45').toISOString(), '2026-11-27T04:48:45.000Z');
});

test('the driver uses that reading, and writes Dates as UTC', () => {
  assert.equal(pg.types.getTypeParser(1114)('2026-01-01 00:00:00').toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(pg.defaults.parseInputDatesAsUTC, true);
});
