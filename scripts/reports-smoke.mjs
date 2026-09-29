// End-to-end check of the driver-reports relay against a running Worker:
//   npm run dev:api          (terminal 1)
//   npm run test:reports     (terminal 2)   [REPORTS_BASE=https://… to test a deployment]
// Each run uses its own coordinates, so it can be repeated against the same relay.
import assert from 'node:assert/strict';

const BASE = process.env.REPORTS_BASE ?? 'http://127.0.0.1:8787';
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);
/** A different client per `ip` (local wrangler trusts CF-Connecting-IP; a deployment ignores it). */
const call = (path, init = {}, ip = '10.0.0.1') =>
  fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, ...init.headers } });
const post = (path, body, ip) => call(path, { method: 'POST', body: JSON.stringify(body) }, ip);

// A random spot in the Caucasus for this run.
const lat = 41 + Math.random();
const lon = 43 + Math.random();
const bbox = `${(lon - 0.05).toFixed(4)},${(lat - 0.05).toFixed(4)},${(lon + 0.05).toFixed(4)},${(lat + 0.05).toFixed(4)}`;

console.log(`Driver reports relay @ ${BASE}`);

// 1. Validation.
assert.equal((await post('/api/reports', { kind: 'aliens', lat, lon })).status, 400);
assert.equal((await post('/api/reports', { kind: 'accident', lat: 95, lon })).status, 400);
assert.equal((await call('/api/reports', { method: 'POST', body: '{}', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
assert.equal((await fetch(`${BASE}/api/reports`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
assert.equal((await call('/api/reports?bbox=0,0,50,50')).status, 400);
ok('rejects bad kinds, coordinates, cross-site and oversized areas');

// 2. Report + list.
let res = await post('/api/reports', { kind: 'accident', lat, lon }, '10.0.0.1');
assert.equal(res.status, 201);
const { id, expiresAt } = await res.json();
assert.match(id, /^[A-Za-z0-9_-]{16}$/);
assert.ok(expiresAt > Date.now() + 55 * 60_000);
let list = await (await call(`/api/reports?bbox=${bbox}`)).json();
const mine = list.reports.find((r) => r.id === id);
assert.ok(mine, 'the new report is listed');
assert.equal(mine.kind, 'accident');
assert.equal(typeof list.now, 'number');
ok('a report is stored and listed for its area');

// 3. The same thing reported nearby by someone else is a confirmation.
res = await post('/api/reports', { kind: 'accident', lat: lat + 0.0005, lon }, '10.0.0.2');
const merged = await res.json();
assert.equal(merged.id, id);
assert.equal(merged.merged, true);
list = await (await call(`/api/reports?bbox=${bbox}`)).json();
assert.equal(list.reports.find((r) => r.id === id).confirms, 1);
ok('a duplicate nearby counts as a confirmation');

// 4. Votes: not on your own report, once per client; two "gone" outnumbering confirmations remove it.
assert.equal((await post(`/api/reports/${id}/vote`, { vote: 'gone' }, '10.0.0.1')).status, 409);
assert.equal((await post(`/api/reports/${id}/vote`, { vote: 'gone' }, '10.0.0.2')).status, 409, 'already counted as a confirmation');
res = await post(`/api/reports/${id}/vote`, { vote: 'gone' }, '10.0.0.3');
assert.equal((await res.json()).active, true);
res = await post(`/api/reports/${id}/vote`, { vote: 'gone' }, '10.0.0.4');
assert.equal((await res.json()).active, false);
assert.equal((await post(`/api/reports/${id}/vote`, { vote: 'still' }, '10.0.0.5')).status, 404);
list = await (await call(`/api/reports?bbox=${bbox}`)).json();
assert.ok(!list.reports.some((r) => r.id === id));
ok('own/double votes refused; "gone" from two drivers takes it down');

// 5. Unknown and malformed ids.
assert.equal((await post('/api/reports/AAAAAAAAAAAAAAAA/vote', { vote: 'still' })).status, 404);
assert.equal((await post('/api/reports/../vote', { vote: 'still' })).status, 404);
ok('unknown ids are 404');

console.log(`${passed} checks passed`);
