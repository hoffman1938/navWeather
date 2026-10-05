#!/usr/bin/env node
/**
 * Ground heights for the app and the Worker (DEVELOPMENT_PLAN DP-4.7): Copernicus DEM GLO-90 → our elevation tiles in
 * R2 (format: src/api/elevation.ts), read by `/api/v1/elevation` (route profiles, passes) and by the forecast (the
 * temperature at a point's own height). Replaces the Open-Meteo Elevation API (ADR-015 class B: open data files).
 *
 *   npm run data:elevation                         # Georgia and its borders (default box 39,41,47,44) → local R2
 *   npm run data:elevation -- --bbox 26,36,45,43   # another area (whole degrees, w,s,e,n)
 *   npm run data:elevation -- --world              # every land tile (~10 GB read; for the scheduled job, not a laptop)
 *   npm run data:elevation -- --env production     # into that environment's bucket on Cloudflare
 *   npm run data:elevation -- --out data/build/elev   # files instead of R2
 *   npm run data:elevation -- --max-mb 60          # download ceiling for one run (default 40 MB; the run stops before it)
 *   npm run data:elevation -- --index-only         # just list the tiles already in the bucket (no download)
 *
 * Source: Copernicus DEM GLO-90 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under
 * COPERNICUS by the European Union and ESA; free licence with attribution), as 1°-latitude bands in the Open-Meteo
 * open-data archive on AWS — read with HTTP range requests, only the parts needed (~1–1.5 MB per 1° tile). Tiles add up:
 * building another area keeps the ones already there (index.json lists the tiles built and those found to be sea);
 * a run stopped by the ceiling keeps what it built and the next run goes on from there.
 */
import { deflateRawSync } from 'node:zlib';
import { decodeCountries, countryAt } from '../../src/trip/countries.ts';
import { ELEV_BLOCKS, ELEV_HEADER_BYTES, ELEV_INDEX_BYTES, ELEV_INDEX_KEY, ELEV_MISSING, elevTileKey, encodeHeader } from '../../src/api/elevation.ts';
import { option, openStore, writer } from '../lib/store.mjs';
import { OmVariable, setDownloadLimit, stats } from '../weather/om.mjs';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const WORLD = args.includes('--world');
const FORCE = args.includes('--force');
/** Only list the tiles already in the bucket into the index — no download (after a run stopped at the ceiling). */
const INDEX_ONLY = args.includes('--index-only');
const BBOX = (option(args, 'bbox') ?? '39,41,47,44').split(',').map(Number);
if (BBOX.length !== 4 || BBOX.some((v) => !Number.isInteger(v))) throw new Error('--bbox is four whole degrees: w,s,e,n');
const [W, S, E, N] = WORLD ? [-180, -60, 180, 84] : BBOX;
// About 1–1.5 MB per 1° tile: Georgia's box (24 tiles) ≈ 30 MB. The world needs --max-mb 0 (no limit).
setDownloadLimit(Number(option(args, 'max-mb') ?? (WORLD ? 0 : 40)));
const SOURCE =
  'Copernicus DEM GLO-90 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA), via the Open-Meteo open-data archive';

const t0 = Date.now();
const store = await openStore({ binding: 'DATA', env: option(args, 'env'), out: option(args, 'out') });
const index = JSON.parse((await store.getText(ELEV_INDEX_KEY)) ?? 'null') ?? { v: 1, source: SOURCE, builtAt: '', tiles: [], sea: [] };
const have = new Set(index.tiles);
const sea = new Set(index.sea ?? []);

// The world: only tiles that touch a country (Natural Earth), with a margin for coasts.
const countries = WORLD ? decodeCountries(JSON.parse(readFileSync('src/trip/data/countries-v1.json', 'utf8'))) : null;
const touchesLand = (lat, lon) => {
  if (!countries) return true;
  for (let y = lat - 0.1; y <= lat + 1.1; y += 0.2) for (let x = lon - 0.1; x <= lon + 1.1; x += 0.2) if (countryAt(countries, [x, y])) return true;
  return false;
};

