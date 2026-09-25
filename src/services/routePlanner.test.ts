import { describe, expect, it } from 'vitest';
import { BATUMI, FakeWeatherProvider, TBILISI, tbilisiBatumiPlaces, tbilisiBatumiRoute } from '../test/helpers';
import { StyleUrlMapProvider } from './map/MapProvider';
import type { Providers } from './providers';
import { applyLatePlaces, parseCoordinateText, planRoute, resolvePlace } from './routePlanner';
import { NoTrafficProvider } from './traffic/TrafficProvider';
import { WeatherService } from './weather/WeatherService';

function providers(placesDelayMs: number, failPlaces = false): Providers {
  return {
    routing: { name: 'r', calculateRoute: async () => tbilisiBatumiRoute() },
    geocoding: { name: 'g', geocode: async (q) => (/tbilisi/i.test(q) ? TBILISI : null), reverse: async () => null },
    autocomplete: { name: 'a', suggest: async () => [] },
    reverseGeocoding: { name: 'rg', geocode: async () => null, reverse: async () => null },
    places: {
      name: 'p',
      getPlacesNearRoute: () =>
        new Promise((resolve, reject) =>
          setTimeout(() => (failPlaces ? reject(new Error('504')) : resolve(tbilisiBatumiPlaces())), placesDelayMs),
        ),
    },
    elevation: null,
    traffic: new NoTrafficProvider(),
    map: new StyleUrlMapProvider('t', 'l', 'd'),
    weather: new WeatherService(new FakeWeatherProvider(Date.now()), {
      ttlMs: 1e6,
      batchSize: 50,
      resolutionDeg: 0.02,
      maxEntries: 100,
      minForecastHours: 48,
    }),
  };
}

describe('planRoute', () => {
  it('uses places that arrive in time as sampling anchors', async () => {
    const plan = await planRoute(providers(5), TBILISI, BATUMI, { placesDeadlineMs: 500 });
    expect(plan.latePlaces).toBeUndefined();
    expect(plan.samples.some((s) => s.placeName === 'Khashuri' && s.reasons.includes('settlement'))).toBe(true);
  });

  it('does not let a slow places server block the forecast, then names samples later', async () => {
    const t0 = Date.now();
    const plan = await planRoute(providers(150), TBILISI, BATUMI, { placesDeadlineMs: 20 });
    expect(Date.now() - t0).toBeLessThan(140);
    expect(plan.latePlaces).toBeDefined();
    expect(plan.samples.filter((s) => s.placeKind).length).toBe(0);
    const places = await plan.latePlaces!;
    const named = applyLatePlaces(plan, places);
    // Same sample ids → cached forecasts still apply
    expect(named.samples.map((s) => s.id)).toEqual(plan.samples.map((s) => s.id));
    expect(named.samples.filter((s) => s.placeKind).length).toBeGreaterThan(5);
    expect(named.samples[0].placeName).toBe('Tbilisi');
    expect(named.samples.at(-1)!.placeName).toBe('Batumi');
  });

  it('degrades to no places when the places server fails', async () => {
    const plan = await planRoute(providers(5, true), TBILISI, BATUMI, { placesDeadlineMs: 500 });
    expect(plan.warnings).toContain('places-unavailable');
    expect(plan.samples.length).toBeGreaterThanOrEqual(15);
  });
});

describe('resolvePlace', () => {
  it('skips geocoding for picked suggestions and coordinates', async () => {
    const p = providers(0);
    expect(await resolvePlace(p, { text: 'x', place: BATUMI })).toBe(BATUMI);
    expect(parseCoordinateText('41.69, 44.80')).toEqual([44.8, 41.69]);
    expect((await resolvePlace(p, { text: '41.69, 44.80', place: null })).coordinate).toEqual([44.8, 41.69]);
    await expect(resolvePlace(p, { text: 'Atlantis', place: null })).rejects.toThrow(/Atlantis/);
  });
});
