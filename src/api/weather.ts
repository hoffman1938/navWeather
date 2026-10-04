/**
 * `/api/v1/weather/forecast` and `/api/v1/weather/meta` (DEVELOPMENT_PLAN DP-4.6, DP-6.6): our forecast for any
 * point on Earth, from open model data the weather pipeline (`pipelines/weather/build.mjs`) turns into tiles in R2.
 * Platform-neutral: the pipeline writes with these definitions, the Worker reads with them, the tests check them.
 *
 * Sources: ECMWF IFS 0.25° (CC BY 4.0) for everything but visibility, NOAA GFS 0.25° (public domain) for visibility,
 * both read from the Open-Meteo open-data archive on AWS (CC BY 4.0). The answer is Open-Meteo-compatible (the same
 * query and the same JSON), so the app's Open-Meteo reader serves both.
 *
 * Storage: one object per 5° × 5° tile of the 0.25° grid (land and its coasts only), point after point; every point
 * is a record of int16: the grid cell's height, then each variable at every forecast step. A point's record sits at
 * a fixed offset, so the Worker reads exactly that record with a range request.
 */

export const GRID = { lat0: -90, lon0: -180, step: 0.25, rows: 721, cols: 1440 } as const;
/** Grid cells per tile side (5°). */
export const TILE = 20;
export const MISSING = -32768;
export const MAX_LOCATIONS = 100;
/** Older than this (from the model run's start), our forecast is not served: the app uses its fallback. */
export const MAX_RUN_AGE_H = 36;

/**
 * Stored variables in record order; stored value = round(value × scale). `interval` variables describe the time
 * between the previous step and this one (sums, maxima); the others are values at the step's time.
 */
export const VARS = [
  { key: 't2m', scale: 10, interval: false }, // °C
  { key: 'rh', scale: 1, interval: false }, // %
  { key: 'cloud', scale: 1, interval: false }, // %
  { key: 'precip', scale: 10, interval: true }, // mm in the interval
  { key: 'swe', scale: 10, interval: true }, // snowfall, mm of water in the interval
  { key: 'u10', scale: 10, interval: false }, // m/s
  { key: 'v10', scale: 10, interval: false }, // m/s
  { key: 'gust', scale: 10, interval: true }, // m/s, strongest in the interval
  { key: 'cape', scale: 0.1, interval: false }, // J/kg
  { key: 'ptype', scale: 1, interval: false }, // ECMWF precipitation type (1 rain, 3 freezing rain, 5 snow, …)
  { key: 'vis', scale: 0.1, interval: false }, // m (GFS)
] as const;
export type VarKey = (typeof VARS)[number]['key'];

/** The Open-Meteo hourly variables we answer. */
export const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'visibility',
  'relative_humidity_2m',
] as const;
export type HourlyKey = (typeof HOURLY)[number];

export const HOURLY_UNITS: Record<HourlyKey, string> = {
  temperature_2m: '°C',
  apparent_temperature: '°C',
  precipitation_probability: '%',
  precipitation: 'mm',
  rain: 'mm',
  showers: 'mm',
  snowfall: 'cm',
  weather_code: 'wmo code',
  cloud_cover: '%',
  wind_speed_10m: 'km/h',
  wind_gusts_10m: 'km/h',
  wind_direction_10m: '°',
  visibility: 'm',
  relative_humidity_2m: '%',
};

/** `weather/latest.json` and `weather/runs/<run>/index.json`. */
export interface WeatherIndex {
  v: 1;
  run: string;
  /** When our data became available (unix s). */
  createdAt: number;
  /** Start of the newest model run used (unix s). */
  referenceTime: number;
  /** Model → run start times used (ISO). */
  models: Record<string, string[]>;
  source: string;
  tile: number;
  vars: VarKey[];
  scales: number[];
  /** Forecast steps (unix s, ascending). */
  times: number[];
  /**
   * Per variable and step: hours the value covers ending at the step (interval variables), 1 for a value at the
   * step, 0 for no value at that step.
   */
  cover: number[][];
  /** Tiles present, "ty/tx". */
  tiles: string[];
}

export const runPrefix = (run: string) => `weather/runs/${run}/`;
export const tileKey = (run: string, ty: number, tx: number) => `${runPrefix(run)}t/${ty}/${tx}.bin`;
export const LATEST_KEY = 'weather/latest.json';

