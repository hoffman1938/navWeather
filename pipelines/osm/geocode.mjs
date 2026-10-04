/**
 * Our geocoder index (DEVELOPMENT_PLAN DP-4.4): settlements, named places, streets and addresses of a region in a
 * D1 (SQLite) table with an FTS5 full-text index, so search and suggestions need no third party (Nominatim,
 * Photon). Collected in the same pass over the extract as the places tiles (build.mjs); written as SQL that
 * `npm run db:geo:local` loads into the local D1 (and `wrangler d1 execute --remote` into Cloudflare's).
 *
 * Every row has its names in the source script plus English and Russian (OSM `name:en`/`name:ru`, else the
 * app's own transliteration of Georgian — the same as on screen), and the settlement it belongs to for labels
 * ("Rustavelis Ave, Tbilisi").
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { hasGeorgian, localizeScript } from '../../src/i18n/script.ts';
import { countryAt, decodeCountries } from '../../src/trip/countries.ts';

/** Country of a settlement for its label, from Natural Earth (the extract reaches over the border). */
const countries = decodeCountries(JSON.parse(readFileSync(new URL('../../src/trip/data/countries-v1.json', import.meta.url), 'utf8')));
const LOCAL_COUNTRY = { GE: 'საქართველო' };
function countryOf(lon, lat) {
  // A coastal town can fall just outside the simplified (≈1 km) coastline: look a little inland too.
  let p = [lon, lat];
  let en = countryAt(countries, p, 'en');
  for (const r of [0.02, 0.05]) {
    for (let k = 0; !en && k < 8; k++) {
      p = [lon + r * Math.cos((k * Math.PI) / 4), lat + r * Math.sin((k * Math.PI) / 4)];
      en = countryAt(countries, p, 'en');
    }
  }
  if (!en) return null;
  const ru = countryAt(countries, p, 'ru');
  return { en: en.name, ru: ru?.name ?? en.name, local: LOCAL_COUNTRY[en.code] ?? en.name };
}

/** Country names by ISO code (Natural Earth), for the labels of world cities. */
const countryNames = new Map(JSON.parse(readFileSync(new URL('../../src/trip/data/countries-v1.json', import.meta.url), 'utf8')).countries.map((c) => [c.c, c]));

/**
 * World cities (Natural Earth populated places, public domain, `data/raw/ne_10m_populated_places.geojson`) so a
 * search for a destination abroad ("Istanbul", "Ереван") finds the city — not a café of that name in the region.
 * The region's own countries are skipped: OpenStreetMap has their places in more detail.
 */
export function worldCities(path, skipCountries) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const f of JSON.parse(readFileSync(path, 'utf8')).features) {
    const p = f.properties;
    const code = [p.ISO_A2, p.ADM0_A3 && countryNames.has(p.ISO_A2) ? p.ISO_A2 : null].find((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c));
    if (code && skipCountries.has(code)) continue;
    const [lon, lat] = f.geometry.coordinates;
    const country = code ? countryNames.get(code) : null;
    const local = clean(p.NAME);
    const en = clean(p.NAME_EN) || local;
    const ru = clean(p.NAME_RU) || en;
    const pop = Number(p.POP_MAX) || 0;
    out.push({
      id: `ne${p.NE_ID ?? `${lon},${lat}`}`,
      kind: pop >= 100_000 ? 'city' : 'town',
      rank: (pop >= 100_000 ? 30 : 24) + (pop > 0 ? Math.min(7, Math.log10(pop)) : 0),
      lon,
      lat,
      local,
      en,
      ru,
      all: [...new Set([local, en, ru, clean(p.NAMEASCII), clean(p.NAME_DE), clean(p.NAME_TR)].filter(Boolean))].join(' '),
      ctx: country ? { en: country.en, ru: country.ru, local: country.en } : { en: clean(p.ADM0NAME), ru: clean(p.ADM0NAME), local: clean(p.ADM0NAME) },
    });
  }
  return out;
}

