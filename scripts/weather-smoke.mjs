// Our forecast through the Worker (DEVELOPMENT_PLAN DP-4.6, DP-6.6):
//   npm run data:weather && npm run dev     then     npm run test:weather
//   [WEATHER_BASE=https://… to test a deployment; API=/api for legacy paths]
import assert from 'node:assert/strict';

const BASE = process.env.WEATHER_BASE ?? 'http://127.0.0.1:8787';
const API = process.env.API ?? '/api/v1';
const get = (path) => fetch(`${BASE}${API}${path}`);
let passed = 0;
const ok = (name) => console.log(`  ✓ ${name}`, ++passed);
const APP_QUERY =
  'hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,relative_humidity_2m&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh&past_hours=3&forecast_hours=72';

console.log(`Weather @ ${BASE}${API}`);
assert.equal((await fetch(`${BASE}${API}/weather/forecast?latitude=1&longitude=1`, { method: 'POST' })).status, 405);
assert.equal((await get('/weather/forecast?latitude=1')).status, 400);
assert.equal((await get('/weather/forecast?latitude=1&longitude=1&timeformat=iso8601')).status, 400);
ok('validation and method checks');

const meta = await get('/weather/meta');
if (meta.status === 503) {
  console.log('  – no weather tiles here (npm run data:weather locally; the scheduled pipeline in the cloud) — forecast checks skipped');
} else {
  assert.equal(meta.status, 200);
  const m = await meta.json();
  assert.ok(m.run && m.reference_time > 0 && m.until > m.reference_time);
  ok(`built from ${Object.entries(m.models).map(([k, v]) => `${k} ${v.join(' + ')}`).join(', ')}${m.fresh ? '' : ' (too old: forecasts are refused)'}`);
  if (m.fresh) {
    // Tbilisi, a pass in the Caucasus, New York, Sydney — and the middle of the Pacific.
    const pts = [
      [41.6935, 44.8015],
      [42.4592, 44.4831],
      [40.7128, -74.006],
      [-33.8688, 151.2093],
      [30, -150],
    ];
    const res = await get(`/weather/forecast?latitude=${pts.map((p) => p[0])}&longitude=${pts.map((p) => p[1])}&${APP_QUERY}`);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.equal(list.length, pts.length);
    const [tbilisi, pass] = list;
    assert.equal(tbilisi.timezone, 'Asia/Tbilisi');
    assert.equal(tbilisi.utc_offset_seconds, 4 * 3600);
    const n = tbilisi.hourly.time.length;
    assert.ok(n >= 60, `${n} hours`);
    for (const [k, v] of Object.entries(tbilisi.hourly)) assert.equal(v.length, n, k);
    assert.ok(tbilisi.hourly.time.every((t, i) => i === 0 || t - tbilisi.hourly.time[i - 1] === 3600));
    assert.ok(tbilisi.hourly.temperature_2m.every((t) => t === null || (t > -40 && t < 50)));
    assert.ok(tbilisi.hourly.precipitation_probability.every((p) => p === null));
    ok(`Tbilisi: ${n} hours, ${tbilisi.hourly.temperature_2m[3]} °C now, code ${tbilisi.hourly.weather_code[3]}`);
    assert.ok(pass.elevation > 1500, `the pass cell is ${pass.elevation} m`);
    assert.equal(list[2].timezone, 'America/New_York');
    assert.equal(list[3].timezone, 'Australia/Sydney');
    assert.ok(list[3].hourly.temperature_2m.some((t) => t !== null));
    ok('anywhere on Earth: New York and Sydney answer in their own time zones');
    assert.equal(list[4].missing, true);
    ok('far out at sea: "missing" (the app asks its fallback there)');
    // The same place 1000 m lower is ~6.5 °C warmer.
    const low = await (await get(`/weather/forecast?latitude=42.4592&longitude=44.4831&elevation=${pass.elevation - 1000}&hourly=temperature_2m&forecast_hours=6`)).json();
    const high = await (await get(`/weather/forecast?latitude=42.4592&longitude=44.4831&hourly=temperature_2m&forecast_hours=6`)).json();
    const d = low.hourly.temperature_2m[0] - high.hourly.temperature_2m[0];
    assert.ok(Math.abs(d - 6.5) < 0.2, `lapse ${d}`);
    ok('a point 1000 m below its grid cell is 6.5 °C warmer');
    const single = await (await get(`/weather/forecast?latitude=41.69&longitude=44.8&hourly=wind_speed_10m&wind_speed_unit=ms&forecast_hours=3`)).json();
    assert.ok(!Array.isArray(single) && single.hourly_units.wind_speed_10m === 'm/s');
    ok('one location → one object (as Open-Meteo); wind in m/s on request');
  }
}
console.log(`${passed} checks passed`);
