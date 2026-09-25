import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders, type Providers } from '../services/providers';
import type { RouteRequest } from '../services/routing/RoutingProvider';
import { normalizeOsrmRoute } from '../services/routing/OSRMProvider';
import { StyleUrlMapProvider } from '../services/map/MapProvider';
import { NoTrafficProvider } from '../services/traffic/TrafficProvider';
import { WeatherService } from '../services/weather/WeatherService';
import {
  BATUMI,
  FakeWeatherProvider,
  rawTbilisiBatumi,
  TBILISI,
  tbilisiBatumiPlaces,
  tbilisiBatumiRoute,
} from '../test/helpers';
import type { LngLat } from '../types/geo';
import { haversineM } from '../utils/distance';
import { formatLocalTime } from '../utils/timezone';
import { selectScrub } from './scrub';
import { __resetStoreRuntime, useAppStore } from './store';

/**
 * End-to-end: Tbilisi → Batumi through the real pipeline
 * (geocode → route → places → sampling → timing → weather → matching →
 * grouping → display) with deterministic fake providers.
 */

const BASE = Date.UTC(2026, 8, 26, 4, 0); // 08:00 in Tbilisi
const H = 3600_000;
const initialState = useAppStore.getState();

let weatherProvider: FakeWeatherProvider;
let routingCalls: RouteRequest[];

function installProviders() {
  weatherProvider = new FakeWeatherProvider(BASE);
  routingCalls = [];
  const providers: Providers = {
    routing: {
      name: 'fake-osrm',
      async calculateRoute(req) {
        routingCalls.push(req);
        if (req.origin.id === TBILISI.id) return tbilisiBatumiRoute();
        // Re-route: remainder of the fixture from the vertex closest to the origin.
        const raw = rawTbilisiBatumi();
        const coords = raw.geometry.coordinates;
        let k = 0;
        coords.forEach((c, i) => {
          if (haversineM(c, req.origin.coordinate) < haversineM(coords[k], req.origin.coordinate)) k = i;
        });
        const leg = raw.legs[0];
        const ann = leg.annotation!;
        const durs = ann.duration!.slice(k);
        const dists = ann.distance!.slice(k);
        const sliced = {
          distance: dists.reduce((a, b) => a + b, 0),
          duration: durs.reduce((a, b) => a + b, 0),
          geometry: { coordinates: [req.origin.coordinate, ...coords.slice(k + 1)] },
          legs: [
            {
              ...leg,
              distance: dists.reduce((a, b) => a + b, 0),
              duration: durs.reduce((a, b) => a + b, 0),
              steps: [],
              annotation: { duration: durs, distance: dists },
            },
          ],
        };
        return normalizeOsrmRoute(sliced, req);
      },
    },
    geocoding: {
      name: 'fake-geo',
      async geocode(q) {
        return /batumi/i.test(q) ? BATUMI : /tbilisi/i.test(q) ? TBILISI : null;
      },
      async reverse() {
        return null;
      },
    },
    autocomplete: { name: 'fake-ac', suggest: async () => [] },
    reverseGeocoding: { name: 'fake-rev', geocode: async () => null, reverse: async () => null },
    places: { name: 'fake-places', getPlacesNearRoute: async () => tbilisiBatumiPlaces() },
    elevation: null,
    traffic: new NoTrafficProvider(),
    map: new StyleUrlMapProvider('test', 'light', 'dark'),
    weather: new WeatherService(weatherProvider, {
      ttlMs: 20 * 60000,
      batchSize: 50,
      resolutionDeg: 0.02,
      maxEntries: 500,
      minForecastHours: 48,
    }),
  };
  setProviders(providers);
}

async function planTbilisiBatumi() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

