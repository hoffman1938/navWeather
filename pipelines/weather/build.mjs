#!/usr/bin/env node
/**
 * Our worldwide weather forecast (DEVELOPMENT_PLAN DP-4.6, DP-6.6): open model data → weather tiles in R2, which the
 * Worker's `/api/v1/weather/forecast` reads (src/api/weather.ts describes the format). ADR-015 class B: open data
 * files downloaded on a schedule — no weather API, no key, no per-request fee.
 *
 *   npm run data:weather                                  # newest runs → local R2 (what `npm run dev` serves)
 *   npm run data:weather -- --bbox 39,40,47,44            # only tiles touching this box (w,s,e,n): a quick local run
 *   npm run data:weather -- --out data/build/weather      # write the objects as files instead of R2
 *   npm run data:weather -- --force                       # rebuild even when these runs are already there
 *
 * Sources (read with HTTP range requests from the Open-Meteo open-data archive on AWS, CC BY 4.0):
 *   ECMWF IFS 0.25° (CC BY 4.0) — temperature, humidity, clouds, precipitation, snowfall, wind, gusts, CAPE,
 *     precipitation type. The newest run; when it is a short one (06Z/18Z, 6 days), the previous long run
 *     (00Z/12Z, 15 days) continues it.
 *   NOAA GFS 0.25° (public domain) — visibility (fog).
 * Only land and its coasts are kept (tiles that touch a country of Natural Earth; not Antarctica): about 40 % of
 * the globe, ~250 MB downloaded per run. Two builds stay in R2 (the newest and the one before, for requests in
 * flight); older ones are deleted.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GRID, LATEST_KEY, MISSING, recordValues, runPrefix, TILE, tileKey, VARS } from '../../src/api/weather.ts';
import { countryAt, decodeCountries } from '../../src/trip/countries.ts';
import { getJson, OmVariable, stats } from './om.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = opt('out');
const BBOX = opt('bbox')?.split(',').map(Number);
const FORCE = args.includes('--force');

const IFS = 'ecmwf_ifs025';
const GFS = 'ncep_gfs025';
/** Our variable → model, Open-Meteo variable, unit it must have, plausible range (anything outside fails the build). */
const SOURCES = {
  t2m: [IFS, 'temperature_2m', '°C', -95, 65],
  rh: [IFS, 'relative_humidity_2m', '%', 0, 101],
  cloud: [IFS, 'cloud_cover', '%', 0, 101],
  precip: [IFS, 'precipitation', 'mm', -0.1, 1000],
  swe: [IFS, 'snowfall_water_equivalent', 'mm', -0.1, 1000],
  u10: [IFS, 'wind_u_component_10m', 'm/s', -150, 150],
  v10: [IFS, 'wind_v_component_10m', 'm/s', -150, 150],
  gust: [IFS, 'wind_gusts_10m', 'm/s', 0, 150],
  cape: [IFS, 'cape', 'J/kg', 0, 30000],
  ptype: [IFS, 'precipitation_type', null, 0, 20],
  vis: [GFS, 'visibility', 'm', 0, 200000],
};
const SOURCE_TEXT =
  'ECMWF IFS 0.25° open data (CC BY 4.0) and NOAA GFS 0.25° (public domain), from the Open-Meteo open-data archive on AWS (CC BY 4.0)';

