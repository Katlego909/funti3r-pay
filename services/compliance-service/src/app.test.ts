import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MASTER_ENCRYPTION_KEY ??= 'ab'.repeat(32);

const { createApp } = await import('./app.js');
const { isSealed } = await import('./pii.js');
const { sealExistingRecords } = await import('./sealExisting.js');
const { screenNames } = await import('./sanctions/screen.js');

const sanctions = { screen: (names: string[]) => screenNames(names), status: async () => null, refresh: async () => ({ entries: 0, rescreened: 0, newlyFlagged: 0 }) };

// A tiny in-memory stand-in for the tables the service touches.
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const OWNER_A = '00000000-0000-0000-0000-0000000000b1';
const MEMBER_A = '00000000-0000-0000-0000-0000000000b2';
const OWNER_B = '00000000-0000-0000-0000-0000000000c1';
const WORKER_A = '00000000-0000-0000-0000-0000000000d1'; // works for company A
const WORKER_B = '00000000-0000-0000-0000-0000000000d2'; // works for company B

const members = [
  { company: 'A', user: OWNER_A, role: 'owner' },
  { company: 'A', user: MEMBER_A, role: 'member' },
  { company: 'B', user: OWNER_B, role: 'owner' },
];
const workers = [{ company: 'A', worker: WORKER_A }, { company: 'B', worker: WORKER_B }];

let records: Record<string, any>;
let events: any[];

const query = async (sql: string, params: unknown[] = []): Promise<{ rows: any[] }> => {
  if (/FROM enterprise_members em/.test(sql)) {
    const [requester, target] = params as string[];
    const m = members.find((x) => x.user === requester && workers.some((w) => w.company === x.company && w.worker === target));
    return { rows: m ? [{ company_role: m.role }] : [] };
  }
  if (/INSERT INTO kyc_records/.test(sql)) {
    const [userId, status, data, verifiedAt, sanctionsStatus, matches, expiresAt] = params as string[];
    records[userId] = { id: `rec-${userId}`, user_id: userId, status, data: JSON.parse(data), verified_at: verifiedAt, expires_at: expiresAt, sanctions_status: sanctionsStatus, sanctions_matches: matches, created_at: 'now' };
    return { rows: [records[userId]] };
  }
  if (/INSERT INTO kyc_events/.test(sql)) {
    const [userId, actorId, actorRole, action, detail] = params as string[];
    events.push({ userId, actorId, actorRole, action, detail });
    return { rows: [] };
  }
  if (/SELECT sanctions_status FROM kyc_records/.test(sql)) {
    const r = records[params[0] as string];
    return { rows: r ? [{ sanctions_status: r.sanctions_status }] : [] };
  }
  if (/UPDATE kyc_records\s+SET status/.test(sql)) {
    const [status, userId] = params as string[];
    const r = records[userId];
    if (!r) return { rows: [] };
    r.status = status;
    if (status === 'approved') r.sanctions_status = 'clear';
    return { rows: [{ status }] };
  }
  if (/FROM kyc_records WHERE user_id = \$1/.test(sql)) {
    const r = records[params[0] as string];
    const reviewed = events.some((e) => e.userId === params[0] && e.action === 'approved');
    return { rows: r ? [{ ...r, reviewed }] : [] };
  }
  if (/FROM kyc_events/.test(sql)) return { rows: events.filter((e) => e.userId === params[0]) };
  if (/SELECT id, data FROM kyc_records/.test(sql)) return { rows: Object.values(records).filter((r) => r.data) };
  if (/UPDATE kyc_records SET data/.test(sql)) {
    const [id, data] = params as string[];
    const r = Object.values(records).find((x) => x.id === id)!;
    r.data = JSON.parse(data);
    return { rows: [] };
  }
  throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
};

let server: Server;
let base: string;
before(async () => {
  server = createApp({ query, autoApprove: false, sanctions }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); });

