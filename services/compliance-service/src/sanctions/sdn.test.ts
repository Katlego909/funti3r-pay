import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, screenName } from './screen.js';
import { parseBirthYears, parseCsvLine, parseSdn } from './sdn.js';
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

test('parseBirthYears reads only DOB segments, including alternates and approximate dates', () => {
  assert.deepEqual(parseBirthYears('DOB 15 Mar 1962; alt. DOB 1963; POB Aleppo, Syria; Passport 1999123'), [1962, 1963]);
  assert.deepEqual(parseBirthYears('DOB circa 1970; nationality Syria; Gender Male'), [1970]);
  assert.deepEqual(parseBirthYears('Linked To: ACME 2001 TRADING; Registration ID 1988'), []);
  assert.deepEqual(parseBirthYears(''), []);
});

test('a namesake with a different year of birth is ruled out; the right year, an off-by-one year or no year still match', () => {
  const index = buildIndex(parseSdn(SDN, ALT));
  assert.equal(screenName('Abu Abbas', index, 1990).length, 0, 'born 40 years apart');
  const exact = screenName('Abu Abbas', index, 1950);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].birthYear, 'confirmed');
  assert.equal(screenName('Abu Abbas', index, 1951).length, 1, 'lists carry circa years');
  const unknown = screenName('Abu Abbas', index);
  assert.equal(unknown.length, 1, 'no birth year given: fail closed');
  assert.equal(unknown[0].birthYear, 'unknown');
});

test('an entry with no recorded birth year is never ruled out by the applicant\'s', () => {
  const index = buildIndex(parseSdn(SDN, ALT));
  assert.equal(screenName('National Bank of Cuba', index, 1990).length, 1);
});

test('storing a list passes birth years per entry and never stores NULL for entries without one', async () => {
  const calls: Array<[string, unknown[]]> = [];
  const query = async (sql: string, params: unknown[] = []) => { calls.push([sql, params]); return { rows: [] }; };
  const { storeSanctionsList } = await import('./service.js');
  await storeSanctionsList(query, [
    { name: 'ABBAS, Abu', aliases: [], program: 'SDGT', list: 'OFAC-SDN', birthYears: [1950, 1951] },
    { name: 'BANCO NACIONAL DE CUBA', aliases: [], program: 'CUBA', list: 'OFAC-SDN' },
  ], 'test');
  const insert = calls.find(([sql]) => /INSERT INTO sanctions_entries/.test(sql))!;
  assert.match(insert[0], /COALESCE\(string_to_array\(NULLIF\(y, ''\), ','\)::int\[\], '\{\}'\)/, 'an empty list, not NULL');
  assert.deepEqual(insert[1][4], ['1950,1951', '']);
});
