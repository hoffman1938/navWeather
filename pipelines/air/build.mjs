#!/usr/bin/env node
/**
 * Air quality worldwide (DEVELOPMENT_PLAN DP-4.6): the CAMS global forecast → the European Air Quality Index per hour
 * in tiles in R2 (format and index: src/api/air.ts), read by `/api/v1/air`. Replaces the Open-Meteo Air Quality API.
 *
 *   npm run data:air                       # newest CAMS run → local R2 (the bucket of `npm run dev`)
 *   npm run data:air -- --env production   # into that environment's bucket on Cloudflare
 *   npm run data:air -- --max-mb 50        # download ceiling for one run (default 32 MB; it stops before it)
 *
 * Source: Copernicus Atmosphere Monitoring Service global forecast, 0.4°, twice a day (free licence with
 * attribution: "Generated using Copernicus Atmosphere Monitoring Service information"), from the Open-Meteo
 * open-data archive on AWS (CC BY 4.0) — PM2.5 and PM10 hourly, NO₂, O₃, SO₂ three-hourly, five days; land and
 * coasts only, read with HTTP range requests.
 */
import { readFileSync } from 'node:fs';
import { AIR_GRID, AIR_LATEST_KEY, AIR_NONE, AIR_TILE, airRunPrefix, airTileKey, europeanAqi, trailingMean } from '../../src/api/air.ts';
import { countryAt, decodeCountries } from '../../src/trip/countries.ts';
import { option, openStore, writer } from '../lib/store.mjs';
import { getJson, OmVariable, setDownloadLimit, stats } from '../weather/om.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
setDownloadLimit(Number(option(args, 'max-mb') ?? 32));
const MODEL = 'cams_global';
const VARS = [
  ['pm2_5', 'pm2_5'],
  ['pm10', 'pm10'],
  ['no2', 'nitrogen_dioxide'],
  ['o3', 'ozone'],
  ['so2', 'sulphur_dioxide'],
];
const SOURCE =
  'Generated using Copernicus Atmosphere Monitoring Service information (CAMS global forecast), from the Open-Meteo open-data archive on AWS (CC BY 4.0)';
const MAX_SPAN_TILES = 8;

const t0 = Date.now();
const p2 = (n) => String(n).padStart(2, '0');
const meta = await getJson(`data_run/${MODEL}/latest.json`);
const ref = Date.parse(meta.reference_time) / 1000;
const d = new Date(ref * 1000);
const dir = `data_run/${MODEL}/${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${p2(d.getUTCHours())}00Z`;
const run = `cams${d.toISOString().slice(0, 13).replace(/[-T:]/g, '')}`;

const store = await openStore({ binding: 'WEATHER', env: option(args, 'env'), out: option(args, 'out') });
const previous = JSON.parse((await store.getText(AIR_LATEST_KEY)) ?? 'null');
if (previous?.run === run && !FORCE) {
  console.log(`${run} is already the latest (--force to rebuild).`);
  await store.close();
  process.exit(0);
}

// Land and coasts: tiles touching a country (Natural Earth); not Antarctica.
const countries = decodeCountries(JSON.parse(readFileSync('src/trip/data/countries-v1.json', 'utf8')));
const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
const tileRows = Math.ceil(AIR_GRID.rows / AIR_TILE);
const tileCols = AIR_GRID.cols / AIR_TILE;
const land = [];
for (let ty = 0; ty < tileRows; ty++) {
  const row = [];
  const s = AIR_GRID.lat0 + ty * AIR_TILE * AIR_GRID.step - AIR_GRID.step / 2;
  for (let tx = 0; tx < tileCols && s + AIR_TILE * AIR_GRID.step >= -60; tx++) {
    const w = AIR_GRID.lon0 + tx * AIR_TILE * AIR_GRID.step - AIR_GRID.step / 2;
    let any = false;
    for (let y = s; y <= s + AIR_TILE * AIR_GRID.step && !any; y += 0.2) for (let x = w; x <= w + AIR_TILE * AIR_GRID.step && !any; x += 0.2) any = !!countryAt(countries, [wrap(x), Math.max(-90, Math.min(90, y))]);
    if (any) row.push(tx);
  }
  land.push(row);
}
const tileCount = land.reduce((n, r) => n + r.length, 0);

