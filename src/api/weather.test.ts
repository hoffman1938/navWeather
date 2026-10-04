import { describe, expect, it } from 'vitest';
import {
  apparentTemperature,
  gridCell,
  hoursFor,
  MISSING,
  parseForecastQuery,
  planHours,
  pointForecast,
  recordValues,
  tileReads,
  VARS,
  weatherCode,
  type VarKey,
  type WeatherIndex,
} from './weather';

/** Our forecast format and how a point's steps become Open-Meteo's hours (DP-4.6, DP-6.6). */

const H = 3600;
const T0 = Date.UTC(2026, 9, 4, 12) / 1000;
// 3-hourly, then 6-hourly — as the model gives it.
const times = [T0, T0 + 3 * H, T0 + 6 * H, T0 + 12 * H];
const vars = VARS.map((v) => v.key);
const interval = (k: VarKey) => VARS.find((v) => v.key === k)!.interval;
const index: WeatherIndex = {
  v: 1,
  run: 'test',
  createdAt: T0 + 7 * H,
  referenceTime: T0,
  models: {},
  source: 'test',
  tile: 20,
  vars,
  scales: VARS.map((v) => v.scale),
  times,
  // Sums and maxima start with the first step after the run's start.
  cover: vars.map((k) => (interval(k) ? [0, 3, 3, 6] : [1, 1, 1, 1])),
  tiles: ['0/0'],
};

/** A point's record from plain values (null = no value). */
function record(elev: number, values: Partial<Record<VarKey, (number | null)[]>>): Int16Array {
  const S = times.length;
  const rec = new Int16Array(recordValues(index)).fill(MISSING);
  rec[0] = elev;
  VARS.forEach((v, j) => (values[v.key] ?? []).forEach((x, k) => x !== null && (rec[1 + j * S + k] = Math.round(x * v.scale))));
  return rec;
}

const rec = record(700, {
  t2m: [10, 13, 16, 10],
  rh: [80, 80, 80, 80],
  cloud: [0, 50, 90, 100],
  precip: [null, 3, 0, 6],
  swe: [null, 0, 0, 6],
  u10: [-3, -3, -3, -3],
  v10: [-4, -4, -4, -4],
  gust: [null, 10, 12, 8],
  cape: [0, 0, 0, 0],
  ptype: [0, 1, 0, 5],
  vis: [24000, 24000, 500, 24000],
});

describe('the weather grid', () => {
  it('finds the nearest 0.25° cell, its tile and its place in the tile', () => {
    expect(gridCell(41.6935, 44.8015)).toEqual({ row: 527, col: 899, lat: 41.75, lon: 44.75, ty: 26, tx: 44, i: 159 });
    expect(gridCell(-90, -180)).toMatchObject({ row: 0, col: 0, i: 0 });
    expect(gridCell(10, 180)).toMatchObject({ col: 0, lon: -180 }); // the date line wraps
    expect(gridCell(10, 179.9)).toMatchObject({ col: 0 });
  });

  it('reads neighbouring records of a tile together, far ones apart', () => {
    expect(tileReads([50, 1, 0, 399, 1], 2000)).toEqual([
      { offset: 0, length: 4000, points: [0, 1] },
      { offset: 100_000, length: 2000, points: [50] },
      { offset: 798_000, length: 2000, points: [399] },
    ]);
    expect(tileReads([0, 7], 2000)).toEqual([{ offset: 0, length: 16_000, points: [0, 7] }]);
  });
});

describe('the forecast query (Open-Meteo-compatible)', () => {
  const q = (s: string) => parseForecastQuery(new URLSearchParams(s));

  it('reads what the app sends', () => {
    expect(q('latitude=41.69,42&longitude=44.8,43&hourly=temperature_2m,weather_code&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh&past_hours=3&forecast_hours=48&elevation=nan,1500')).toEqual({
      points: [
        { lat: 41.69, lon: 44.8 },
        { lat: 42, lon: 43, elevation: 1500 },
      ],
      hourly: ['temperature_2m', 'weather_code'],
      pastHours: 3,
      forecastHours: 48,
      windUnit: 'kmh',
    });
  });

  it('refuses what it cannot answer honestly', () => {
    expect(q('latitude=1&longitude=1,2')).toMatch(/same length/);
    expect(q('latitude=91&longitude=1')).toMatch(/range/);
    expect(q('latitude=x&longitude=1')).toMatch(/range/);
    expect(q(`latitude=${Array(101).fill(1)}&longitude=${Array(101).fill(1)}`)).toMatch(/at most/);
    expect(q('latitude=1&longitude=1&timeformat=iso8601')).toMatch(/unixtime/);
    expect(q('latitude=1&longitude=1&timezone=Europe/Paris')).toMatch(/timezone/);
    expect(q('latitude=1&longitude=1&hourly=uv_index')).toMatch(/uv_index/);
    expect(q('latitude=1&longitude=1&forecast_hours=1000')).toMatch(/forecast_hours/);
    expect(q('latitude=1&longitude=1&elevation=1,2')).toMatch(/elevation/);
  });
});

