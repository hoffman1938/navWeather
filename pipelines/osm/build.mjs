#!/usr/bin/env node
/**
 * OpenStreetMap → our places tiles (DEVELOPMENT_PLAN DP-4.1, DP-4.2 — OSM part).
 *
 * Reads a regional extract (Geofabrik, ODbL) and writes small static JSON tiles, one file per layer and tile,
 * that the app and the Worker read instead of the public Overpass API: settlements (to name route points),
 * points of interest by category, speed cameras, level crossings and roads with a posted speed limit.
 * Static files cost nothing to serve on Cloudflare (static assets) and need no database; on localhost Vite serves
 * them from `public/`. They are built, not committed (`npm run data:osm`; ODbL: attribution in the app).
 *
 *   npm run data:osm                              # data/raw/georgia-latest.osm.pbf → public/data/places/v1/
 *   node pipelines/osm/build.mjs <file.osm.pbf>   # another extract
 *
 * Layout: public/data/places/v1/index.json (layers, tiles present, coverage, source and date) and
 * public/data/places/v1/<layer>/<z>/<x>/<y>.json → { v: 1, e: [[id, lon, lat, tags] | [id, kmh, coords]] }.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readPbf } from './pbf.mjs';
import { LAYERS, POINT_LAYERS, keepTags, layersOf, ROAD_LIMIT_HIGHWAY, tileOf, tilesOfBbox } from './layers.mjs';

const SRC = process.argv[2] ?? 'data/raw/georgia-latest.osm.pbf';
const OUT = process.env.PLACES_OUT ?? 'public/data/places/v1';
const COVERAGE_Z = 9;

const t0 = Date.now();
const buf = readFileSync(SRC);

// Node coordinates, kept for the ways we need (way centres, speed-limit geometry). Nodes come sorted by id.
let cap = 1 << 22;
let ids = new Float64Array(cap);
let lats = new Int32Array(cap);
let lons = new Int32Array(cap);
let count = 0;
function addNode(id, lat, lon) {
  if (count === cap) {
    cap *= 2;
    const [a, b, c] = [new Float64Array(cap), new Int32Array(cap), new Int32Array(cap)];
    a.set(ids);
    b.set(lats);
    c.set(lons);
    [ids, lats, lons] = [a, b, c];
  }
  ids[count] = id;
  lats[count] = Math.round(lat * 1e7);
  lons[count] = Math.round(lon * 1e7);
  count++;
}
function nodeAt(id) {
  let lo = 0;
  let hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ids[mid];
    if (v === id) return [lons[mid] / 1e7, lats[mid] / 1e7];
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** layer → tile key "z/x/y" → elements */
const tiles = new Map(LAYERS.map((l) => [l.id, new Map()]));
const coverage = new Set();
const stats = Object.fromEntries(LAYERS.map((l) => [l.id, 0]));
const round6 = (v) => Math.round(v * 1e6) / 1e6;

function put(layerId, key, element) {
  const m = tiles.get(layerId);
  if (!m.has(key)) m.set(key, []);
  m.get(key).push(element);
}

function addPoint(type, id, lon, lat, tags) {
  for (const layer of layersOf(tags, POINT_LAYERS, type)) {
    const [x, y] = tileOf(lon, lat, layer.z);
    put(layer.id, `${layer.z}/${x}/${y}`, [`${type}${id}`, round6(lon), round6(lat), keepTags(tags)]);
    stats[layer.id]++;
  }
}

for (const block of readPbf(buf)) {
  for (const e of block) {
    if (e.type === 'node') {
      addNode(e.id, e.lat, e.lon);
      const [cx, cy] = tileOf(e.lon, e.lat, COVERAGE_Z);
      coverage.add(`${cx}/${cy}`);
      addPoint('n', e.id, e.lon, e.lat, e.tags);
    } else if (e.type === 'way') {
      const t = e.tags;
      const pointLayers = layersOf(t, POINT_LAYERS, 'w');
      const limit = t.maxspeed && ROAD_LIMIT_HIGHWAY.test(t.highway ?? '');
      if (!pointLayers.length && !limit) continue;
      const coords = [];
      for (const ref of e.refs) {
        const c = nodeAt(ref);
        if (c) coords.push(c);
      }
      if (!coords.length) continue;
      let [w, s, ea, n] = [180, 90, -180, -90];
      for (const [x, y] of coords) [w, s, ea, n] = [Math.min(w, x), Math.min(s, y), Math.max(ea, x), Math.max(n, y)];
      // Like Overpass `out center`: the centre of the way's bounding box.
      if (pointLayers.length) addPoint('w', e.id, (w + ea) / 2, (s + n) / 2, t);
      if (limit && coords.length >= 2) {
        const layer = LAYERS.find((l) => l.id === 'maxspeed');
        const q = coords.map(([x, y]) => [round6(x), round6(y)]);
        for (const [x, y] of tilesOfBbox([w, s, ea, n], layer.z)) put('maxspeed', `${layer.z}/${x}/${y}`, [`w${e.id}`, t.maxspeed, q, t.highway]);
        stats.maxspeed++;
      }
    }
  }
}

rmSync(OUT, { recursive: true, force: true });
let files = 0;
let bytes = 0;
const index = {
  v: 1,
  region: 'ge',
  source: 'OpenStreetMap contributors (ODbL 1.0) — extract by Geofabrik',
  license: 'ODbL-1.0',
  dataDate: statSync(SRC).mtime.toISOString().slice(0, 10),
  builtAt: new Date().toISOString(),
  coverage: { z: COVERAGE_Z, tiles: [...coverage].sort() },
  layers: {},
};
for (const layer of LAYERS) {
  const m = tiles.get(layer.id);
  index.layers[layer.id] = { z: layer.z, tiles: [...m.keys()].map((k) => k.split('/').slice(1).join('/')).sort() };
  for (const [key, elements] of m) {
    const path = join(OUT, layer.id, `${key}.json`);
    mkdirSync(dirname(path), { recursive: true });
    const json = JSON.stringify({ v: 1, e: elements });
    writeFileSync(path, json);
    files++;
    bytes += json.length;
  }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
console.log(
  `${count.toLocaleString('en')} nodes read; ${Object.entries(stats)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}`,
);
console.log(`${files} tiles, ${(bytes / 1e6).toFixed(1)} MB → ${OUT} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
