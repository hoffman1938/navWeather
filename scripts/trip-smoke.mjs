// End-to-end check of the long-trip planner against a running Worker (no Overpass calls):
//   npm run dev:api          (terminal 1)
//   npm run test:trips       (terminal 2)   [TRIP_BASE=https://… to test a deployment; API=/api for legacy paths]
import assert from 'node:assert/strict';

const BASE = process.env.TRIP_BASE ?? 'http://127.0.0.1:8787';
const API = process.env.API ?? '/api/v1';
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);

// A straight 1,200 km road west from Tbilisi at 85 km/h (encoded polyline, precision 5).
const enc = (pts) => {
  let out = '', pl = 0, po = 0;
  const put = (v) => {
    let n = v < 0 ? -v * 2 - 1 : v * 2;
    while (n >= 32) { out += String.fromCharCode((32 | (n % 32)) + 63); n = Math.floor(n / 32); }
    out += String.fromCharCode(n + 63);
  };
  for (const [lo, la] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); put(a - pl); put(b - po); pl = a; po = b; }
  return out;
};
const km = 1200, pts = [], timesS = [];
for (let i = 0; i <= km; i++) { pts.push([44.8 - i / 84.0, 41]); timesS.push(Math.round((i / 85) * 3600)); }
const request = {
  version: 1,
  route: { id: 'smoke', polyline: enc(pts), stepM: 1000, timesS, distanceM: km * 1000, origin: { name: 'Tbilisi', lat: 41, lon: 44.8 }, destination: { name: 'West', lat: 41, lon: pts.at(-1)[0] }, tz: 'Asia/Tbilisi' },
  departAtMs: Date.now() + 3600_000,
  vehicle: { kind: 'car', powertrain: 'fuel', rangeKm: 400, fullRangeKm: 700 },
  preferences: { pace: 'balanced', hotelMinStars: 0, hotelMaxDetourKm: 10, food: 'any', fuelBrand: null },
  places: [{ name: 'Midtown', kind: 'city', alongM: 650_000, lat: 41, lon: 44.8 - 650 / 84 }],
  locale: 'en',
};

console.log(`Trip planner @ ${BASE}${API}`);

assert.equal((await post('/trips/plan', 'nope')).status, 400);
assert.equal((await post('/trips/plan', { ...request, version: 2 })).status, 400);
assert.equal((await fetch(`${BASE}${API}/trips/plan`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
assert.equal((await post('/trips/plan', request, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
assert.equal((await fetch(`${BASE}${API}/trips/plan`)).status, 405);
ok('validation, content type, CSRF and method checks');

const t = Date.now();
const res = await post('/trips/plan', request);
assert.equal(res.status, 200);
const plan = await res.json();
assert.equal(plan.classification.category, 'LONG');
assert.equal(plan.classification.longTripMode, true);
assert.ok(plan.summary.overnights >= 1, 'an overnight');
assert.ok(plan.summary.fuelStops >= 1, 'fuel from the declared range');
assert.equal(plan.dataStatus.places, 'skipped'); // the plan never waits for Overpass
assert.ok(plan.days.length >= 2);
assert.equal(plan.timeline.at(-1).kind, 'arrive');
assert.ok(Date.now() - t < 3000, 'fast');
ok(`a 1,200 km plan: ${plan.summary.overnights} night(s), ${plan.summary.fuelStops} fuel, ${plan.summary.restStops} breaks, ${Date.now() - t} ms`);

const night = plan.recommendedStops.find((s) => s.kinds.includes('overnight'));
const replan = await (await post('/trips/plan', { ...request, overnightsM: [night.alongM - 50_000] })).json();
assert.equal(replan.recommendedStops.find((s) => s.kinds.includes('overnight')).alongM, night.alongM - 50_000);
ok('a user-chosen night is kept');

assert.equal((await post('/trips/places', { version: 1, stop: { lat: 41, lon: 44, kinds: ['bad'], arriveMs: Date.now(), tz: 'Asia/Tbilisi' }, route: '' })).status, 400);
assert.equal((await post('/trips/borders', { version: 1, points: [[44.8, 41.7]], alongM: [0] })).status, 400);
ok('places and borders reject malformed requests');

console.log(`${passed} checks passed`);