describe('from model steps to hours', () => {
  const plan = planHours(index, hoursFor(index, T0 + 30 * 60, 0, 13));
  const all = parseForecastQuery(new URLSearchParams('latitude=1&longitude=1')) as Exclude<ReturnType<typeof parseForecastQuery>, string>;
  const f = pointForecast(index, rec, plan, { hourly: all.hourly, windUnit: 'kmh' });
  const at = (key: string, hour: number) => f.hourly[key][plan.hours.indexOf(T0 + hour * H)];

  it('answers whole hours from the current one, never past the last step', () => {
    expect(plan.hours[0]).toBe(T0);
    expect(plan.hours.at(-1)).toBe(T0 + 12 * H);
    expect(hoursFor(index, T0 + 5 * H, 2, 3)).toEqual([T0 + 3 * H, T0 + 4 * H, T0 + 5 * H, T0 + 6 * H, T0 + 7 * H]);
    expect(f.hourly.time).toEqual(plan.hours);
  });

  it('values at a step are interpolated in time; sums are spread over their hours', () => {
    expect(at('temperature_2m', 1)).toBe(11);
    expect(at('temperature_2m', 7)).toBe(15); // between 16 (+6 h) and 10 (+12 h)
    expect(at('precipitation', 0)).toBeNull(); // nothing is known about the hour before the run
    expect([1, 2, 3].map((h) => at('precipitation', h))).toEqual([1, 1, 1]); // 3 mm in 3 h
    expect(at('precipitation', 5)).toBe(0);
    expect(at('precipitation', 9)).toBe(1); // 6 mm in 6 h
    expect(at('snowfall', 9)).toBe(0.7); // 1 mm of water ≈ 0.7 cm of snow
    expect(at('rain', 9)).toBe(0);
    expect(at('rain', 2)).toBe(1);
    expect(at('showers', 2)).toBe(0);
    expect(at('precipitation_probability', 2)).toBeNull(); // a single model run gives no probability
  });

  it('wind from its components; gusts are the strongest of their interval, never below the wind', () => {
    expect(at('wind_speed_10m', 4)).toBe(18); // 5 m/s
    expect(at('wind_direction_10m', 4)).toBe(37); // blowing towards the south-west = from the north-east
    expect(at('wind_gusts_10m', 2)).toBe(36);
    expect(at('wind_gusts_10m', 4)).toBe(43.2);
  });

  it('derives the weather code: snow, fog, clouds', () => {
    expect(at('weather_code', 0)).toBe(0); // clear
    expect(at('weather_code', 2)).toBe(61); // 1 mm/h of rain
    expect(at('weather_code', 6)).toBe(45); // dry, 500 m visibility
    expect(at('weather_code', 9)).toBe(73); // 0.7 cm/h of snow
  });

  it('feels-like from temperature, humidity and wind', () => {
    expect(at('apparent_temperature', 0)).toBe(5.7);
    expect(apparentTemperature(30, 70, 0)).toBeCloseTo(35.8, 1); // humid heat feels hotter
  });

  it('a point higher than its grid cell is colder (lapse rate) — the forecast states the height it is for', () => {
    expect(f.elevation).toBe(700);
    const low = pointForecast(index, rec, plan, { hourly: ['temperature_2m'], windUnit: 'ms', elevation: 400 });
    expect(low.elevation).toBe(400);
    expect(low.hourly.temperature_2m[0]).toBe(12); // 10 °C + 300 m × 6.5 °C/km
  });

  it('a missing value stays missing', () => {
    const holes = record(MISSING, { t2m: [10, null, 16, 10] });
    const g = pointForecast(index, holes, plan, { hourly: ['temperature_2m', 'wind_speed_10m'], windUnit: 'kmh' });
    expect(g.hourly.temperature_2m.slice(0, 4)).toEqual([10, null, null, null]);
    expect(g.hourly.temperature_2m[6]).toBe(16);
    expect(g.hourly.wind_speed_10m.every((v) => v === null)).toBe(true);
    expect(g.elevation).toBeUndefined();
  });
});

describe('the derived weather code (WEATHER_ENGINE §6: a derived estimate)', () => {
  const none = { precip: 0, swe: 0, ptype: 0, cape: 0, cloud: 0, vis: 24000, t2m: 10 };
  it.each([
    [{ precip: 3, cape: 3500 }, 95],
    [{ precip: 3, cape: 1600 }, 95],
    [{ precip: 1, cape: 1600 }, 61],
    [{ precip: 3, ptype: 3, t2m: -1 }, 67],
    [{ precip: 1, ptype: 3, t2m: -1 }, 66],
    [{ precip: 0.3, ptype: 12, t2m: -1 }, 56],
    [{ precip: 2, swe: 2, ptype: 5 }, 75],
    [{ precip: 0.2, swe: 0.2, ptype: 5 }, 71],
    [{ precip: 1, ptype: 8 }, 77],
    [{ precip: 8 }, 65],
    [{ precip: 3 }, 63],
    [{ vis: 400, t2m: -2 }, 48],
    [{ cloud: 90 }, 3],
    [{ cloud: 60 }, 2],
    [{ cloud: 20 }, 1],
    [{ cloud: null, precip: null }, null],
  ])('%j → %s', (h, code) => expect(weatherCode({ ...none, ...h })).toBe(code));
});