export const recordValues = (index: Pick<WeatherIndex, 'vars' | 'times'>) => 1 + index.vars.length * index.times.length;
export const recordBytes = (index: Pick<WeatherIndex, 'vars' | 'times'>) => 2 * recordValues(index);

/** The grid cell nearest to a point. */
export function gridCell(lat: number, lon: number) {
  const row = Math.min(GRID.rows - 1, Math.max(0, Math.round((lat - GRID.lat0) / GRID.step)));
  const col = (((Math.round((lon - GRID.lon0) / GRID.step) % GRID.cols) + GRID.cols) % GRID.cols);
  const ty = Math.floor(row / TILE);
  const tx = Math.floor(col / TILE);
  return {
    row,
    col,
    lat: GRID.lat0 + row * GRID.step,
    lon: GRID.lon0 + col * GRID.step,
    ty,
    tx,
    /** Point index inside its tile (row-major). */
    i: (row - ty * TILE) * TILE + (col - tx * TILE),
  };
}

// ---- the query ----

export interface ForecastQuery {
  points: { lat: number; lon: number; elevation?: number }[];
  hourly: HourlyKey[];
  pastHours: number;
  forecastHours: number;
  windUnit: 'kmh' | 'ms';
}

const numbers = (s: string | null) => (s === null ? [] : s.split(',').map((x) => (x.trim() === '' ? NaN : Number(x))));

/** Open-Meteo's query, as far as we answer it; a string is the error. */
export function parseForecastQuery(p: URLSearchParams): ForecastQuery | string {
  const lats = numbers(p.get('latitude'));
  const lons = numbers(p.get('longitude'));
  if (!lats.length || lats.length !== lons.length) return 'latitude and longitude must be lists of the same length';
  if (lats.length > MAX_LOCATIONS) return `at most ${MAX_LOCATIONS} locations`;
  if (lats.some((v) => !(v >= -90 && v <= 90)) || lons.some((v) => !(v >= -180 && v <= 180))) return 'coordinates out of range';
  const elev = numbers(p.get('elevation'));
  if (elev.length && (elev.length !== lats.length || elev.some((v) => !Number.isFinite(v) && !Number.isNaN(v)))) return 'elevation must match the locations';
  const tf = p.get('timeformat') ?? 'unixtime';
  if (tf !== 'unixtime') return 'only timeformat=unixtime is supported';
  const tz = p.get('timezone');
  if (tz !== null && tz !== 'auto' && tz !== 'GMT' && tz !== 'UTC') return 'only timezone=auto is supported';
  const wind = p.get('wind_speed_unit') ?? p.get('windspeed_unit') ?? 'kmh';
  if (wind !== 'kmh' && wind !== 'ms') return 'wind_speed_unit must be kmh or ms';
  const asked = (p.get('hourly') ?? HOURLY.join(',')).split(',').filter(Boolean);
  const unknown = asked.filter((h) => !(HOURLY as readonly string[]).includes(h));
  if (unknown.length) return `unsupported hourly variables: ${unknown.join(',')}`;
  const int = (k: string, d: number, max: number) => {
    const v = p.get(k);
    const n = v === null ? d : Number(v);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN;
  };
  const pastHours = int('past_hours', 0, 92 * 24);
  const forecastHours = int('forecast_hours', 7 * 24, 16 * 24);
  if (Number.isNaN(pastHours) || Number.isNaN(forecastHours)) return 'past_hours and forecast_hours must be small whole numbers';
  return {
    points: lats.map((lat, i) => ({ lat, lon: lons[i], ...(elev.length && Number.isFinite(elev[i]) ? { elevation: elev[i] } : {}) })),
    hourly: asked as HourlyKey[],
    pastHours,
    forecastHours,
    windUnit: wind,
  };
}

// ---- from steps to hours ----

/** How each variable is read for each hour: two steps to interpolate between, or the step whose interval holds it. */
export interface HourPlan {
  hours: number[];
  /** Per variable, per hour: [a, b, weight of b] (values at steps) or [k, -1, hours covered] (interval values). */
  at: Int32Array[];
  w: Float32Array[];
}

/** The hours (unix s) we answer: `pastHours` before the current hour to `forecastHours` after it, inside our data. */
export function hoursFor(index: Pick<WeatherIndex, 'times'>, nowS: number, pastHours: number, forecastHours: number): number[] {
  const now = Math.floor(nowS / 3600) * 3600;
  const first = Math.max(now - pastHours * 3600, Math.ceil(index.times[0] / 3600) * 3600);
  const last = Math.min(now + (forecastHours - 1) * 3600, index.times[index.times.length - 1]);
  const out: number[] = [];
  for (let h = first; h <= last; h += 3600) out.push(h);
  return out;
}

