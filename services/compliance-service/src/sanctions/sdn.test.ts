import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, screenName } from './screen.js';
import { parseCsvLine, parseSdn } from './sdn.js';
import { rescreenClearRecords } from './service.js';
import { sealDetails } from '../pii.js';

process.env.MASTER_ENCRYPTION_KEY ??= 'ab'.repeat(32);

const SDN = [
  '2674,"ABBAS, Abu",individual,"SDGT] [IRGC",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 1950."',
  '306,"BANCO NACIONAL DE CUBA",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '900,"MV EXAMPLE",vessel,"IRAN",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
  '77,"MAO",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
].join('\r\n');
const ALT = [
  '306,220,"aka","NATIONAL BANK OF CUBA",-0- ',
  '2674,5,"aka","ABU ABBAS, Mohammed",-0- ',
].join('\r\n');

test('parses quoted CSV fields with commas and escaped quotes', () => {
  assert.deepEqual(parseCsvLine('1,"A, B","say ""hi""",-0- '), ['1', 'A, B', 'say "hi"', '-0- ']);
});

test('parseSdn builds entries with aliases, flips surname-first names and drops vessels', () => {
  const entries = parseSdn(SDN, ALT);
  assert.deepEqual(entries.map((e) => e.name), ['ABBAS, Abu', 'BANCO NACIONAL DE CUBA', 'MAO']);
  const abbas = entries[0];
  assert.equal(abbas.program, 'SDGT');
  assert.ok(abbas.aliases.includes('Abu ABBAS'), 'given-name-first form');
  assert.ok(abbas.aliases.includes('Mohammed ABU ABBAS'), 'alias flipped too');
  assert.ok(entries[1].aliases.includes('NATIONAL BANK OF CUBA'));
});

test('an applicant writing the name given-name-first, in any word order, is caught', () => {
  const index = buildIndex(parseSdn(SDN, ALT));
  assert.equal(screenName('Abu Abbas', index).length, 1);
  assert.equal(screenName('abbas abu', index).length, 1);
  assert.equal(screenName('National Bank of Cuba', index).length, 1);
});

test('short or one-word entries match exactly only, so ordinary names are not flagged by typo; long two-word names tolerate a typo', () => {
  const index = buildIndex(parseSdn(SDN, ALT));
  assert.equal(screenName('Mao', index).length, 1);
  assert.equal(screenName('Max', index).length, 0);
  assert.equal(screenName('Abu Abbasi', index).length, 1, 'one typo in a distinctive two-word name');
});

test('re-screening flags a cleared record that a newer list now matches, once, with an audit event', async () => {
  // the database hands back the stored JSON string without its quotes
  const stored = (details: Record<string, unknown>) => JSON.parse(sealDetails(details));
  const sealed = stored({ identity: { fullName: 'Abu Abbas' } });
  const writes: Array<[string, unknown[]]> = [];
  const query = async (sql: string, params: unknown[] = []) => {
    writes.push([sql, params]);
    if (/SELECT user_id, data FROM kyc_records/.test(sql)) {
      return { rows: [{ user_id: 'u1', data: sealed }, { user_id: 'u2', data: stored({ identity: { fullName: 'Thandi Nkosi' } }) }] };
    }
    return { rows: [] };
  };
  const index = buildIndex(parseSdn(SDN, ALT));
  const result = await rescreenClearRecords(query, (names) => names.flatMap((n) => screenName(n, index)));

  assert.deepEqual(result, { rescreened: 2, newlyFlagged: 1 });
  const flagged = writes.filter(([sql]) => /SET sanctions_status = 'flagged'/.test(sql));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0][1][0], 'u1');
  const event = writes.find(([sql]) => /INSERT INTO kyc_events/.test(sql))!;
  assert.deepEqual(event[1].slice(0, 4), ['u1', null, 'system', 'rescreened']);
});