/** The fake forecast: 15° + 1°/h since BASE; rain west of 43.7°E from BASE+2h. */
const expectedTemp = (arrivalMs: number) => 15 + (arrivalMs - BASE) / H;
/** Temperatures are rounded to 0.1° for display. */
const expectTempFor = (actual: number, arrivalMs: number) =>
  expect(Math.abs(actual - expectedTemp(arrivalMs))).toBeLessThanOrEqual(0.051);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initialState, true);
  installProviders();
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('Tbilisi → Batumi end-to-end', () => {
  it('calculates the route along the real road geometry', async () => {
    await planTbilisiBatumi();
    const s = useAppStore.getState();
    expect(s.routeStatus).toBe('ready');
    const route = s.plan!.timed.route;
    expect(route.geometry.length).toBeGreaterThan(3000);
    expect(route.distanceM / 1000).toBeCloseTo(358, 0);
    expect(s.plan!.timed.timingSource).toBe('annotations');
  });

  it('generates weather points, each with an ETA and a local time', async () => {
    await planTbilisiBatumi();
    const { derived } = useAppStore.getState();
    expect(derived.points.length).toBeGreaterThanOrEqual(15);
    for (const p of derived.points) {
      expect(p.arrivalMs).toBeGreaterThanOrEqual(BASE);
      expect(p.estimatedArrivalUtc).toBe(new Date(p.arrivalMs).toISOString());
      expect(p.localTime).toBe(formatLocalTime(p.arrivalMs, 'Asia/Tbilisi'));
      expect(p.timezone).toBe('Asia/Tbilisi');
      expect(p.weather).not.toBeNull();
    }
    expect(derived.points[0].localTime).toBe('08:00');
    const last = derived.points[derived.points.length - 1];
    expect(last.placeName).toBe('Batumi');
    expect(last.arrivalMs - BASE).toBeCloseTo(17553.1 * 1000, -4); // ≈ 4h 53m
  });

  it('shows the weather expected at each point AT ITS ETA (not now)', async () => {
    await planTbilisiBatumi();
    const { derived } = useAppStore.getState();
    for (const p of derived.points) {
      expectTempFor(p.weather!.temperature, p.arrivalMs);
    }
    // Condition follows place AND the forecast hour containing the ETA:
    // rain only west of 43.7°E in intervals ending ≥ BASE+2h.
    for (const p of derived.points) {
      const intervalH = Math.ceil((p.arrivalMs - BASE) / H);
      const expected = p.longitude < 43.7 && intervalH >= 2 ? 'RAIN' : 'CLOUDY';
      expect(p.weather!.condition).toBe(expected);
    }
    const gori = derived.points.find((p) => p.placeName === 'Gori' && p.placeRelation === 'in')!;
    const zestaponi = derived.points.find((p) => p.placeName === 'Zestaponi' && p.placeRelation === 'in')!;
    expect(gori.weather!.condition).toBe('CLOUDY');
    expect(zestaponi.weather!.condition).toBe('RAIN');
    expect(derived.summary!.tone).toBe('wet');
  });

  it('re-matches weather when the departure time changes (no refetch needed)', async () => {
    await planTbilisiBatumi();
    const before = useAppStore.getState().derived.points.find((p) => p.placeName === 'Khashuri')!;
    expect(before.weather!.condition).toBe('RAIN'); // arrive ~09:35, rain from 09:00
    const requests = weatherProvider.requests.length;
    // Leave 2 h earlier: reach Khashuri ~07:35, before the rain.
    useAppStore.getState().setDeparture({ mode: 'at', utcMs: BASE - 2 * H });
    await vi.waitFor(() => expect(useAppStore.getState().weatherStatus).toBe('ready'));
    const after = useAppStore.getState().derived.points.find((p) => p.id === before.id)!;
    expect(after.arrivalMs - before.arrivalMs).toBe(-2 * H);
    expect(Math.abs(after.weather!.temperature - (before.weather!.temperature - 2))).toBeLessThanOrEqual(0.11);
    expect(after.weather!.condition).toBe('CLOUDY');
    expect(after.localTime).toBe(formatLocalTime(before.arrivalMs - 2 * H, 'Asia/Tbilisi'));
    // served from cache — no new weather request
    expect(weatherProvider.requests.length).toBe(requests);
  });

  it('answers "where will I be at 10:30, and what weather then?"', async () => {
    await planTbilisiBatumi(); // depart 08:00 Tbilisi time
    useAppStore.getState().setScrub(BASE + 2.5 * H); // 10:30 local
    const at = selectScrub(useAppStore.getState())!;
    expect(at.localTime).toBe('10:30');
    expect(at.travelTimeS).toBe(2.5 * 3600);
    expect(at.distanceM / 1000).toBeGreaterThan(150);
    expect(at.distanceM / 1000).toBeLessThan(250);
    expect(at.coordinate[0]).toBeLessThan(43.6); // past Khashuri, western Georgia
    expect(at.placeName).toBeTruthy();
    // Forecast for THAT place at THAT time (fake: 15° + 1°/h, raining in the west after BASE+2h)
    expectTempFor(at.weather!.temperature, BASE + 2.5 * H);
    expect(at.weather!.condition).toBe('RAIN');
    // Same selector result object while nothing changes (map + panel share it)
    expect(selectScrub(useAppStore.getState())).toBe(at);
    // After arrival → clamped to the destination
    useAppStore.getState().setScrub(BASE + 9 * H);
    const late = selectScrub(useAppStore.getState())!;
    expect(late.arrived).toBe(true);
    expect(late.placeName).toBe('Batumi');
  });

  it('keeps timeline cards and map markers in sync (same points, same order)', async () => {
    await planTbilisiBatumi();
    const { derived } = useAppStore.getState();
    const cardIds = derived.timelineItems.filter((i) => i.type === 'point').map((i) => i.id);
    expect(cardIds).toEqual(derived.displayPoints.map((p) => p.id));
    expect(cardIds.length).toBeGreaterThanOrEqual(4);
    expect(cardIds.length).toBeLessThan(derived.points.length);
    expect(derived.displayPoints[0].placeName).toBe('Tbilisi');
    expect(derived.displayPoints.at(-1)!.placeName).toBe('Batumi');
  });

  it('batches weather requests instead of one per coordinate', async () => {
    await planTbilisiBatumi();
    const s = useAppStore.getState();
    const locations = weatherProvider.requests.reduce((a, r) => a + r.locations.length, 0);
    expect(weatherProvider.requests.length).toBeLessThanOrEqual(2); // initial + refinement
    expect(locations).toBeLessThanOrEqual(s.plan!.samples.length);
  });

  it('refreshes the forecast and updates only changed points', async () => {
    await planTbilisiBatumi();
    const before = useAppStore.getState().derived.points;
    // New model run: 3° warmer west of 42.5°E only
    weatherProvider.hourFn = (_lat, lon, hourMs, version) => {
      const h = (hourMs - BASE) / H;
      return {
        temperature: 15 + h + (version > 0 && lon < 42.5 ? 3 : 0),
        code: lon < 43.7 && h >= 2 ? 63 : 3,
        precipitationProbability: lon < 43.7 && h >= 2 ? 70 : 10,
        precipitation: lon < 43.7 && h >= 2 ? 1.2 : 0,
      };
    };
    weatherProvider.version = 1;
    await useAppStore.getState().loadWeather({ force: true, reason: 'manual' });
    const s = useAppStore.getState();
    expect(s.lastRefresh?.changedIds.length).toBeGreaterThan(0);
    const after = s.derived.points;
    for (const p of after) {
      const old = before.find((b) => b.id === p.id);
      if (!old) continue;
      if (p.longitude < 42.5) expect(s.lastRefresh!.changedIds).toContain(p.id);
      // unchanged points keep object identity → no re-render
      else expect(p).toBe(old);
    }
    expect(s.notice?.text).toMatch(/Forecast updated/);
  });

  it('refreshes automatically when a new forecast model run is published', async () => {
    weatherProvider.latestRun = BASE - 2 * H;
    await planTbilisiBatumi();
    const before = weatherProvider.requests.length;
    // A new run appears; 11 min after the fetch (data still within the 20-min TTL,
    // and past the 10-min upstream check interval) the app notices and refetches.
    weatherProvider.latestRun = BASE + 5 * 60000;
    vi.setSystemTime(BASE + 60000);
    useAppStore.getState().refreshIfStale();
    await vi.waitFor(() => expect(weatherProvider.requests.length).toBeGreaterThan(before));
    await vi.waitFor(() => expect(useAppStore.getState().lastRefresh?.reason).toBe('model-update'));
    expect(useAppStore.getState().weatherStatus).toBe('ready');
  });

  it('does not refetch when nothing new is available and data is fresh', async () => {
    weatherProvider.latestRun = BASE - 2 * H;
    await planTbilisiBatumi();
    const before = weatherProvider.requests.length;
    vi.setSystemTime(BASE + 60000);
    useAppStore.getState().refreshIfStale();
    await new Promise((r) => setTimeout(r, 20));
    expect(weatherProvider.requests.length).toBe(before);
  });

  it('keeps navigation usable and flags stale data when weather fails', async () => {
    await planTbilisiBatumi();
    weatherProvider.fail = true;
    vi.setSystemTime(BASE + 30 * 60000);
    await useAppStore.getState().loadWeather({ reason: 'auto' });
    const s = useAppStore.getState();
    expect(s.weatherError).toBe('Weather data temporarily unavailable');
    expect(s.weatherStale).toBe(true);
    expect(s.derived.points.every((p) => p.weather)).toBe(true);
    expect(s.plan).not.toBeNull();
  });

  it('shows a friendly error when routing fails', async () => {
    const s = useAppStore.getState();
    s.setOriginText('Atlantis');
    s.setDestinationText('Batumi');
    await useAppStore.getState().calculateRoute();
    expect(useAppStore.getState().routeStatus).toBe('error');
    expect(useAppStore.getState().routeError).toMatch(/Atlantis/);
  });
});