export function planHours(index: Pick<WeatherIndex, 'times' | 'cover' | 'vars'>, hours: number[]): HourPlan {
  const { times } = index;
  const at: Int32Array[] = [];
  const w: Float32Array[] = [];
  index.vars.forEach((key, j) => {
    const cover = index.cover[j];
    const interval = VARS.find((v) => v.key === key)!.interval;
    const a = new Int32Array(hours.length * 2).fill(-1);
    const wt = new Float32Array(hours.length);
    hours.forEach((h, n) => {
      if (interval) {
        // The first step at or after the hour whose interval holds the whole hour before it.
        for (let k = 0; k < times.length; k++) {
          if (!cover[k] || times[k] < h) continue;
          if (times[k] - cover[k] * 3600 <= h - 3600) {
            a[n * 2] = k;
            wt[n] = cover[k];
          }
          break;
        }
        return;
      }
      let lo = -1;
      let hi = -1;
      for (let k = 0; k < times.length; k++) {
        if (!cover[k]) continue;
        if (times[k] <= h) lo = k;
        if (times[k] >= h) {
          hi = k;
          break;
        }
      }
      if (lo < 0 || hi < 0) return;
      a[n * 2] = lo;
      a[n * 2 + 1] = hi;
      wt[n] = hi === lo ? 0 : (h - times[lo]) / (times[hi] - times[lo]);
    });
    at.push(a);
    w.push(wt);
  });
  return { hours, at, w };
}

/** Values of one variable for every planned hour, from a point's record (null where there is no value). */
function series(index: Pick<WeatherIndex, 'times' | 'vars' | 'scales'>, rec: Int16Array, plan: HourPlan, key: VarKey, perHour: boolean): (number | null)[] {
  const j = index.vars.indexOf(key);
  if (j < 0) return plan.hours.map(() => null);
  const S = index.times.length;
  const base = 1 + j * S;
  const scale = index.scales[j];
  const a = plan.at[j];
  const w = plan.w[j];
  const interval = VARS.find((v) => v.key === key)!.interval;
  const categorical = key === 'ptype';
  return plan.hours.map((_, n) => {
    const k0 = a[n * 2];
    if (k0 < 0) return null;
    const v0 = rec[base + k0];
    if (v0 === MISSING) return null;
    if (interval) return perHour ? v0 / scale / w[n] : v0 / scale;
    const k1 = a[n * 2 + 1];
    const v1 = rec[base + k1];
    if (v1 === MISSING) return w[n] === 0 ? v0 / scale : null;
    if (categorical) return (w[n] < 0.5 ? v0 : v1) / scale;
    return (v0 + (v1 - v0) * w[n]) / scale;
  });
}

const round = (v: number | null, d: number) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Apparent temperature (Steadman, without sunshine), as Open-Meteo derives it. Wind in m/s at 10 m. */
export function apparentTemperature(t: number, rh: number, windMs: number): number {
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
  return t + 0.33 * e - 0.7 * windMs - 4;
}

/**
 * WMO weather code derived from the model's fields (a derived estimate, WEATHER_ENGINE §6): thunderstorm from
 * instability with rain, freezing rain and snow from the model's precipitation type and snowfall, rain by intensity,
 * fog from visibility, otherwise clouds. Hourly amounts in mm (precipitation, snow as water).
 */
export function weatherCode(h: { precip: number | null; swe: number | null; ptype: number | null; cape: number | null; cloud: number | null; vis: number | null; t2m: number | null }): number | null {
  const p = h.precip;
  if (p !== null && p >= 0.1) {
    const cape = h.cape ?? 0;
    if ((cape >= 3000 && p >= 0.1) || (cape >= 1500 && p >= 2.5)) return 95;
    if (h.ptype === 3) return p >= 2.5 ? 67 : 66;
    if (h.ptype === 12) return p >= 0.5 ? 57 : 56;
    const snowShare = h.swe !== null ? h.swe / p : h.ptype === 5 || h.ptype === 6 ? 1 : 0;
    if (snowShare >= 0.5) {
      const cm = (h.swe ?? p) * 0.7;
      return cm >= 0.8 ? 75 : cm >= 0.2 ? 73 : 71;
    }
    if (h.ptype === 8) return 77;
    return p >= 7.6 ? 65 : p >= 2.5 ? 63 : 61;
  }
  if (h.vis !== null && h.vis < 1000) return h.t2m !== null && h.t2m < 0 ? 48 : 45;
  if (h.cloud === null) return null;
  return h.cloud >= 85 ? 3 : h.cloud >= 50 ? 2 : h.cloud >= 15 ? 1 : 0;
}

