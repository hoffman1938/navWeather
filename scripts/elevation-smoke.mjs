// Our ground heights and air quality through the Worker (DEVELOPMENT_PLAN DP-4.7, DP-4.6):
//   npm run data:elevation && npm run data:air && npm run dev     then     npm run test:elevation
//   [BASE_URL=https://… to test a deployment; API=/api for legacy paths]
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const API = process.env.API ?? '/api/v1';
const get = (path) => fetch(`${BASE}${API}${path}`);
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);

console.log(`Elevation and air @ ${BASE}${API}`);
assert.equal((await fetch(`${BASE}${API}/elevation?latitude=1&longitude=1`, { method: 'POST' })).status, 405);
assert.equal((await get('/elevation?latitude=1')).status, 400);
assert.equal((await get('/air?latitude=1')).status, 400);
ok('validation and method checks');

// Tbilisi (Freedom Square), Kazbegi, Batumi's coast, the Black Sea, Istanbul (outside our tiles).
const e = await get('/elevation?latitude=41.6935,42.6574,41.651,42.5,41.01&longitude=44.8015,44.6414,41.636,38.5,28.97');
if (e.status === 503) console.log('  – no elevation tiles here (npm run data:elevation) — height checks skipped');
else {
  assert.equal(e.status, 200);
  const { elevation: h } = await e.json();
  assert.equal(h.length, 5);
  assert.ok(h[0] > 380 && h[0] < 520, `Tbilisi ${h[0]} m`);
  assert.ok(h[1] > 1600 && h[1] < 2000, `Stepantsminda ${h[1]} m`);
  assert.ok(h[2] >= -5 && h[2] < 40, `Batumi ${h[2]} m`);
  assert.ok(h[3] === 0 || h[3] === null, `sea ${h[3]}`);
  assert.equal(h[4], null);
  ok(`Tbilisi ${h[0]} m, Stepantsminda ${h[1]} m, Batumi ${h[2]} m; Istanbul unknown (the app asks elsewhere)`);
  const w = await (await get('/weather/forecast?latitude=42.6574&longitude=44.6414&hourly=temperature_2m&forecast_hours=3')).json();
  if (w.elevation !== undefined) {
    assert.equal(w.elevation, h[1]);
    ok('the forecast is for the point’s own height when the app sends none');
  }
}

const a = await get('/air?latitude=41.6935&longitude=44.8015');
if (a.status === 503) console.log('  – no air-quality tiles here (npm run data:air) — AQI checks skipped');
else {
  assert.equal(a.status, 200);
  const j = await a.json();
  assert.ok(typeof j.current.time === 'number');
  assert.ok(j.current.european_aqi === null || (j.current.european_aqi >= 0 && j.current.european_aqi <= 250));
  ok(`Tbilisi now: European AQI ${j.current.european_aqi}`);
  const sea = await (await get('/air?latitude=30&longitude=-150')).json();
  assert.equal(sea.current.european_aqi, null);
  ok('far out at sea: no index');
}
console.log(`${passed} checks passed`);