/** Settlement kinds and their base rank (bigger first). */
const PLACE_RANK = { city: 30, town: 24, village: 16, suburb: 14, hamlet: 10, quarter: 8, neighbourhood: 8, isolated_dwelling: 3 };
/** Named features worth finding by name, with a rank; anything else named with one of these keys gets 6. */
const POI_KEYS = ['amenity', 'tourism', 'shop', 'leisure', 'historic', 'railway', 'aeroway', 'natural', 'office', 'healthcare', 'building'];
const BIG_POI = { aerodrome: 22, station: 18, university: 12, hospital: 12, peak: 10, museum: 10, stadium: 10, mall: 10 };
/** Named roads people search for — also while under construction (Tbilisi's Rustaveli Avenue, 2026). */
const STREET = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|road|construction)$/;

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function namesOf(t, base = t.name) {
  const local = clean(base);
  const en = clean(t['name:en']) || clean(t.int_name) || (hasGeorgian(local) ? localizeScript(local, 'en') : local);
  const ru = clean(t['name:ru']) || (hasGeorgian(local) ? localizeScript(local, 'ru') : local);
  const all = new Set([local, en, ru, clean(t['name:ka']), clean(t.int_name), clean(t.old_name), clean(t.alt_name)].filter(Boolean));
  return { local, en, ru, all: [...all].join(' ') };
}

