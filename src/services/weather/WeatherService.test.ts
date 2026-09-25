import { describe, expect, it } from 'vitest';
import { FakeWeatherProvider } from '../../test/helpers';
import { WeatherService } from './WeatherService';

const BASE = Date.UTC(2026, 8, 26, 4, 0);

function setup(ttlMin = 20) {
  let now = BASE;
  const provider = new FakeWeatherProvider(BASE);
  const service = new WeatherService(provider, {
    ttlMs: ttlMin * 60000,
    batchSize: 3,
    resolutionDeg: 0.02,
    maxEntries: 100,
    minForecastHours: 48,
    updateCheckMs: 10 * 60000,
    now: () => now,
  });
  return { provider, service, advance: (ms: number) => (now += ms) };
}

const pts = [
  { latitude: 41.6935, longitude: 44.8015 },
  { latitude: 41.69352, longitude: 44.80153 }, // same grid cell as above
  { latitude: 41.98, longitude: 44.11 },
  { latitude: 42.0, longitude: 43.6 },
  { latitude: 42.1, longitude: 43.04 },
];

describe('WeatherService', () => {
  it('deduplicates nearby coordinates and batches requests', async () => {
    const { provider, service } = setup();
    const r = await service.getForecasts(pts);
    expect(r.requestedCount).toBe(4); // 5 points → 4 unique cells
    expect(r.requestCount).toBe(2); // batch size 3 → 2 HTTP requests
    expect(provider.requests.map((q) => q.locations.length)).toEqual([3, 1]);
    expect(r.forecasts.size).toBe(4);
  });

  it('serves fresh cache without new requests', async () => {
    const { provider, service, advance } = setup();
    await service.getForecasts(pts);
    advance(10 * 60000);
    const r = await service.getForecasts(pts);
    expect(r.requestCount).toBe(0);
    expect(provider.requests).toHaveLength(2);
  });

  it('refetches after the TTL (forecast refresh)', async () => {
    const { provider, service, advance } = setup(20);
    await service.getForecasts(pts);
    advance(21 * 60000);
    provider.version = 1;
    const r = await service.getForecasts(pts);
    expect(r.requestCount).toBe(2);
    expect(provider.requests).toHaveLength(4);
  });

  it('forces a refresh on manual update', async () => {
    const { provider, service } = setup();
    await service.getForecasts(pts);
    await service.getForecasts(pts, { force: true });
    expect(provider.requests).toHaveLength(4);
  });

  it('shares in-flight requests between concurrent lookups', async () => {
    const { provider, service } = setup();
    const [a, b] = await Promise.all([service.getForecasts(pts), service.getForecasts(pts)]);
    expect(provider.requests).toHaveLength(2);
    expect(a.forecasts.size).toBe(4);
    expect(b.forecasts.size).toBe(4);
  });

  it('does not adopt a request that its owner aborted (race)', async () => {
    const { provider, service } = setup();
    provider.delayMs = 20;
    const ctrl = new AbortController();
    const first = service.getForecasts(pts, { signal: ctrl.signal });
    first.catch(() => undefined);
    const second = service.getForecasts(pts); // joins the in-flight requests
    ctrl.abort();
    const r = await second;
    expect(r.error).toBeUndefined();
    expect(r.forecasts.size).toBe(4);
    await expect(first).rejects.toThrow();
  });

  it('falls back to stale cache when the provider fails', async () => {
    const { provider, service, advance } = setup();
    await service.getForecasts(pts);
    advance(60 * 60000);
    provider.fail = true;
    const r = await service.getForecasts(pts);
    expect(r.error).toBeDefined();
    expect(r.forecasts.size).toBe(4);
    expect(r.staleKeys.size).toBe(4);
  });

  it('reports missing data when nothing is cached', async () => {
    const { provider, service } = setup();
    provider.fail = true;
    const r = await service.getForecasts(pts);
    expect(r.error).toBeDefined();
    expect(r.missingKeys.size).toBe(4);
  });

  it('requests a horizon that covers the latest arrival', async () => {
    const { provider, service } = setup();
    await service.getForecasts(pts.slice(0, 1), { needUntilMs: BASE + 70 * 3600_000 });
    expect(provider.requests[0].forecastHours).toBe(72); // 70 h + margin, whole days
    expect(provider.requests[0].forecastHours).toBeGreaterThanOrEqual(70);
  });

  it('getWeatherForArrivalTime matches the forecast to the arrival', async () => {
    const { service } = setup();
    // Fake: rain west of 43.7°E from 2 h after BASE; 15° + 1°/h
    const early = await service.getWeatherForArrivalTime(42.0, 43.6, BASE + 3600_000);
    const later = await service.getWeatherForArrivalTime(42.0, 43.6, BASE + 3 * 3600_000);
    expect(early?.condition).toBe('CLOUDY');
    expect(later?.condition).toBe('RAIN');
    expect(later!.temperature).toBeCloseTo(18, 5);
  });
});

describe('new forecast detection (model runs)', () => {
  it('stamps each cached forecast with the model run it came from', async () => {
    const { provider, service } = setup();
    provider.latestRun = BASE - 3600_000;
    const r = await service.getForecasts(pts);
    for (const f of r.forecasts.values()) expect(f.forecastGeneratedAt).toBe(BASE - 3600_000);
  });

  it('reports a newer forecast only after a newer run appears, checking upstream sparingly', async () => {
    const { provider, service, advance } = setup(60);
    provider.latestRun = BASE - 3600_000;
    const r = await service.getForecasts(pts);
    const used = [...r.forecasts.values()];
    expect(await service.hasNewerForecast(used)).toBe(false);

    provider.latestRun = BASE + 60_000; // new model run published
    advance(2 * 60000);
    expect(await service.hasNewerForecast(used)).toBe(false); // still within the 10-min check interval
    const checks = provider.updateChecks;
    advance(10 * 60000);
    expect(await service.hasNewerForecast(used)).toBe(true);
    expect(provider.updateChecks).toBe(checks + 1);

    // A forced refresh picks up the new run → nothing newer anymore
    const fresh = await service.getForecasts(pts, { force: true });
    expect(await service.hasNewerForecast(fresh.forecasts.values())).toBe(false);
  });

  it('treats providers without run metadata as "no newer forecast"', async () => {
    const { provider, service } = setup();
    const r = await service.getForecasts(pts);
    expect(await service.hasNewerForecast(r.forecasts.values())).toBe(false);
    expect(provider.updateChecks).toBeGreaterThan(0);
  });
});
