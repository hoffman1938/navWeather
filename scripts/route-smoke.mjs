// Our routing engine through the Worker (DEVELOPMENT_PLAN DP-5.2):
//   npm run engines:up && npm run dev     then     npm run test:route
//   [ROUTE_BASE=https://… to test a deployment; API=/api for legacy paths]
import assert from 'node:assert/strict';

const BASE = process.env.ROUTE_BASE ?? 'http://127.0.0.1:8787';
const API = process.env.API ?? '/api/v1';
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);
const TBILISI = { lon: 44.801449, lat: 41.693459 };
const BATUMI = { lon: 41.636009, lat: 41.65095 };

console.log(`Routing @ ${BASE}${API}`);
assert.equal((await fetch(`${BASE}${API}/route`)).status, 405);
assert.equal((await post('/route', 'nope')).status, 400);
assert.equal((await post('/route', { mode: 'fly', points: [TBILISI, BATUMI] })).status, 400);
assert.equal((await fetch(`${BASE}${API}/route`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
assert.equal((await post('/route', { mode: 'drive', points: [TBILISI, BATUMI] }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
ok('validation, content type, CSRF and method checks');

const res = await post('/route', { mode: 'drive', points: [TBILISI, BATUMI], alternatives: 2 });
if (res.status === 503) {
  console.log('  – no engine here (npm run engines:up locally; Containers in the cloud) — routing checks skipped');
} else {
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.code, 'Ok');
  const km = data.routes[0].distance / 1000;
  assert.ok(km > 330 && km < 380, `Tbilisi → Batumi ${km} km`);
  assert.ok(data.routes[0].legs[0].steps.length > 10);
  ok(`Tbilisi → Batumi by car: ${Math.round(km)} km, ${Math.round(data.routes[0].duration / 60)} min`);
  const tolls = await (await post('/route', { mode: 'drive', points: [TBILISI, BATUMI], avoid: ['highways'] })).json();
  assert.ok(tolls.routes[0].distance >= data.routes[0].distance);
  ok('avoiding motorways gives another road');
  const walk = await (await post('/route', { mode: 'walk', points: [TBILISI, { lon: 44.7929, lat: 41.7023 }] })).json();
  assert.ok(walk.routes[0].duration > 10 * 60);
  ok('walking');
  const out = await post('/route', { mode: 'drive', points: [TBILISI, { lon: 28.97, lat: 41.01 }] });
  assert.equal(out.status, 422);
  assert.deepEqual(await out.json(), { error: 'outside-region' });
  ok('a destination outside the region is "outside-region" (the app then uses its fallback)');
  const m = await (await post('/route/matrix', { mode: 'drive', sources: [[44.8, 41.69]], destinations: [[44.11, 41.98]] })).json();
  assert.ok(m.durations[0][0] > 3000 && m.distances[0][0] > 80_000);
  ok('travel-time matrix in seconds and metres');
}
console.log(`${passed} checks passed`);