const out = writer(store);
let built = 0;
let skipped = 0;
let stopped = false;
for (let lat = S; lat < N; lat++) {
  if (stopped) break;
  const lons = [];
  for (let lon = W; lon < E; lon++) {
    const k = `${lat}/${lon}`;
    if (!FORCE && (have.has(k) || sea.has(k))) continue;
    // A run stopped earlier (the download ceiling) left tiles without an index: keep them.
    if (!FORCE && (await store.has(elevTileKey(lat, lon)))) {
      have.add(k);
      continue;
    }
    if (INDEX_ONLY) continue;
    if (touchesLand(lat, lon)) lons.push(lon);
    else sea.add(k);
  }
  if (!lons.length) continue;
  const band = await OmVariable.open(`data/copernicus_dem90/static/lat_${lat}.om`, { blockKB: 16 });
  const [rows, cols] = band.dims;
  const cpd = cols / 360;
  if (rows !== 1200 || !Number.isInteger(cpd) || cpd % ELEV_BLOCKS !== 0) throw new Error(`lat_${lat}.om: unexpected grid ${band.dims}`);
  for (const lon of lons) {
    const c0 = (lon + 180) * cpd;
    let v;
    try {
      v = await band.read(0, rows, c0, c0 + cpd);
    } catch (e) {
      if (!/download limit/.test(String(e?.message))) throw e;
      console.warn(`  ${e.message}: ${lat}/${lon} and the tiles after it are not built (run again with a higher --max-mb)`);
      stopped = true;
      break;
    }
    const cells = new Int16Array(v.length);
    let land = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (!Number.isFinite(x) || x < -500 || x > 9000) cells[i] = ELEV_MISSING;
      else {
        cells[i] = Math.round(x);
        if (cells[i] !== 0) land++;
      }
    }
    if (!land) {
      skipped++; // open sea: no object (a point here is at height 0)
      sea.add(`${lat}/${lon}`);
      continue;
    }
    const blockRows = rows / ELEV_BLOCKS;
    const blockCols = cpd / ELEV_BLOCKS;
    const parts = [];
    const blocks = [];
    let offset = ELEV_HEADER_BYTES + ELEV_INDEX_BYTES;
    for (let br = 0; br < ELEV_BLOCKS; br++) {
      for (let bc = 0; bc < ELEV_BLOCKS; bc++) {
        const block = new Int16Array(blockRows * blockCols);
        let any = false;
        for (let r = 0; r < blockRows; r++) {
          const src = (br * blockRows + r) * cpd + bc * blockCols;
          block.set(cells.subarray(src, src + blockCols), r * blockCols);
        }
        for (const x of block) if (x !== ELEV_MISSING && x !== 0) any = true;
        if (!any) {
          blocks.push({ offset: 0, length: 0 });
          continue;
        }
        const z = deflateRawSync(new Uint8Array(block.buffer), { level: 9 });
        blocks.push({ offset, length: z.length });
        parts.push(z);
        offset += z.length;
      }
    }
    const header = encodeHeader({ rows, cols: cpd, blockRows, blockCols, lat, lon }, blocks);
    const file = new Uint8Array(offset);
    file.set(header, 0);
    let o = header.length;
    for (const z of parts) {
      file.set(z, o);
      o += z.length;
    }
    await out.put(elevTileKey(lat, lon), file);
    have.add(`${lat}/${lon}`);
    built++;
  }
  band.dispose();
  console.log(`  lat ${lat}: ${built} tiles so far (${(out.bytes / 1e6).toFixed(1)} MB), ${(stats.bytes / 1e6).toFixed(1)} MB downloaded, ${Math.round((Date.now() - t0) / 1000)} s`);
}
await out.flush();

index.source = SOURCE;
index.builtAt = new Date().toISOString().slice(0, 10);
index.tiles = [...have].sort();
index.sea = [...sea].filter((k) => !have.has(k)).sort();
delete index.coverage;
await store.put(ELEV_INDEX_KEY, JSON.stringify(index));
await store.close();
console.log(`elevation: ${built} tiles built (${skipped} sea)${stopped ? ' — stopped at the download ceiling' : ''}, ${index.tiles.length} in all, ${(out.bytes / 1e6).toFixed(1)} MB → ${store.kind}; downloaded ${(stats.bytes / 1e6).toFixed(1)} MB; ${Math.round((Date.now() - t0) / 1000)} s`);
