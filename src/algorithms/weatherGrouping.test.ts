import { describe, expect, it } from 'vitest';
import type { RouteWeatherPoint, WeatherAtTime, WeatherCondition } from '../types/weather';
import {
  detectWeatherEvents,
  groupWeather,
  selectDisplayPoints,
  summarizeRouteWeather,
  weatherRouteSegments,
} from './weatherGrouping';

const T0 = Date.UTC(2026, 8, 26, 4, 0);

function pt(
  i: number,
  km: number,
  minutes: number,
  condition: WeatherCondition,
  temperature: number,
  extra: Partial<WeatherAtTime> & { name?: string; settlement?: boolean } = {},
): RouteWeatherPoint {
  const { name, settlement, ...w } = extra;
  return {
    id: `p${i}`,
    latitude: 41.7,
    longitude: 44.8 - km / 100,
    distanceFromStartKm: km,
    estimatedTravelMinutes: minutes,
    estimatedArrivalUtc: new Date(T0 + minutes * 60000).toISOString(),
    arrivalMs: T0 + minutes * 60000,
    localTime: '',
    timezone: 'Asia/Tbilisi',
    placeName: name,
    placeRelation: name ? 'in' : undefined,
    weather: { condition, temperature, isDay: true, forecastHourUtc: 0, ...w },
    forecastLeadHours: minutes / 60,
    confidence: 'high',
    status: 'upcoming',
    reasons: settlement ? ['settlement'] : ['distance'],
  };
}

// Tbilisi → Batumi: cloudy, rain near Khashuri, clearing, cloudy coast.
const journey: RouteWeatherPoint[] = [
  pt(0, 0, 0, 'CLOUDY', 18, { name: 'Tbilisi', settlement: true }),
  pt(1, 40, 35, 'CLOUDY', 18),
  pt(2, 83, 70, 'CLOUDY', 19, { name: 'Gori', settlement: true, precipitationProbability: 20 }),
  pt(3, 110, 85, 'CLOUDY', 18),
  pt(4, 130, 105, 'RAIN', 17, { name: 'Khashuri', settlement: true, precipitationProbability: 65, precipitation: 1.2 }),
  pt(5, 150, 120, 'RAIN', 15, { precipitationProbability: 70 }),
  pt(6, 183, 150, 'CLOUDY', 20, { name: 'Zestaponi', settlement: true }),
  pt(7, 215, 170, 'CLEAR', 21),
  pt(8, 245, 190, 'CLEAR', 21, { name: 'Samtredia', settlement: true }),
  pt(9, 290, 230, 'CLEAR', 22),
  pt(10, 332, 263, 'CLOUDY', 23, { name: 'Kobuleti', settlement: true }),
  pt(11, 357, 293, 'CLOUDY', 23, { name: 'Batumi', settlement: true }),
];

describe('groupWeather', () => {
  it('groups consecutive similar weather into stretches', () => {
    const g = groupWeather(journey);
    expect(g.map((x) => x.groupClass)).toEqual(['cloudy', 'rain', 'cloudy', 'clear', 'cloudy']);
    expect(g[1].label).toBe('Rain likely');
    expect(g[1].fromName).toBe('Khashuri');
    expect(g[0].pointIds).toHaveLength(4);
  });

  it('absorbs a lone non-notable blip but never a notable one', () => {
    const pts = [pt(0, 0, 0, 'CLOUDY', 18), pt(1, 10, 10, 'CLEAR', 18), pt(2, 20, 20, 'CLOUDY', 18)];
    expect(groupWeather(pts)).toHaveLength(1);
    const wet = [pt(0, 0, 0, 'CLOUDY', 18), pt(1, 10, 10, 'RAIN', 18), pt(2, 20, 20, 'CLOUDY', 18)];
    expect(groupWeather(wet)).toHaveLength(3);
  });

  it('does not show 30 identical cards for 200 km of the same weather', () => {
    const same = Array.from({ length: 30 }, (_, i) => pt(i, i * 7, i * 6, 'CLOUDY', 18));
    expect(groupWeather(same)).toHaveLength(1);
    expect(selectDisplayPoints(same).length).toBeLessThanOrEqual(8);
  });
});