describe('simulated drive', () => {
  it('moves the vehicle, updates ETA and the future timeline', async () => {
    await planTbilisiBatumi();
    const store = useAppStore.getState();
    store.setSimulationSpeed(60);
    store.startSimulation();
    let s = useAppStore.getState();
    expect(s.mode).toBe('simulating');
    const totalS = s.plan!.timed.totalTimeS;
    expect(s.derived.currentPoint).not.toBeNull();

    // 80 s real time at 60× ≈ 80 min of driving
    for (let i = 0; i < 80; i++) useAppStore.getState().advanceSimulationBy(1000);
    useAppStore.getState().advanceSimulationBy(0);
    s = useAppStore.getState();
    const p = s.progress!;
    expect(p.distanceAlongM).toBeGreaterThan(60_000);
    expect(p.remainingTimeS).toBeLessThan(totalS - 60 * 60);
    expect(p.etaMs).toBe(p.nowMs + p.remainingTimeS * 1000);

    // Points behind the vehicle are no longer shown; the NOW card leads the timeline.
    const passed = s.derived.points.filter((x) => x.status === 'passed');
    expect(passed.length).toBeGreaterThan(0);
    expect(s.derived.displayPoints.every((x) => x.status !== 'passed')).toBe(true);
    expect(s.derived.timelineItems[0].id).toBe('current');
    expect(s.derived.currentPoint!.arrivalMs).toBe(s.sim.nowMs);
    expectTempFor(s.derived.currentPoint!.weather!.temperature, s.sim.nowMs);

    // Future points are matched to their NEW ETAs (now + remaining model time).
    for (const up of s.derived.upcoming) {
      const sample = s.plan!.samples.find((x) => x.id === up.id)!;
      const eta = s.sim.nowMs + (sample.travelTimeS - p.modelTimeS) * 1000;
      expect(Math.abs(up.arrivalMs - eta)).toBeLessThan(60_000); // minute resolution
      expectTempFor(up.weather!.temperature, up.arrivalMs);
    }

    // Pause stops movement; exit returns to planning.
    useAppStore.getState().pauseSimulation();
    const d = useAppStore.getState().progress!.distanceAlongM;
    useAppStore.getState().advanceSimulationBy(10_000);
    expect(useAppStore.getState().progress!.distanceAlongM).toBe(d);
    useAppStore.getState().exitSimulation();
    expect(useAppStore.getState().mode).toBe('planning');
    expect(useAppStore.getState().derived.currentPoint).toBeNull();
  });

  it('arrives at the destination', async () => {
    await planTbilisiBatumi();
    useAppStore.getState().setSimulationSpeed(300);
    useAppStore.getState().startSimulation();
    for (let i = 0; i < 100; i++) useAppStore.getState().advanceSimulationBy(1000);
    const s = useAppStore.getState();
    expect(s.sim.arrived).toBe(true);
    expect(s.progress!.remainingDistanceM).toBeCloseTo(0, 0);
    expect(s.notice?.text).toMatch(/Arrived at Batumi/);
  });
});