const call = (method: string, path: string, as: { id: string; role: string } | null, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(as ? { 'x-user-id': as.id, 'x-user-role': as.role } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const worker = (id: string) => ({ id, role: 'worker' });
const enterprise = (id: string) => ({ id, role: 'enterprise' });
const admin = { id: ADMIN, role: 'admin' };

const submit = (id: string, fullName = 'Thandi Nkosi') =>
  call('POST', '/submit', worker(id), { userId: id, identity: { fullName, idNumber: '8001015009087' }, bankAccount: { accountNumber: '1234567890' } });

const fresh = () => { records = {}; events = []; };

test('a submission is stored encrypted, never as readable ID or bank numbers', async () => {
  fresh();
  assert.equal((await submit(WORKER_A)).status, 201);
  assert.ok(isSealed(records[WORKER_A].data));
  assert.ok(!JSON.stringify(records[WORKER_A].data).includes('8001015009087'));
  assert.ok(!JSON.stringify(records[WORKER_A].data).includes('1234567890'));
});

test('the user and their own company read the decrypted record', async () => {
  fresh();
  await submit(WORKER_A);
  for (const who of [worker(WORKER_A), enterprise(OWNER_A), enterprise(MEMBER_A), admin]) {
    const res = await call('GET', `/${WORKER_A}`, who);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.identity.idNumber, '8001015009087');
    assert.equal(body.status, 'pending');
  }
});

test('another company, another worker and anonymous callers cannot read it', async () => {
  fresh();
  await submit(WORKER_A);
  for (const who of [enterprise(OWNER_B), worker(WORKER_B), null]) {
    assert.equal((await call('GET', `/${WORKER_A}`, who)).status, 403);
    assert.equal((await call('GET', `/${WORKER_A}/events`, who)).status, 403);
  }
});

test('you can only submit your own KYC', async () => {
  fresh();
  const res = await call('POST', '/submit', worker(WORKER_B), { userId: WORKER_A, identity: { fullName: 'Thandi Nkosi' } });
  assert.equal(res.status, 403);
  assert.equal(records[WORKER_A], undefined);
});

test('only an owner/admin of the worker\'s own company (or a platform admin) can decide', async () => {
  fresh();
  await submit(WORKER_A);
  assert.equal((await call('POST', `/${WORKER_A}/approve`, enterprise(OWNER_B))).status, 403, 'other company');
  assert.equal((await call('POST', `/${WORKER_A}/approve`, enterprise(MEMBER_A))).status, 403, 'plain member');
  assert.equal((await call('POST', `/${WORKER_A}/approve`, worker(WORKER_A))).status, 403, 'the worker themself');
  assert.equal(records[WORKER_A].status, 'pending');

  assert.equal((await call('POST', `/${WORKER_A}/approve`, enterprise(OWNER_A))).status, 200);
  assert.equal(records[WORKER_A].status, 'approved');
  assert.equal((await call('POST', `/${WORKER_A}/reject`, admin, { reason: 'bad scan' })).status, 200);
  assert.equal(records[WORKER_A].status, 'rejected');
});

test('an employer cannot clear a sanctions flag; a platform admin can, and it is recorded', async () => {
  fresh();
  const res = await submit(WORKER_A, 'Sanctions Test Subject');
  assert.equal(((await res.json()) as any).sanctions_status, 'flagged');
  assert.equal(records[WORKER_A].status, 'rejected');

  const denied = await call('POST', `/${WORKER_A}/approve`, enterprise(OWNER_A));
  assert.equal(denied.status, 403);
  assert.equal(records[WORKER_A].sanctions_status, 'flagged');

  assert.equal((await call('POST', `/${WORKER_A}/approve`, admin)).status, 200);
  assert.equal(records[WORKER_A].sanctions_status, 'clear');
  assert.deepEqual(events.map((e) => e.action), ['submitted', 'approved', 'flag_cleared']);
});

test('every decision is written to the audit trail with who made it', async () => {
  fresh();
  await submit(WORKER_A);
  await call('POST', `/${WORKER_A}/approve`, enterprise(OWNER_A));
  await call('POST', `/${WORKER_A}/reject`, enterprise(OWNER_A), { reason: 'ID expired' });

  assert.deepEqual(events.map((e) => [e.action, e.actorId, e.actorRole]), [
    ['submitted', WORKER_A, 'worker'],
    ['approved', OWNER_A, 'enterprise'],
    ['rejected', OWNER_A, 'enterprise'],
  ]);
  assert.equal(JSON.parse(events[2].detail).reason, 'ID expired');

  const res = await call('GET', `/${WORKER_A}/events`, enterprise(OWNER_A));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).events.length, 3);
});

