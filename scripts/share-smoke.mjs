// End-to-end check of the live-location relay against a running Worker:
//   npm run dev:api          (terminal 1)
//   npm run test:share       (terminal 2)   [SHARE_BASE=https://… to test a deployment]
import assert from 'node:assert/strict';

const BASE = process.env.SHARE_BASE ?? 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (path, init = {}) => fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);

console.log(`Live share relay @ ${BASE}`);

// 1. Validation on create.
assert.equal((await call('/api/share', { method: 'POST', body: '{"minutes":1}' })).status, 400);
assert.equal((await call('/api/share', { method: 'POST', body: 'nope' })).status, 400);
assert.equal((await call('/api/share', { method: 'POST', body: '{"minutes":60}', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
assert.equal((await fetch(BASE + '/api/share', { method: 'POST', body: '{"minutes":60}', headers: { 'content-type': 'text/plain' } })).status, 415);
ok('rejects invalid and cross-site create requests');

// 2. Create.
const created = await call('/api/share', { method: 'POST', body: JSON.stringify({ minutes: 60, name: '  Gio\u0000 ' }) });
assert.equal(created.status, 201);
const { id, key, expiresAt } = await created.json();
assert.match(id, /^[A-Za-z0-9_-]{22}$/);
assert.ok(expiresAt > Date.now() + 59 * 60_000);
ok('creates a share with an unguessable id');

// 3. Viewer before any position.
let snap = await (await call(`/api/share/${id}`)).json();
assert.equal(snap.pos, null);
assert.equal(snap.name, 'Gio');
assert.equal((await call('/api/share/AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
ok('snapshot readable; unknown ids are 404; names sanitized');

// 4. WebSocket viewer receives live updates.
const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/share/${id}/ws`);
const messages = [];
ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});
await sleep(300);
assert.equal(messages[0]?.type, 'snapshot');
ok('viewer socket gets the current snapshot on connect');

const auth = { Authorization: `Bearer ${key}` };
const route = Array.from({ length: 50 }, (_, i) => [44.8 - i * 0.05, 41.7 - i * 0.002]);
const trip = { dest: { name: 'Batumi', c: [41.64, 41.65] }, eta: Date.now() + 4 * 3600_000, remM: 350_000, routeId: 'r1' };
let res = await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [44.8, 41.7], hdg: 270, spd: 22, acc: 8, t: Date.now() }, trip, sim: true }) });
assert.equal(res.status, 200);
assert.equal((await res.json()).needsRoute, true);
await sleep(1100);
res = await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [44.7, 41.69], hdg: 268, t: Date.now() }, trip: { ...trip, route } }) });
assert.equal((await res.json()).needsRoute, false);
await sleep(1100);
res = await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [44.6, 41.68], t: Date.now() }, trip }) });
assert.equal((await res.json()).needsRoute, false, 'route kept while the route id is unchanged');
await sleep(300);
const last = messages.at(-1);
assert.equal(last.type, 'snapshot');
assert.deepEqual(last.snapshot.pos.c, [44.6, 41.68]);
assert.equal(last.snapshot.trip.dest.name, 'Batumi');
assert.equal(last.snapshot.trip.route.length, 50);
assert.equal(messages.filter((m) => m.type === 'snapshot').length, 4);
ok('position updates stream to the viewer; route sent once and kept');

// 5. Auth, rate limit, bad data.
assert.equal((await call(`/api/share/${id}`, { method: 'PUT', headers: { Authorization: 'Bearer wrong' }, body: JSON.stringify({ pos: { c: [0, 0], t: Date.now() } }) })).status, 403);
assert.equal((await call(`/api/share/${id}`, { method: 'PUT', body: JSON.stringify({ pos: { c: [0, 0], t: Date.now() } }) })).status, 403);
await sleep(1100);
assert.equal((await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [500, 0], t: Date.now() } }) })).status, 400);
await sleep(1100);
await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [44.5, 41.6], t: Date.now() } }) });
assert.equal((await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [44.5, 41.6], t: Date.now() } }) })).status, 429);
assert.equal((await call(`/api/share/${id}`, { method: 'DELETE' })).status, 403);
await sleep(1100);
// A delayed (older) update must not move the marker backwards.
res = await call(`/api/share/${id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ pos: { c: [40, 40], t: Date.now() - 60_000 } }) });
assert.equal((await res.json()).stale, true);
assert.deepEqual((await (await call(`/api/share/${id}`)).json()).pos.c, [44.5, 41.6]);
ok('wrong/missing key rejected; invalid coordinates, floods and out-of-order updates refused');

// 6. Stop → viewers told, everything gone.
const closed = new Promise((r) => ws.addEventListener('close', r));
assert.equal((await call(`/api/share/${id}`, { method: 'DELETE', headers: auth })).status, 200);
await Promise.race([closed, sleep(3000)]);
assert.ok(messages.some((m) => m.type === 'ended'));
assert.equal((await call(`/api/share/${id}`)).status, 404);
ok('stopping notifies viewers and deletes the share');

console.log(`\n${passed} checks passed`);