export function createGeocodeCollector() {
  const rows = [];
  const settlements = [];
  const streets = new Map();

  function add(id, kind, rank, lon, lat, n, extra = {}) {
    rows.push({ id, kind, rank, lon, lat, ...n, ...extra });
  }

  return {
    /** A node or way (with its centre) from the extract. */
    add(type, id, tags, lon, lat, wayCoords) {
      const t = tags;
      const place = t.place && PLACE_RANK[t.place] !== undefined;
      if (place && t.name) {
        const pop = Number(String(t.population ?? '').replace(/[^\d]/g, ''));
        const rank = PLACE_RANK[t.place] + (pop > 0 ? Math.min(6, Math.log10(pop)) : 0);
        const n = namesOf(t);
        add(`${type}${id}`, t.place, rank, lon, lat, n, { country: true });
        if (/^(city|town|village)$/.test(t.place)) settlements.push({ lon, lat, en: n.en, ru: n.ru, local: n.local, rank });
        return;
      }
      if (type === 'w' && t.highway && STREET.test(t.highway) && t.name && wayCoords?.length) {
        // One row per street name and place: the street's ways are merged later, nearest settlement decides.
        const key = clean(t.name);
        const mid = wayCoords[Math.floor(wayCoords.length / 2)];
        const list = streets.get(key) ?? [];
        list.push({ lon: mid[0], lat: mid[1], tags: t, len: wayCoords.length });
        streets.set(key, list);
      }
      if (t['addr:housenumber'] && t['addr:street']) {
        const street = namesOf({ name: t['addr:street'] });
        const num = clean(t['addr:housenumber']);
        add(`${type}${id}`, 'address', 2, lon, lat, {
          local: `${street.local} ${num}`,
          en: `${street.en} ${num}`,
          ru: `${street.ru} ${num}`,
          all: `${street.all} ${num}`,
        }, { city: clean(t['addr:city']) });
        if (!t.name) return;
      }
      if (t.name) {
        const key = POI_KEYS.find((k) => t[k] && t[k] !== 'no' && !(k === 'building' && t[k] === 'yes'));
        if (key) add(`${type}${id}`, t[key], BIG_POI[t[key]] ?? 6, lon, lat, namesOf(t));
      }
    },

    /** Rows with their own label (world cities): no nearest-settlement lookup. */
    addRows(list) {
      for (const r of list) rows.push({ ...r, fixedCtx: r.ctx });
    },

    /** Resolve settlements for labels and write the SQL. */
    write(path, meta) {
      // Streets: per name, cluster ways that are within 3 km of each other (one row per town's street).
      for (const [, ways] of streets) {
        const clusters = [];
        for (const w of ways) {
          const c = clusters.find((c) => Math.abs(c.lat - w.lat) < 0.03 && Math.abs(c.lon - w.lon) < 0.04);
          if (c) {
            if (w.len > c.len) Object.assign(c, w);
          } else clusters.push({ ...w });
        }
        for (const c of clusters) add(`s${c.lon.toFixed(5)},${c.lat.toFixed(5)}`, 'street', 5, c.lon, c.lat, namesOf(c.tags));
      }
      // Nearest settlement (grid of 0.1°) for every row's label.
      const grid = new Map();
      for (const s of settlements) {
        const k = `${Math.floor(s.lon * 10)},${Math.floor(s.lat * 10)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
      const nearest = (lon, lat) => {
        let best = null;
        let bestScore = Infinity;
        const [gx, gy] = [Math.floor(lon * 10), Math.floor(lat * 10)];
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const s of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
              const d = Math.hypot((s.lon - lon) * Math.cos((lat * Math.PI) / 180), s.lat - lat);
              const score = d / (1 + s.rank / 30); // a city wins over a village at a similar distance
              if (d < 0.12 && score < bestScore) [best, bestScore] = [s, score];
            }
        return best;
      };
      const sql = [
        '-- navWeather geocoder index (pipelines/osm/geocode.mjs). OpenStreetMap contributors, ODbL 1.0.',
        'DROP TABLE IF EXISTS geo_fts;',
        'DROP TABLE IF EXISTS geo;',
        'DROP TABLE IF EXISTS geo_meta;',
        'CREATE TABLE geo (rowid INTEGER PRIMARY KEY, id TEXT NOT NULL, kind TEXT NOT NULL, rank REAL NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, name TEXT NOT NULL, name_en TEXT NOT NULL, name_ru TEXT NOT NULL, ctx_en TEXT, ctx_ru TEXT);',
        "CREATE VIRTUAL TABLE geo_fts USING fts5(names, ctx, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4');",
        'CREATE TABLE geo_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);',
      ];
      const q = (s) => (s ? `'${String(s).replace(/'/g, "''")}'` : 'NULL');
      // D1 accepts statements up to 100 KB: flush by size, not by row count.
      const MAX_STATEMENT = 90_000;
      let batchGeo = [];
      let batchFts = [];
      let sizeGeo = 0;
      let sizeFts = 0;
      const flush = () => {
        if (batchGeo.length) sql.push(`INSERT INTO geo VALUES ${batchGeo.join(',')};`, `INSERT INTO geo_fts(rowid, names, ctx) VALUES ${batchFts.join(',')};`);
        batchGeo = [];
        batchFts = [];
        sizeGeo = 0;
        sizeFts = 0;
      };
      rows.forEach((r, i) => {
        const s = r.country || r.fixedCtx ? null : nearest(r.lon, r.lat);
        const ctx = r.fixedCtx ?? (r.country ? countryOf(r.lon, r.lat) : s ?? (r.city ? namesOf({ name: r.city }) : null));
        // A street or place counts more in a bigger town: Tbilisi's Rustaveli Avenue before a village's.
        const rank = r.rank + (s ? s.rank * (r.kind === 'street' ? 0.25 : 0.08) : 0);
        const rowid = i + 1;
        const g = `(${rowid},${q(r.id)},${q(r.kind)},${rank.toFixed(2)},${r.lat.toFixed(6)},${r.lon.toFixed(6)},${q(r.local)},${q(r.en)},${q(r.ru)},${q(ctx?.en)},${q(ctx?.ru)})`;
        const f = `(${rowid},${q(r.all)},${q(ctx ? [...new Set([ctx.local, ctx.en, ctx.ru])].join(' ') : '')})`;
        const [gb, fb] = [Buffer.byteLength(g), Buffer.byteLength(f)]; // the limit is in bytes (Georgian: 3 per letter)
        if (sizeGeo + gb > MAX_STATEMENT || sizeFts + fb > MAX_STATEMENT) flush();
        batchGeo.push(g);
        batchFts.push(f);
        sizeGeo += gb + 1;
        sizeFts += fb + 1;
      });
      flush();
      for (const [k, v] of Object.entries(meta)) sql.push(`INSERT INTO geo_meta VALUES (${q(k)}, ${q(v)});`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, sql.join('\n') + '\n');
      const kinds = {};
      for (const r of rows) kinds[r.kind === 'address' || r.kind === 'street' || PLACE_RANK[r.kind] !== undefined ? r.kind : 'place'] = (kinds[r.kind === 'address' || r.kind === 'street' || PLACE_RANK[r.kind] !== undefined ? r.kind : 'place'] ?? 0) + 1;
      return { rows: rows.length, kinds };
    },
  };
}