test('records written before encryption are sealed on boot and still read back', async () => {
  fresh();
  records[WORKER_A] = { id: 'legacy', user_id: WORKER_A, status: 'approved', sanctions_status: 'clear', created_at: 'then', data: { identity: { fullName: 'Old Record', idNumber: '7001015009087' } } };
  assert.equal(await sealExistingRecords(query), 1);
  assert.ok(isSealed(records[WORKER_A].data));
  assert.equal(await sealExistingRecords(query), 0, 'second run changes nothing');

  const body = await (await call('GET', `/${WORKER_A}`, worker(WORKER_A))).json() as any;
  assert.equal(body.identity.idNumber, '7001015009087');
});

test('an approval carries an expiry (a year by default); a pending submission has none', async () => {
  fresh();
  await submit(WORKER_A);
  assert.equal(records[WORKER_A].expires_at, null);

  const approvedServer = createApp({ query, autoApprove: true, sanctions, validityDays: 30 }).listen(0);
  try {
    const url = `http://127.0.0.1:${(approvedServer.address() as AddressInfo).port}`;
    await fetch(`${url}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': WORKER_B, 'x-user-role': 'worker' },
      body: JSON.stringify({ userId: WORKER_B, identity: { fullName: 'Lerato Dlamini' } }),
    });
    const days = (Date.parse(records[WORKER_B].expires_at) - Date.now()) / 86_400_000;
    assert.ok(days > 29 && days <= 30, `expires in ${days} days`);
  } finally {
    approvedServer.close();
  }
});

test('anyone can screen bare names; the platform admin refreshes the list', async () => {
  fresh();
  const hit = await (await call('POST', '/screen', worker(WORKER_A), { names: ['Sanctions Test Subject', 'Thandi Nkosi'] })).json() as any;
  assert.equal(hit.matches.length, 1);
  assert.equal((await call('POST', '/screen', worker(WORKER_A), { names: 'nope' })).status, 400);

  assert.equal((await call('POST', '/sanctions/refresh', enterprise(OWNER_A))).status, 403);
  assert.equal((await call('POST', '/sanctions/refresh', admin)).status, 200);
});

test('the status says what verified rests on: a reviewer, an auto-approval or no submission at all', async () => {
  fresh();
  await submit(WORKER_A);
  assert.equal(((await (await call('GET', `/${WORKER_A}/status`, null)).json()) as any).basis, 'none', 'pending');

  await call('POST', `/${WORKER_A}/approve`, enterprise(OWNER_A));
  assert.equal(((await (await call('GET', `/${WORKER_A}/status`, null)).json()) as any).basis, 'reviewed');

  records[WORKER_B] = { id: 'r2', user_id: WORKER_B, status: 'approved', sanctions_status: 'clear', created_at: 'x', data: null };
  assert.equal(((await (await call('GET', `/${WORKER_B}/status`, null)).json()) as any).basis, 'auto-approved');

  const auto = createApp({ query, autoApprove: true, sanctions }).listen(0);
  try {
    const url = `http://127.0.0.1:${(auto.address() as AddressInfo).port}`;
    const none = await (await fetch(`${url}/${OWNER_B}/status`)).json() as any;
    assert.deepEqual([none.status, none.basis], ['verified', 'no-submission']);
  } finally {
    auto.close();
  }
});
