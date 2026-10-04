#!/usr/bin/env node
/**
 * Country borders for the app and the Worker (DEVELOPMENT_PLAN DP-4.5): Natural Earth admin-0 countries (1:50m,
 * public domain) → a compact file the client and the Worker read to find the country of a point. Replaces the
 * public Overpass `is_in` lookup (B-22, ADR-015 class B: an open data file downloaded on a schedule).
 *
 *   npm run data:borders            # reads data/raw/ne_50m_admin_0_countries.geojson
 *   (download: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson)
 *
 * Output: src/trip/data/countries-v1.json (committed: public domain, ~0.55 MB / 0.23 MB gzip, changes rarely). Rings are
 * simplified (Douglas–Peucker, 0.01° ≈ 1 km — crossings need ±10 km; coasts stay close), quantized to
 * 0.001° and delta-encoded as integers.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = process.argv[2] ?? 'data/raw/ne_50m_admin_0_countries.geojson';
const OUT = 'src/trip/data/countries-v1.json';
const EPS = 0.01;
const Q = 1000; // 0.001°

function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(pts) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > max) [max, idx] = [d, i];
    }
    if (idx > 0 && max > EPS) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A ring as [x0, y0, dx1, dy1, …] in 0.001° units; null when it collapses. */
function encodeRing(ring) {
  const pts = simplify(ring.slice(0, -1)); // the closing point is implied
  const q = [];
  let px = 0;
  let py = 0;
  for (const [x, y] of pts) {
    const ix = Math.round(x * Q);
    const iy = Math.round(y * Q);
    if (q.length && ix === px && iy === py) continue;
    q.push(ix - px, iy - py);
    [px, py] = [ix, iy];
  }
  return q.length >= 6 ? q : null;
}

const code = (p) => [p.ISO_A2_EH, p.ISO_A2, p.WB_A2].find((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)) ?? p.ADM0_A3;

const src = JSON.parse(readFileSync(SRC, 'utf8'));
const countries = [];
let vertices = 0;
for (const f of src.features) {
  const p = f.properties;
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  const out = [];
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const poly of polys) {
    const rings = poly.map(encodeRing);
    if (!rings[0]) continue; // the outer ring vanished at this scale (a tiny island)
    out.push(rings.filter(Boolean));
    for (const [x, y] of poly[0]) [w, s, e, n] = [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)];
    vertices += rings.reduce((a, r) => a + (r ? r.length / 2 : 0), 0);
  }
  if (!out.length) continue;
  const round = (v) => Math.round(v * 100) / 100;
  countries.push({ c: code(p), en: p.NAME_EN || p.ADMIN, ru: p.NAME_RU || p.NAME_EN || p.ADMIN, b: [w, s, e, n].map(round), p: out });
}
countries.sort((a, b) => a.c.localeCompare(b.c));
const data = {
  v: 1,
  source: 'Natural Earth 1:50m admin-0 countries (public domain), naturalearthdata.com',
  builtAt: new Date().toISOString().slice(0, 10),
  q: Q,
  countries,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data));
console.log(`${countries.length} countries, ${vertices} vertices → ${OUT} (${Math.round(JSON.stringify(data).length / 1024)} KB)`);
