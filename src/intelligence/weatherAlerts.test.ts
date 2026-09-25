import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import type { RouteWeatherPoint, WeatherAtTime, WeatherCondition } from '../types/weather';
import { buildWeatherEvents, defaultWeatherAlertPrefs, type WeatherAlertPrefs } from './weatherAlerts';

const T0 = Date.UTC(2026, 8, 26, 4, 0);
const units = { distance: 'metric', temperature: 'c', wind: 'kmh' } as const;

export interface Spec {
  km: number;
  min: number;
  cond: WeatherCondition;
  temp?: number;
  prob?: number;
  precip?: number;
  gusts?: number;
  vis?: number;
  name?: string;
  lead?: number;
}

export function wpts(specs: Spec[]): RouteWeatherPoint[] {
  return specs.map((s, i) => {
    const w: WeatherAtTime = {
      condition: s.cond,
      temperature: s.temp ?? 18,
      precipitationProbability: s.prob ?? (['RAIN', 'HEAVY_RAIN', 'SNOW', 'SLEET', 'THUNDERSTORM'].includes(s.cond) ? 70 : 5),
      precipitation: s.precip ?? 0,
      windGusts: s.gusts ?? 20,
      windSpeed: (s.gusts ?? 20) / 2,
      visibility: s.vis ?? 20000,
      isDay: true,
      forecastHourUtc: 0,
    };
    return {
      id: `p${i}`,
      latitude: 42,
      longitude: 44 - s.km / 100,
      distanceFromStartKm: s.km,
      estimatedTravelMinutes: s.min,
      estimatedArrivalUtc: '',
      arrivalMs: T0 + s.min * 60000,
      localTime: '',
      timezone: 'Asia/Tbilisi',
      placeName: s.name,
      placeRelation: s.name ? 'in' : undefined,
      weather: w,
      forecastLeadHours: s.lead ?? s.min / 60,
      confidence: 'high',
      status: 'upcoming',
      reasons: [],
    };
  });
}

function events(specs: Spec[], opts: { current?: Spec; prefs?: WeatherAlertPrefs } = {}) {
  return buildWeatherEvents({
    points: wpts(specs),
    current: opts.current ? { ...wpts([opts.current])[0], id: 'current' } : null,
    progressM: 0,
    referenceMs: T0,
    prefs: opts.prefs ?? defaultWeatherAlertPrefs,
    m: en,
    units,
  });
}

const dry = (km: number, min: number, extra: Partial<Spec> = {}): Spec => ({ km, min, cond: 'CLOUDY', ...extra });