const files = [];
for (const [key, name] of VARS) {
  const f = await OmVariable.open(`${dir}/${name}.om`, { blockKB: 0 });
  if (f.dims[0] !== AIR_GRID.rows || f.dims[1] !== AIR_GRID.cols) throw new Error(`${f.path}: grid ${f.dims}`);
  if (f.unit !== 'μg/m³' && f.unit !== 'µg/m³') throw new Error(`${f.path}: unit ${f.unit}`);
  files.push({ key, f });
}
// The index is hourly (the PM axis); gases come three-hourly and are interpolated.
const times = files[0].f.times;
const H = times.length;
console.log(`CAMS ${meta.reference_time}: ${H} hours, ${tileCount} land tiles`);

const out = writer(store);
let written = 0;
const series = (values, off, T, srcTimes) => {
  if (srcTimes.length === H) return Float32Array.from(values.subarray(off, off + T));
  const outv = new Float32Array(H).fill(NaN);
  for (let h = 0; h < H; h++) {
    const t = times[h];
    let k = 0;
    while (k < srcTimes.length - 1 && srcTimes[k + 1] <= t) k++;
    const a = values[off + k];
    if (srcTimes[k] === t) outv[h] = a;
    else if (k < srcTimes.length - 1 && srcTimes[k] < t) {
      const b = values[off + k + 1];
      const w = (t - srcTimes[k]) / (srcTimes[k + 1] - srcTimes[k]);
      outv[h] = a + (b - a) * w;
    }
  }
  return outv;
};

let stopped = false;
const built = new Set();
for (let ty = 0; ty < tileRows && !stopped; ty++) {
  if (!land[ty].length) continue;
  const r0 = ty * AIR_TILE;
  const r1 = Math.min(AIR_GRID.rows, r0 + AIR_TILE);
  const spans = [];
  for (const tx of land[ty]) {
    const last = spans[spans.length - 1];
    if (last && last[1] === tx - 1 && tx - last[0] < MAX_SPAN_TILES) last[1] = tx;
    else spans.push([tx, tx]);
  }
  for (const [tx0, tx1] of spans) {
    const c0 = tx0 * AIR_TILE;
    const c1 = (tx1 + 1) * AIR_TILE;
    const width = c1 - c0;
    let data;
    try {
      data = await Promise.all(files.map(({ f }) => f.read(r0, r1, c0, c1)));
    } catch (e) {
      if (!/download limit/.test(String(e?.message))) throw e;
      console.warn(`  ${e.message}: ${tileCount - written} tiles are not built (run again with a higher --max-mb)`);
      stopped = true;
      break;
    }
    for (let tx = tx0; tx <= tx1; tx++) {
      const rec = new Uint8Array(AIR_TILE * AIR_TILE * H).fill(AIR_NONE);
      for (let pr = 0; pr < r1 - r0; pr++) {
        for (let pc = 0; pc < AIR_TILE; pc++) {
          const col = tx * AIR_TILE + pc;
          const s = {};
          files.forEach(({ key, f }, n) => {
            const T = f.dims[2];
            s[key] = series(data[n], (pr * width + (col - c0)) * T, T, f.times);
          });
          const base = (pr * AIR_TILE + pc) * H;
          for (let h = 0; h < H; h++) {
            const v = (x) => (Number.isFinite(x) ? x : null);
            const aqi = europeanAqi({ pm2_5: trailingMean(s.pm2_5, h), pm10: trailingMean(s.pm10, h), no2: v(s.no2[h]), o3: v(s.o3[h]), so2: v(s.so2[h]) });
            if (aqi !== null) rec[base + h] = Math.min(250, aqi);
          }
        }
      }
      await out.put(airTileKey(run, ty, tx), rec);
      built.add(`${ty}/${tx}`);
      written++;
    }
  }
  console.log(`  tiles ${written}/${tileCount} · downloaded ${(stats.bytes / 1e6).toFixed(1)} MB · ${Math.round((Date.now() - t0) / 1000)} s`);
}
await out.flush();

const index = { v: 1, run, createdAt: Math.floor(Date.now() / 1000), referenceTime: ref, times, source: SOURCE, tiles: [...built] };
const json = JSON.stringify(index);
await store.put(`${airRunPrefix(run)}index.json`, json);
await store.put(AIR_LATEST_KEY, json);
const keep = new Set([run, previous?.run]);
for (const prefix of await store.prefixes('air/runs/')) {
  const r = prefix.split('/')[2];
  if (!keep.has(r)) await store.deletePrefix(prefix);
}
for (const { f } of files) f.dispose();
await store.close();
console.log(`${run}: ${written} of ${tileCount} tiles${stopped ? ' (stopped at the download ceiling)' : ''}, ${(out.bytes / 1e6).toFixed(1)} MB → ${store.kind}; downloaded ${(stats.bytes / 1e6).toFixed(1)} MB; ${Math.round((Date.now() - t0) / 1000)} s`);
