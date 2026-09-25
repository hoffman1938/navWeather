import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { createProviders } from '../services/providers';
import { fetchSampleForecasts, forecastLookupFn, planRoute } from '../services/routePlanner';
import { buildRouteWeatherPoints } from '../algorithms/routeWeather';
import { computeArrivals } from '../algorithms/routeTiming';
import { matchForecastToTime } from '../algorithms/weatherMatching';
import type { Place } from '../types/geo';

/**
 * Real-API smoke test for Tbilisi → Batumi (OSRM + Overpass + Open-Meteo).
 * Opt-in: `npm run test:live`. Skipped in normal runs to respect the free
 * services' usage policies.
 */
const live = process.env.LIVE_API_TESTS === '1';

const TBILISI: Place = { id: 'tbs', name: 'Tbilisi', label: 'Tbilisi, Georgia', coordinate: [44.8014495, 41.6934591] };
const BATUMI: Place = { id: 'bus', name: 'Batumi', label: 'Batumi, Georgia', coordinate: [41.6360085, 41.6509502] };

describe.skipIf(!live)('LIVE: Tbilisi → Batumi', () => {
  it(
    'routes on real roads, samples, and matches real forecasts to ETAs',
    async () => {
      const providers = createProviders(config);
      const plan = await planRoute(providers, TBILISI, BATUMI, { placesDeadlineMs: 15000 });
      const km = plan.timed.totalDistM / 1000;
      expect(km).toBeGreaterThan(300);
      expect(km).toBeLessThan(420);
      expect(plan.timed.timingSource).toBe('annotations');
      expect(plan.samples.length).toBeGreaterThanOrEqual(15);
      expect(plan.samples.length).toBeLessThanOrEqual(30);

      const departureMs = Date.now();
      const arrivals = computeArrivals(plan.samples, { mode: 'planning', departureMs });
      const lookup = await fetchSampleForecasts(providers, plan.samples, Math.max(...arrivals));
      expect(lookup.error).toBeUndefined();
      expect(lookup.requestCount).toBe(1); // all locations in one batched request

      const forecastFor = forecastLookupFn(providers, lookup.forecasts);
      const points = buildRouteWeatherPoints({
        samples: plan.samples,
        arrivals,
        forecastFor,
        nowMs: departureMs,
        progressM: null,
        modelTimeS: 0,
        fallbackTimeZone: 'UTC',
      });
      for (const [i, p] of points.entries()) {
        expect(p.timezone).toBe('Asia/Tbilisi');
        expect(p.weather).not.toBeNull();
        // Weather equals the forecast matched at THIS point's ETA
        const expected = matchForecastToTime(forecastFor(plan.samples[i])!, arrivals[i])!;
        expect(p.weather!.temperature).toBe(expected.temperature);
        expect(p.weather!.condition).toBe(expected.condition);
      }
      console.log(
        points
          .map((p) => `${p.localTime} ${(p.placeName ?? `km ${p.distanceFromStartKm}`).padEnd(18)} ${p.weather!.condition.padEnd(13)} ${p.weather!.temperature}° ${p.weather!.precipitationProbability ?? 0}%`)
          .join('\n'),
      );
    },
    60_000,
  );
});