const t0 = Date.now();
const iso = (s) => new Date(s * 1000).toISOString().slice(0, 16) + 'Z';
const compact = (s) => iso(s).slice(0, 13).replace(/[-T:]/g, '');
const runDir = (model, refS) => {
  const d = new Date(refS * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `data_run/${model}/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`;
};
const runOf = (model, meta) => {
  const ref = Date.parse(meta.reference_time) / 1000;
  return { model, ref, dir: runDir(model, ref), times: meta.valid_times.map((t) => Date.parse(t) / 1000), variables: meta.variables };
};

// ---- which runs ----

const newest = runOf(IFS, await getJson(`data_run/${IFS}/latest.json`));
const newestEnd = newest.times[newest.times.length - 1];
let older = null;
if (newestEnd - newest.ref < 300 * 3600) {
  for (let back = 6; back <= 24 && !older; back += 6) {
    const ref = newest.ref - back * 3600;
    if ((ref / 3600) % 12 !== 0) continue;
    const meta = await getJson(`${runDir(IFS, ref)}/meta.json`).catch(() => null);
    if (meta && runOf(IFS, meta).times.at(-1) > newestEnd) older = runOf(IFS, meta);
  }
}
const gfs = runOf(GFS, await getJson(`data_run/${GFS}/latest.json`));
for (const [key, [model, name]] of Object.entries(SOURCES)) {
  for (const r of [model === IFS ? newest : gfs, model === IFS ? older : null]) {
    if (r && !r.variables.includes(name)) throw new Error(`${r.dir} has no ${name} (needed for ${key})`);
  }
}

const times = [...newest.times, ...(older ? older.times.filter((t) => t > newestEnd) : [])];
const S = times.length;
// A partial build (--bbox) gets its own name: a later full build of the same runs must not be skipped.
const run = `ifs${compact(newest.ref)}${older ? `+${compact(older.ref)}` : ''}-gfs${compact(gfs.ref)}${BBOX ? `-box${BBOX.map(Math.round).join('_')}` : ''}`;
console.log(`IFS ${iso(newest.ref)}${older ? ` (continued by ${iso(older.ref)})` : ''}, GFS ${iso(gfs.ref)}: ${S} steps to ${iso(times[S - 1])}`);

// ---- where we write ----

async function openStore() {
  if (OUT) {
    return {
      kind: `files in ${OUT}`,
      put: async (key, bytes) => {
        mkdirSync(dirname(join(OUT, key)), { recursive: true });
        writeFileSync(join(OUT, key), bytes);
      },
      getText: async (key) => {
        try {
          return readFileSync(join(OUT, key), 'utf8');
        } catch {
          return null;
        }
      },
      runs: async () => [],
      deleteRun: async () => {},
      close: async () => {},
    };
  }
  const { getPlatformProxy } = await import('wrangler');
  // The same local state `wrangler dev` uses (.wrangler/state), so the dev Worker sees what we write.
  const proxy = await getPlatformProxy({ persist: true });
  const bucket = proxy.env.WEATHER;
  if (!bucket) throw new Error('wrangler.toml has no R2 binding WEATHER');
  const keys = async (prefix) => {
    const out = [];
    let cursor;
    do {
      const page = await bucket.list({ prefix, cursor });
      out.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return out;
  };
  return {
    kind: 'local R2 (bucket of `npm run dev`)',
    put: (key, bytes) => bucket.put(key, bytes),
    getText: async (key) => (await bucket.get(key))?.text() ?? null,
    runs: async () => (await bucket.list({ prefix: 'weather/runs/', delimiter: '/' })).delimitedPrefixes.map((p) => p.split('/')[2]),
    deleteRun: async (r) => {
      const all = await keys(runPrefix(r));
      for (let i = 0; i < all.length; i += 1000) await bucket.delete(all.slice(i, i + 1000));
    },
    close: () => proxy.dispose(),
  };
}
const store = await openStore();
const previous = JSON.parse((await store.getText(LATEST_KEY)) ?? 'null');
if (previous?.run === run && !FORCE) {
  console.log(`${run} is already the latest (--force to rebuild).`);
  await store.close();
  process.exit(0);
}

// ---- which tiles: land and its coasts ----

const countries = decodeCountries(JSON.parse(readFileSync('src/trip/data/countries-v1.json', 'utf8')));
const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
function wanted(ty, tx) {
  const s = GRID.lat0 + ty * TILE * GRID.step - GRID.step / 2;
  const w = GRID.lon0 + tx * TILE * GRID.step - GRID.step / 2;
  const n = s + TILE * GRID.step;
  const e = w + TILE * GRID.step;
  if (n < -60) return false; // Antarctica: no roads to forecast for
  if (BBOX && (e < BBOX[0] || w > BBOX[2] || n < BBOX[1] || s > BBOX[3])) return false;
  for (let y = s; y <= n; y += GRID.step / 2) for (let x = w; x <= e; x += GRID.step / 2) if (countryAt(countries, [wrap(x), Math.max(-90, Math.min(90, y))])) return true;
  return false;
}
const tileRows = Math.ceil(GRID.rows / TILE);
const tileCols = GRID.cols / TILE;
const land = [];
for (let ty = 0; ty < tileRows; ty++) {
  const row = [];
  for (let tx = 0; tx < tileCols; tx++) if (wanted(ty, tx)) row.push(tx);
  land.push(row);
}
const tileCount = land.reduce((n, r) => n + r.length, 0);
console.log(`${tileCount} of ${tileRows * tileCols} tiles (land and coasts${BBOX ? `, inside ${BBOX.join(',')}` : ''})`);

// ---- the variables, mapped onto our steps ----

const outIndex = new Map(times.map((t, i) => [t, i]));
const sources = [];
const cover = VARS.map(() => new Array(S).fill(0));
for (const [j, v] of VARS.entries()) {
  const [model, name, unit] = SOURCES[v.key];
  const segments = model === GFS ? [[gfs, -Infinity, Infinity]] : [[newest, -Infinity, newestEnd], ...(older ? [[older, newestEnd, Infinity]] : [])];
  for (const [r, after, until] of segments) {
    const file = await OmVariable.open(`${r.dir}/${name}.om`);
    if (unit !== null && file.unit !== unit) throw new Error(`${file.path}: unit ${file.unit}, expected ${unit}`);
    if (file.dims[0] !== GRID.rows || file.dims[1] !== GRID.cols) throw new Error(`${file.path}: grid ${file.dims}`);
    const map = [];
    file.times.forEach((t, k) => {
      const o = outIndex.get(t);
      if (o === undefined || t <= after || t > until) return;
      map.push([k, o]);
      cover[j][o] = v.interval ? (t - (k > 0 ? file.times[k - 1] : r.ref)) / 3600 : 1;
    });
    sources.push({ j, key: v.key, scale: v.scale, file, map, T: file.dims[2], range: SOURCES[v.key].slice(3) });
  }
}
const hsurf = await OmVariable.open(`data/${IFS}/static/HSURF.om`);
const elevation = await hsurf.read(0, GRID.rows, 0, GRID.cols);

// ---- tiles ----

const RV = recordValues({ vars: VARS, times });
const odd = new Map();
const ptypes = new Map();
let written = 0;
let storedBytes = 0;
const pending = new Set();
async function put(key, bytes) {
  while (pending.size >= 8) await Promise.race(pending);
  const p = store.put(key, bytes).finally(() => pending.delete(p));
  pending.add(p);
  storedBytes += bytes.byteLength;
}

for (let ty = 0; ty < tileRows; ty++) {
  if (!land[ty].length) continue;
  const r0 = ty * TILE;
  const r1 = Math.min(GRID.rows, r0 + TILE);
  // Neighbouring tiles are read together (fewer, larger range requests).
  const spans = [];
  for (const tx of land[ty]) {
    const last = spans[spans.length - 1];
    if (last && last[1] === tx - 1) last[1] = tx;
    else spans.push([tx, tx]);
  }
  for (const [tx0, tx1] of spans) {
    const c0 = tx0 * TILE;
    const c1 = (tx1 + 1) * TILE;
    const width = c1 - c0;
    const data = await Promise.all(sources.map((s) => s.file.read(r0, r1, c0, c1)));
    for (let tx = tx0; tx <= tx1; tx++) {
      const rec = new Int16Array(TILE * TILE * RV).fill(MISSING);
      for (let pr = 0; pr < r1 - r0; pr++) {
        for (let pc = 0; pc < TILE; pc++) {
          const row = r0 + pr;
          const col = tx * TILE + pc;
          const base = (pr * TILE + pc) * RV;
          const e = elevation[row * GRID.cols + col];
          if (Number.isFinite(e)) rec[base] = Math.round(e);
          sources.forEach((s, n) => {
            const values = data[n];
            const off = (pr * width + (col - c0)) * s.T;
            const [lo, hi] = s.range;
            for (const [k, o] of s.map) {
              let x = values[off + k];
              if (!Number.isFinite(x)) continue;
              if (x < lo || x > hi) {
                odd.set(s.key, (odd.get(s.key) ?? 0) + 1);
                continue;
              }
              if (s.key === 'ptype') ptypes.set(x, (ptypes.get(x) ?? 0) + 1);
              if ((s.key === 'precip' || s.key === 'swe') && x < 0) x = 0;
              rec[base + 1 + s.j * S + o] = Math.max(-32767, Math.min(32767, Math.round(x * s.scale)));
            }
          });
        }
      }
      await put(tileKey(run, ty, tx), new Uint8Array(rec.buffer));
      written++;
    }
  }
  console.log(
    `  tiles ${written}/${tileCount} · downloaded ${(stats.bytes / 1e6).toFixed(0)} MB in ${stats.requests} requests · ${Math.round((Date.now() - t0) / 1000)} s`,
  );
}
await Promise.all(pending);
const values = written * TILE * TILE * S * sources.length;
for (const [key, n] of odd) {
  console.warn(`  ${key}: ${n} values outside the plausible range were left out`);
  if (n > values * 1e-4) throw new Error(`${key}: too many implausible values (${n}) — the source looks broken`);
}
console.log(`  precipitation types seen: ${[...ptypes.keys()].sort((a, b) => a - b).join(', ')}`);

// ---- index, switch, clean up ----

const index = {
  v: 1,
  run,
  createdAt: Math.floor(Date.now() / 1000),
  referenceTime: newest.ref,
  models: { [IFS]: [iso(newest.ref), ...(older ? [iso(older.ref)] : [])], [GFS]: [iso(gfs.ref)] },
  source: SOURCE_TEXT,
  tile: TILE,
  vars: VARS.map((v) => v.key),
  scales: VARS.map((v) => v.scale),
  times,
  cover,
  tiles: land.flatMap((row, ty) => row.map((tx) => `${ty}/${tx}`)),
};
const indexJson = JSON.stringify(index);
await store.put(`${runPrefix(run)}index.json`, indexJson);
await store.put(LATEST_KEY, indexJson);
const keep = new Set([run, previous?.run]);
for (const r of await store.runs()) {
  if (keep.has(r)) continue;
  await store.deleteRun(r);
  console.log(`  deleted the old build ${r}`);
}
for (const s of sources) s.file.dispose();
hsurf.dispose();
await store.close();
console.log(
  `${run}: ${written} tiles, ${(storedBytes / 1e6).toFixed(0)} MB → ${store.kind}; downloaded ${(stats.bytes / 1e6).toFixed(0)} MB; ${Math.round((Date.now() - t0) / 1000)} s`,
);