/** Temperature change per metre of height (standard atmosphere), for a point higher or lower than its grid cell. */
const LAPSE_K_PER_M = 0.0065;

/** One location of the answer, in Open-Meteo's shape. */
export function pointForecast(
  index: Pick<WeatherIndex, 'times' | 'vars' | 'scales'>,
  rec: Int16Array,
  plan: HourPlan,
  q: Pick<ForecastQuery, 'hourly' | 'windUnit'> & { elevation?: number },
): { elevation?: number; hourly: Record<string, (number | null)[]> } {
  const s = (key: VarKey, perHour = false) => series(index, rec, plan, key, perHour);
  const gridElev = rec[0] === MISSING ? null : rec[0];
  const dT = q.elevation !== undefined && gridElev !== null ? (gridElev - q.elevation) * LAPSE_K_PER_M : 0;
  const t2m = s('t2m').map((t) => (t === null ? null : t + dT));
  const rh = s('rh');
  const cloud = s('cloud');
  const precip = s('precip', true);
  const swe = s('swe', true);
  const u = s('u10');
  const v = s('v10');
  const gust = s('gust');
  const cape = s('cape');
  const ptype = s('ptype');
  const vis = s('vis');
  const n = plan.hours.length;
  const windMs = u.map((x, i) => (x === null || v[i] === null ? null : Math.hypot(x, v[i]!)));
  const k = q.windUnit === 'kmh' ? 3.6 : 1;
  const all: Record<HourlyKey, () => (number | null)[]> = {
    temperature_2m: () => t2m.map((x) => round(x, 1)),
    apparent_temperature: () => t2m.map((t, i) => (t === null || rh[i] === null || windMs[i] === null ? null : round(apparentTemperature(t, rh[i]!, windMs[i]!), 1))),
    // A deterministic model gives no probability: unknown, never invented.
    precipitation_probability: () => new Array(n).fill(null),
    precipitation: () => precip.map((x) => round(x, 1)),
    rain: () => precip.map((x, i) => (x === null ? null : round(Math.max(0, x - (swe[i] ?? 0)), 1))),
    showers: () => precip.map((x) => (x === null ? null : 0)),
    snowfall: () => swe.map((x) => round(x === null ? null : x * 0.7, 2)),
    weather_code: () =>
      plan.hours.map((_, i) => weatherCode({ precip: precip[i], swe: swe[i], ptype: ptype[i], cape: cape[i], cloud: cloud[i], vis: vis[i], t2m: t2m[i] })),
    cloud_cover: () => cloud.map((x) => round(x, 0)),
    wind_speed_10m: () => windMs.map((x) => round(x === null ? null : x * k, 1)),
    wind_gusts_10m: () => gust.map((x, i) => (x === null ? null : round(Math.max(x, windMs[i] ?? 0) * k, 1))),
    wind_direction_10m: () => u.map((x, i) => (x === null || v[i] === null ? null : round(((Math.atan2(-x, -v[i]!) * 180) / Math.PI + 360) % 360, 0))),
    visibility: () => vis.map((x) => round(x, 0)),
    relative_humidity_2m: () => rh.map((x) => round(x, 0)),
  };
  const hourly: Record<string, (number | null)[]> = { time: plan.hours };
  for (const key of q.hourly) hourly[key] = all[key]();
  return { ...(q.elevation !== undefined ? { elevation: q.elevation } : gridElev !== null ? { elevation: gridElev } : {}), hourly };
}

/** Byte ranges to read from one tile for these point indexes: neighbours share a read when the gap is small. */
export function tileReads(points: number[], recBytes: number, maxGapBytes = 16_384, maxSpanBytes = 262_144): { offset: number; length: number; points: number[] }[] {
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const out: { offset: number; length: number; points: number[] }[] = [];
  for (const p of sorted) {
    const start = p * recBytes;
    const cur = out[out.length - 1];
    if (cur && start - (cur.offset + cur.length) <= maxGapBytes && start + recBytes - cur.offset <= maxSpanBytes) {
      cur.length = start + recBytes - cur.offset;
      cur.points.push(p);
    } else out.push({ offset: start, length: recBytes, points: [p] });
  }
  return out;
}
