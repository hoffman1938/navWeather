/**
 * `/api/v1/air` (DEVELOPMENT_PLAN DP-4.6, air quality): the European Air Quality Index at any point on land, hour by
 * hour for five days, from the CAMS global forecast (Copernicus, open licence) that `pipelines/air/build.mjs` turns
 * into tiles in R2. Platform-neutral: the pipeline computes the index with these functions, the Worker reads the
 * tiles with these definitions.
 *
 * Storage: one object per 4° × 4° tile of the 0.4° CAMS grid (land and coasts), 10 × 10 points, each point a record
 * of one byte per hour (the index, 0–250; 255 = no value) at a fixed offset — the Worker reads one record.
 */

export const AIR_GRID = { lat0: -90, lon0: -180, step: 0.4, rows: 451, cols: 900 } as const;
export const AIR_TILE = 10;
export const AIR_NONE = 255;
export const AIR_LATEST_KEY = 'air/latest.json';
export const airRunPrefix = (run: string) => `air/runs/${run}/`;
export const airTileKey = (run: string, ty: number, tx: number) => `${airRunPrefix(run)}t/${ty}/${tx}.bin`;
/** Older than this, the index isn't served (the client says so instead). */
export const AIR_MAX_AGE_H = 48;

export interface AirIndex {
  v: 1;
  run: string;
  createdAt: number;
  referenceTime: number;
  /** Hours (unix s), one byte each in every record. */
  times: number[];
  source: string;
  tiles: string[];
}

export function airCell(lat: number, lon: number) {
  const row = Math.min(AIR_GRID.rows - 1, Math.max(0, Math.round((lat - AIR_GRID.lat0) / AIR_GRID.step)));
  const col = (((Math.round((lon - AIR_GRID.lon0) / AIR_GRID.step) % AIR_GRID.cols) + AIR_GRID.cols) % AIR_GRID.cols);
  const ty = Math.floor(row / AIR_TILE);
  const tx = Math.floor(col / AIR_TILE);
  return { row, col, ty, tx, i: (row - ty * AIR_TILE) * AIR_TILE + (col - tx * AIR_TILE) };
}

/**
 * The European Air Quality Index bands (European Environment Agency, as CAMS and Open-Meteo use them): concentration
 * limits in µg/m³ for good, fair, moderate, poor, very poor, extremely poor. PM over 24 hours, gases hourly.
 */
export const EAQI_BANDS: Record<'pm2_5' | 'pm10' | 'no2' | 'o3' | 'so2', number[]> = {
  pm2_5: [0, 10, 20, 25, 50, 75, 800],
  pm10: [0, 20, 40, 50, 100, 150, 1200],
  no2: [0, 40, 90, 120, 230, 340, 1000],
  o3: [0, 50, 100, 130, 240, 380, 800],
  so2: [0, 100, 200, 350, 500, 750, 1250],
};

/** One pollutant's index: each band spans 20 points (good 0–20 … extremely poor 100+), linear inside it. */
export function subIndex(kind: keyof typeof EAQI_BANDS, c: number | null): number | null {
  if (c === null || !Number.isFinite(c) || c < 0) return null;
  const b = EAQI_BANDS[kind];
  for (let i = 0; i < b.length - 1; i++) {
    if (c < b[i + 1]) return 20 * i + (20 * (c - b[i])) / (b[i + 1] - b[i]);
  }
  return Math.min(250, 120 + ((c - b[b.length - 1]) / b[b.length - 1]) * 20);
}

/** The index is the worst pollutant's; unknown when none is known. */
export function europeanAqi(c: { pm2_5: number | null; pm10: number | null; no2: number | null; o3: number | null; so2: number | null }): number | null {
  let worst: number | null = null;
  for (const k of ['pm2_5', 'pm10', 'no2', 'o3', 'so2'] as const) {
    const s = subIndex(k, c[k]);
    if (s !== null && (worst === null || s > worst)) worst = s;
  }
  return worst === null ? null : Math.round(worst);
}

/** Mean of the last `hours` values (up to and including `i`), over the ones that exist. */
export function trailingMean(values: ArrayLike<number>, i: number, hours = 24): number | null {
  let sum = 0;
  let n = 0;
  for (let k = Math.max(0, i - hours + 1); k <= i; k++) {
    const v = values[k];
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}