describe('WeatherAlertEngine', () => {
  it('clear weather → no events', () => {
    expect(events([dry(0, 0), dry(50, 40), dry(100, 80, { cond: 'CLEAR' })])).toEqual([]);
  });

  it('one rain event per stretch, not one per sample', () => {
    const e = events([
      dry(0, 0),
      { km: 40, min: 30, cond: 'RAIN', name: 'Khashuri' },
      { km: 55, min: 42, cond: 'RAIN' },
      { km: 70, min: 55, cond: 'RAIN' },
      dry(120, 95),
    ]);
    expect(e.map((x) => x.type)).toEqual(['RAIN_AHEAD']);
    expect(e[0].voiceMessage).toBe('Rain is likely in about 30 minutes, near Khashuri.');
    expect(e[0].severity).toBe('medium');
    expect(e[0].id).toBe('RAIN_AHEAD@p1');
  });

  it('bridges a short dry blip instead of starting rain twice', () => {
    const e = events([dry(0, 0), { km: 40, min: 30, cond: 'RAIN' }, dry(55, 42), { km: 70, min: 55, cond: 'RAIN' }]);
    expect(e.filter((x) => x.type === 'RAIN_AHEAD')).toHaveLength(1);
  });

  it('heavy rain is one high-severity event that subsumes plain rain', () => {
    const e = events([
      dry(0, 0),
      { km: 40, min: 32, cond: 'RAIN', precip: 5 },
      { km: 55, min: 42, cond: 'RAIN', precip: 6 },
      { km: 70, min: 55, cond: 'RAIN', precip: 4.5 },
    ]);
    expect(e.map((x) => x.type)).toEqual(['HEAVY_RAIN_AHEAD']);
    expect(e[0].severity).toBe('high');
    expect(e[0].voiceMessage).toMatch(/^Heavy rain is expected in about 30 minutes/);
  });

  it('snow near freezing → snow and icy warnings, once each', () => {
    const e = events([
      dry(0, 0, { temp: 3 }),
      { km: 40, min: 30, cond: 'SNOW', temp: 0 },
      { km: 55, min: 42, cond: 'SNOW', temp: -1 },
      { km: 70, min: 55, cond: 'SNOW', temp: -1 },
    ]);
    expect(e.map((x) => x.type).sort()).toEqual(['FREEZING_AHEAD', 'SNOW_AHEAD']);
  });

  it('fog, and very low visibility replacing it', () => {
    expect(events([dry(0, 0), { km: 30, min: 25, cond: 'FOG', vis: 600 }]).map((x) => x.type)).toEqual(['FOG_AHEAD']);
    const e = events([dry(0, 0), { km: 30, min: 25, cond: 'FOG', vis: 150 }]);
    expect(e.map((x) => x.type)).toEqual(['LOW_VISIBILITY_AHEAD']);
    expect(e[0].severity).toBe('high');
  });

  it('gusts alternating around 60 km/h raise ONE wind event (hysteresis)', () => {
    const e = events([
      dry(0, 0),
      dry(20, 15, { gusts: 61 }),
      dry(40, 30, { gusts: 59 }),
      dry(60, 45, { gusts: 62 }),
      dry(80, 60, { gusts: 58 }),
      dry(100, 75, { gusts: 30 }),
    ]);
    expect(e.filter((x) => x.type === 'STRONG_WIND_AHEAD')).toHaveLength(1);
  });

  it('temperature drop is reported once (latched), relative to now', () => {
    const e = events(
      [dry(0, 0, { temp: 20 }), dry(50, 40, { temp: 13 }), dry(100, 80, { temp: 12 }), dry(150, 120, { temp: 11 })],
      { current: dry(0, 0, { temp: 20 }) },
    );
    const drops = e.filter((x) => x.type === 'TEMPERATURE_DROP_AHEAD');
    expect(drops).toHaveLength(1);
    expect(drops[0].voiceMessage).toBe('The temperature is expected to drop about 7 degrees in about 40 minutes.');
  });

  it('rain already falling at the vehicle is not "ahead"; clearing is reported instead', () => {
    const e = events(
      [{ km: 0, min: 0, cond: 'RAIN' }, { km: 30, min: 25, cond: 'RAIN' }, dry(60, 45), dry(90, 70)],
      { current: { km: 0, min: 0, cond: 'RAIN' } },
    );
    expect(e.map((x) => x.type)).toEqual(['WEATHER_CLEARING']);
    expect(e[0].severity).toBe('low');
  });

  it('caps severity for low-confidence, far-future forecasts', () => {
    const e = events([dry(0, 0), { km: 600, min: 3000, cond: 'HEAVY_RAIN', prob: 30, lead: 80 }]);
    expect(e[0].type).toBe('HEAVY_RAIN_AHEAD');
    expect(e[0].severity).toBe('low');
    expect(e[0].confidence).toBeLessThan(0.35);
  });

  it('respects alert settings (severe only, types off)', () => {
    const specs: Spec[] = [dry(0, 0), { km: 40, min: 30, cond: 'RAIN' }, dry(80, 60, { gusts: 85 })];
    expect(
      events(specs, { prefs: { ...defaultWeatherAlertPrefs, level: 'severe' } }).map((x) => x.type),
    ).toEqual(['STRONG_WIND_AHEAD']);
    expect(
      events(specs, { prefs: { level: 'all', types: { ...defaultWeatherAlertPrefs.types, rain: false } } }).map((x) => x.type),
    ).toEqual(['STRONG_WIND_AHEAD']);
  });

  it('keeps event ids stable when ETAs drift', () => {
    const a = events([dry(0, 0), { km: 40, min: 30, cond: 'RAIN' }]).map((x) => x.id);
    const b = events([dry(0, 0), { km: 40, min: 37, cond: 'RAIN' }]).map((x) => x.id);
    expect(a).toEqual(b);
  });
});