describe('live GPS navigation', () => {
  const along = (km: number): LngLat => {
    const s = useAppStore.getState();
    const t = s.plan!.timed;
    let i = 0;
    while (i < t.cumDistM.length - 1 && t.cumDistM[i] < km * 1000) i++;
    return t.route.geometry[i];
  };

  it('tracks progress and recalculates after a persistent deviation', async () => {
    await planTbilisiBatumi();
    const store = useAppStore.getState();
    store.startNavigation();
    const t0 = Date.now();
    useAppStore.getState().handlePosition({ coordinate: along(83), accuracyM: 8, timestampMs: t0 });
    let s = useAppStore.getState();
    expect(s.progress!.distanceAlongM / 1000).toBeCloseTo(83, 0);
    expect(s.deviation.status).toBe('on-route');
    expect(s.derived.currentPoint?.placeName).toBe('Gori');

    // Drive 600 m off the road for >8 s
    const off: LngLat = [along(90)[0], along(90)[1] + 0.0055];
    for (let i = 1; i <= 4; i++) {
      useAppStore.getState().handlePosition({ coordinate: off, accuracyM: 8, timestampMs: t0 + i * 3000 });
    }
    expect(useAppStore.getState().recalculating).toBe(true);
    await vi.waitFor(() => expect(useAppStore.getState().recalculating).toBe(false));
    await vi.waitFor(() => expect(useAppStore.getState().weatherStatus).toBe('ready'));
    s = useAppStore.getState();
    expect(routingCalls.at(-1)!.origin.name).toBe('Current location');
    expect(s.plan!.timed.route.destination.name).toBe('Batumi');
    expect(s.plan!.timed.totalDistM).toBeLessThan(290_000);
    expect(s.derived.points.every((p) => p.weather)).toBe(true);
    expect(s.mode).toBe('navigating');
  });

  it('asks before navigating when the user is far from the route', async () => {
    await planTbilisiBatumi();
    useAppStore.getState().startNavigation();
    useAppStore.getState().handlePosition({ coordinate: [13.4, 52.5], accuracyM: 10, timestampMs: Date.now() });
    const s = useAppStore.getState();
    expect(s.navPrompt?.kind).toBe('far-from-route');
    expect(s.navPrompt!.distanceM).toBeGreaterThan(1_000_000);
    useAppStore.getState().resolveNavPrompt('simulate');
    expect(useAppStore.getState().mode).toBe('simulating');
  });

  it('falls back gracefully when location is unavailable', async () => {
    await planTbilisiBatumi();
    useAppStore.getState().startNavigation();
    useAppStore.getState().handleGeolocationError('Location unavailable');
    const s = useAppStore.getState();
    expect(s.mode).toBe('planning');
    expect(s.notice?.text).toMatch(/Location unavailable/);
    expect(s.plan).not.toBeNull();
  });
});
