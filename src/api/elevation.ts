/**
 * `/api/v1/elevation` (DEVELOPMENT_PLAN DP-4.7): ground height at up to 100 points from Copernicus DEM GLO-90 (90 m),
 * built by `pipelines/elevation/build.mjs` into R2. Platform-neutral: the pipeline writes with these definitions,
 * the Worker reads with them. The answer is Open-Meteo-compatible: `{ elevation: [...] }`.
 *
 * One object per 1° × 1° tile (named by its south-west corner): a 20-byte header, an index of 10 × 10 blocks and the
 * blocks, each a deflate-raw stream of int16 metres, rows from south to north. The Worker reads the header and the one
 * block a point falls in (a few KB) with range requests. Columns per degree follow the DEM (1 200 up to 50°, fewer
 * towards the poles); the header says how many.
 */

export const ELEV_PREFIX = 'elev/v1';
export const ELEV_INDEX_KEY = `${ELEV_PREFIX}/index.json`;
export const ELEV_MISSING = -32768;
export const ELEV_MAGIC = 0x3145574e; // "NWE1", little-endian
export const ELEV_HEADER_BYTES = 20;
export const ELEV_BLOCKS = 10; // per side
export const ELEV_INDEX_BYTES = ELEV_BLOCKS * ELEV_BLOCKS * 8;
export const MAX_ELEVATION_POINTS = 100;

export const elevTileKey = (lat: number, lon: number) => `${ELEV_PREFIX}/${lat}/${lon}.bin`;

/** `elev/v1/index.json`: what has been built. */
export interface ElevationIndex {
  v: 1;
  source: string;
  builtAt: string;
  /** Tiles built ("lat/lon" of the south-west corner). */
  tiles: string[];
  /** Tiles looked at and found to be open sea (height 0 everywhere; no object). */
  sea: string[];
}

export interface TileHeader {
  rows: number;
  cols: number;
  blockRows: number;
  blockCols: number;
  lat: number;
  lon: number;
  /** Per block: byte offset in the object, compressed length (0 = no data). */
  offsets: Uint32Array;
  lengths: Uint32Array;
}

export function encodeHeader(h: Omit<TileHeader, 'offsets' | 'lengths'>, blocks: { offset: number; length: number }[]): Uint8Array {
  const buf = new ArrayBuffer(ELEV_HEADER_BYTES + ELEV_INDEX_BYTES);
  const d = new DataView(buf);
  d.setUint32(0, ELEV_MAGIC, true);
  d.setUint16(4, 1, true);
  d.setUint16(6, h.rows, true);
  d.setUint16(8, h.cols, true);
  d.setUint16(10, h.blockRows, true);
  d.setUint16(12, h.blockCols, true);
  d.setInt16(14, h.lat, true);
  d.setInt16(16, h.lon, true);
  blocks.forEach((b, i) => {
    d.setUint32(ELEV_HEADER_BYTES + i * 8, b.offset, true);
    d.setUint32(ELEV_HEADER_BYTES + i * 8 + 4, b.length, true);
  });
  return new Uint8Array(buf);
}

export function decodeHeader(bytes: ArrayBuffer): TileHeader | null {
  if (bytes.byteLength < ELEV_HEADER_BYTES + ELEV_INDEX_BYTES) return null;
  const d = new DataView(bytes);
  if (d.getUint32(0, true) !== ELEV_MAGIC || d.getUint16(4, true) !== 1) return null;
  const n = ELEV_BLOCKS * ELEV_BLOCKS;
  const offsets = new Uint32Array(n);
  const lengths = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    offsets[i] = d.getUint32(ELEV_HEADER_BYTES + i * 8, true);
    lengths[i] = d.getUint32(ELEV_HEADER_BYTES + i * 8 + 4, true);
  }
  return {
    rows: d.getUint16(6, true),
    cols: d.getUint16(8, true),
    blockRows: d.getUint16(10, true),
    blockCols: d.getUint16(12, true),
    lat: d.getInt16(14, true),
    lon: d.getInt16(16, true),
    offsets,
    lengths,
  };
}

/** The tile a point is in (south-west corner, whole degrees). */
export function elevTileOf(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.min(89, Math.floor(lat)), lon: Math.min(179, Math.floor(lon)) };
}

/** The cell of a point inside its tile, and the block that holds it (the DEM cell containing the point). */
export function cellOf(h: Pick<TileHeader, 'rows' | 'cols' | 'blockRows' | 'blockCols' | 'lat' | 'lon'>, lat: number, lon: number) {
  const row = Math.min(h.rows - 1, Math.max(0, Math.floor((lat - h.lat) * h.rows)));
  const col = Math.min(h.cols - 1, Math.max(0, Math.floor((lon - h.lon) * h.cols)));
  const br = Math.floor(row / h.blockRows);
  const bc = Math.floor(col / h.blockCols);
  return { block: br * ELEV_BLOCKS + bc, i: (row - br * h.blockRows) * h.blockCols + (col - bc * h.blockCols) };
}

/** What we know about the tile of a point: built, open sea, or nothing (another area — ask elsewhere). */
export function tileStatus(index: { tiles: Set<string>; sea: Set<string> }, lat: number, lon: number): 'land' | 'sea' | 'unknown' {
  const t = elevTileOf(lat, lon);
  const k = `${t.lat}/${t.lon}`;
  return index.tiles.has(k) ? 'land' : index.sea.has(k) ? 'sea' : 'unknown';
}

/** The query (Open-Meteo's): `latitude=a,b&longitude=c,d`; a string is the error. */
export function parseElevationQuery(p: URLSearchParams): { lat: number; lon: number }[] | string {
  const num = (s: string | null) => (s === null || s === '' ? [] : s.split(',').map((x) => (x.trim() === '' ? NaN : Number(x))));
  const lats = num(p.get('latitude'));
  const lons = num(p.get('longitude'));
  if (!lats.length || lats.length !== lons.length) return 'latitude and longitude must be lists of the same length';
  if (lats.length > MAX_ELEVATION_POINTS) return `at most ${MAX_ELEVATION_POINTS} points`;
  if (lats.some((v) => !(v >= -90 && v <= 90)) || lons.some((v) => !(v >= -180 && v <= 180))) return 'coordinates out of range';
  return lats.map((lat, i) => ({ lat, lon: lons[i] }));
}