describe('detectWeatherEvents', () => {
  it('detects rain starting and ending', () => {
    const e = detectWeatherEvents(journey);
    expect(e.find((x) => x.type === 'rain-start')?.message).toBe('Rain likely from Khashuri');
    expect(e.find((x) => x.type === 'rain-end')?.pointId).toBe('p6');
  });

  it('detects thunderstorms, snow, wind, fog, temperature drops and icy roads', () => {
    const pts = [
      pt(0, 0, 0, 'CLEAR', 20, { name: 'A' }),
      pt(1, 50, 40, 'THUNDERSTORM', 18, { name: 'B' }),
      pt(2, 100, 80, 'CLOUDY', 12, { name: 'C', windGusts: 75 }),
      pt(3, 150, 120, 'FOG', 11, { name: 'D', visibility: 300 }),
      pt(4, 200, 160, 'SNOW', 0, { name: 'E', precipitationProbability: 80 }),
    ];
    const types = detectWeatherEvents(pts).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['thunderstorm', 'strong-wind', 'low-visibility', 'snow-start', 'temperature-drop', 'icy']),
    );
  });
});

describe('selectDisplayPoints', () => {
  it('keeps ends, weather transitions and named places, spread over time', () => {
    const shown = selectDisplayPoints(journey, { maxCards: 7 });
    const ids = shown.map((p) => p.id);
    expect(ids[0]).toBe('p0');
    expect(ids[ids.length - 1]).toBe('p11');
    expect(ids).toContain('p4'); // rain begins at Khashuri
    expect(shown.length).toBeLessThanOrEqual(8);
    // chronological
    for (let i = 1; i < shown.length; i++) expect(shown[i].arrivalMs).toBeGreaterThan(shown[i - 1].arrivalMs);
  });
});

describe('summarizeRouteWeather', () => {
  it('summarizes with hedged forecast wording', () => {
    const s = summarizeRouteWeather(journey);
    expect(s.headline).toBe('Rain likely near Khashuri');
    expect(s.tone).toBe('wet');
    expect(s.detail).toBe('15–23° along the way');
    const texts = s.highlights.map((h) => h.text);
    expect(texts[0]).toBe('Cloudy in Tbilisi');
    expect(texts).toContain('Rain likely near Khashuri');
    expect(texts[texts.length - 1]).toBe('Cloudy in Batumi');
    expect(s.headline).not.toMatch(/guarantee|will rain/i);
  });

  it('reports mostly dry conditions', () => {
    const dry = journey.map((p) => ({ ...p, weather: { ...p.weather!, condition: 'CLOUDY' as const } }));
    expect(summarizeRouteWeather(dry).headline).toBe('Mostly dry conditions along your route');
  });

  it('handles missing weather gracefully', () => {
    expect(summarizeRouteWeather(journey.map((p) => ({ ...p, weather: null }))).tone).toBe('unknown');
  });
});

describe('weatherRouteSegments', () => {
  it('colors only notable stretches', () => {
    const segs = weatherRouteSegments(journey, 357_000);
    expect(segs).toHaveLength(1);
    expect(segs[0].groupClass).toBe('rain');
    expect(segs[0].startM).toBeGreaterThan(110_000);
    expect(segs[0].endM).toBeLessThan(183_000);
  });
});

describe('rain event smoothing', () => {
  it('does not restart rain after a short dry blip', () => {
    const pts = [
      pt(0, 0, 0, 'CLOUDY', 18, { name: 'A' }),
      pt(1, 40, 30, 'RAIN', 17, { name: 'B', precipitationProbability: 50 }),
      pt(2, 55, 42, 'CLOUDY', 17, { name: 'C' }),
      pt(3, 70, 55, 'RAIN', 17, { name: 'D', precipitationProbability: 60 }),
      pt(4, 150, 120, 'CLEAR', 20, { name: 'E' }),
    ];
    const types = detectWeatherEvents(pts).map((e) => `${e.type}:${e.pointId}`);
    expect(types.filter((t) => t.startsWith('rain-start'))).toEqual(['rain-start:p1']);
    expect(types.filter((t) => t.startsWith('rain-end'))).toEqual(['rain-end:p4']);
  });
});
