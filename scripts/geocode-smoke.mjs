// Our geocoder against a running Worker (DEVELOPMENT_PLAN DP-4.4):
//   npm run dev            (or npm run dev:api)   — the index loaded with `npm run seed:local`
//   npm run test:geocode   [GEO_BASE=https://… to test a deployment; API=/api for legacy paths]
import assert from 'node:assert/strict';

const BASE = process.env.GEO_BASE ?? process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const API = process.env.API ?? '/api/v1';
const get = (qs, init) => fetch(`${BASE}${API}/geocode?${qs}`, init);
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);

console.log(`Geocoder @ ${BASE}${API}`);
assert.equal((await get('q=batumi', { method: 'POST' })).status, 405);
assert.deepEqual(await (await get('q=x')).json(), { places: [] }); // too short: no query at all
ok('method and too-short queries');

const res = await get('q=batumi&lang=en&limit=3');
if (res.status === 503) {
  console.log('  – index not loaded here (npm run seed:local, or wrangler d1 execute --remote) — search checks skipped');
} else {
  assert.equal(res.status, 200);
  const { places } = await res.json();
  assert.equal(places[0].name, 'Batumi');
  assert.equal(places[0].kind, 'city');
  ok('Batumi first, as a city');
  const ru = await (await get(`q=${encodeURIComponent('кутаиси')}&lang=ru&limit=1`)).json();
  assert.equal(ru.places[0].label, 'Кутаиси, Грузия');
  ok('Russian query and labels');
  const ka = await (await get(`q=${encodeURIComponent('თბილისი')}&lang=en&limit=1`)).json();
  assert.equal(ka.places[0].name, 'Tbilisi');
  ok('Georgian script');
  const sq = await (await get('q=freedom%20square&lang=en&limit=1&near=44.8,41.7')).json();
  assert.match(sq.places[0].label, /Tbilisi/);
  ok('Freedom Square near Tbilisi is the Tbilisi one');
}
console.log(`${passed} checks passed`);
