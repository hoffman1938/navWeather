import { describe, expect, it, vi } from 'vitest';
import { describeError } from './routePlanner';
import { ProviderError } from './http';
import { en } from '../i18n/en';
import {
  BATUMI,
  FakeRecognition,
  FakeTTS,
  FakeWeatherProvider,
  TBILISI,
  tbilisiBatumiDetour,
  tbilisiBatumiPlaces,
  tbilisiBatumiRoute,
} from '../test/helpers';
import type { LngLat } from '../types/geo';
import type { Route } from '../types/route';
import type { RouteRequest } from './routing/RoutingProvider';
import { StyleUrlMapProvider } from './map/MapProvider';
import type { Providers } from './providers';
import { applyLatePlaces, findViaRoutes, parseCoordinateText, planOtherRoads, planRoute, planRouteOptions, resolvePlace } from './routePlanner';
import { NoIncidentProvider } from './traffic/IncidentProvider';
import { NoTrafficProvider } from './traffic/TrafficProvider';
import { WeatherService } from './weather/WeatherService';

function providers(placesDelayMs: number, failPlaces = false): Providers {
  return {
    routing: {
      name: 'r',
      capabilities: { alternatives: false, avoid: [], laneGuidance: true, matrix: false, multiStop: true },
      calculateRoutes: async () => [tbilisiBatumiRoute()],
    },
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
    poi: null,
    speedLimits: null,
    tts: new FakeTTS(),
    speechRecognition: new FakeRecognition(),
    traffic: new NoTrafficProvider(),
    incidents: new NoIncidentProvider(),
    air: null,
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

describe('route error messages', () => {
  it('explain what the user can do', () => {
    const fallback = en.ui.unableRoute;
    expect(describeError(new ProviderError('x', 'no-route', 'Routing'), fallback, en)).toBe(en.ui.noRoadRoute);
    expect(describeError(new ProviderError('x', 'network', 'Routing'), fallback, en)).toBe(`${fallback} — ${en.ui.checkConnection}`);
    expect(describeError(new ProviderError('x', 'rate-limited', 'Routing', 429), fallback, en)).toBe(`${fallback} — ${en.ui.busyService}`);
    expect(describeError(new ProviderError('x', 'http', 'Routing', 503), fallback, en)).toBe(`${fallback} — ${en.ui.busyService}`);
    // A 4xx is our request's fault: no "try again" promise.
    expect(describeError(new ProviderError('x', 'http', 'Routing', 400), fallback, en)).toBe(fallback);
    // Raw technical text never reaches the user.
    expect(describeError(new Error('TypeError: cannot read properties of undefined'), fallback, en)).toBe(fallback);
  });
});

describe('finding more roads than the router offers', () => {
  /**
   * A router that offers no alternative by itself and can route through via points: a point north of the
   * road gives a road swinging north; anything else snaps back onto the main road.
   */
  function viaRouter(opts: { alternatives?: Route[]; viaRoute?: (via: LngLat) => Route; fail?: boolean; delayMs?: number } = {}) {
    const calls: RouteRequest[] = [];
    const base = providers(5);
    base.routing = {
      name: 'r',
      capabilities: { alternatives: true, avoid: [], laneGuidance: true, matrix: false, multiStop: true, via: true },
      calculateRoutes: async (req) => {
        calls.push(req);
        if (req.via?.length) {
          if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
          if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (opts.fail) throw new ProviderError('no road', 'no-route', 'Routing service');
          return [opts.viaRoute ? opts.viaRoute(req.via[0]) : req.via[0][1] > 42.35 ? tbilisiBatumiDetour(0.3, 0.7, 0.45, 1.2) : tbilisiBatumiRoute()];
        }
        return [tbilisiBatumiRoute(), ...(req.alternatives ? (opts.alternatives ?? []) : [])];
      },
    };
    return { providers: base, calls };
  }

  it('asks for roads through points off the main road when the router offers none, and offers a different one', async () => {
    const { providers: p, calls } = viaRouter();
    const { primary, alternatives } = await planRouteOptions(p, TBILISI, BATUMI, { alternatives: true });
    expect(calls.filter((c) => c.via?.length).length).toBe(4);
    expect(calls.filter((c) => c.via?.length).every((c) => !c.alternatives && !c.waypoints)).toBe(true);
    expect(alternatives).toHaveLength(1); // two probes found the same northern road: offered once
    expect(alternatives[0].timed.totalTimeS).toBeGreaterThan(primary.timed.totalTimeS);
    expect(alternatives[0].warnings).toContain('not-enriched');
    expect(alternatives[0].timed.route.waypoints).toBeUndefined(); // a via point is not a stop
  });

  it('does not probe when the router already gave enough roads', async () => {
    const { providers: p, calls } = viaRouter({ alternatives: [tbilisiBatumiDetour(0.3, 0.7, 0.45, 1.2), tbilisiBatumiDetour(0.3, 0.7, -0.4, 1.3)] });
    const { alternatives } = await planRouteOptions(p, TBILISI, BATUMI, { alternatives: true });
    expect(alternatives).toHaveLength(2);
    expect(calls.some((c) => c.via?.length)).toBe(false);
  });

  it('tops up what the router offered with probed roads, all different from one another', async () => {
    const { providers: p } = viaRouter({
      alternatives: [tbilisiBatumiDetour(0.3, 0.7, 0.45, 1.2)],
      viaRoute: (via) => (via[1] > 42.35 ? tbilisiBatumiDetour(0.3, 0.7, 0.45, 1.21) : tbilisiBatumiDetour(0.3, 0.7, -0.45, 1.3)),
    });
    const { alternatives } = await planRouteOptions(p, TBILISI, BATUMI, { alternatives: true });
    // The northern probe repeats the router's own road → dropped; the southern one is new.
    expect(alternatives).toHaveLength(2);
    expect(alternatives[0].timed.totalTimeS).toBeLessThan(alternatives[1].timed.totalTimeS);
  });

  it('never offers more than the configured number of roads', async () => {
    const { providers: p } = viaRouter();
    const { alternatives } = await planRouteOptions(p, TBILISI, BATUMI, { alternatives: true, maxRoutes: 1 });
    expect(alternatives).toHaveLength(0);
  });

  it('rejects roads that are absurdly slow or only an out-and-back spur', async () => {
    const slow = viaRouter({ viaRoute: () => tbilisiBatumiDetour(0.3, 0.7, 0.45, 2.2) });
    expect((await planRouteOptions(slow.providers, TBILISI, BATUMI, { alternatives: true })).alternatives).toHaveLength(0);

    const spur = viaRouter({
      viaRoute: () => {
        const g = tbilisiBatumiRoute().geometry;
        const out: LngLat[] = Array.from({ length: 30 }, (_, i) => [g[1000][0], g[1000][1] + (i + 1) * 0.01]);
        const route = tbilisiBatumiRoute();
        return { ...route, geometry: [...g.slice(0, 1001), ...out, ...[...out].reverse(), ...g.slice(1001)], durationS: route.durationS * 1.3, distanceM: route.distanceM * 1.3 };
      },
    });
    expect((await planRouteOptions(spur.providers, TBILISI, BATUMI, { alternatives: true })).alternatives).toHaveLength(0);
  });

  it('a router that finds no road near the points is fine: just the one road', async () => {
    const { providers: p } = viaRouter({ fail: true });
    const { primary, alternatives } = await planRouteOptions(p, TBILISI, BATUMI, { alternatives: true });
    expect(primary.timed.totalDistM).toBeGreaterThan(300_000);
    expect(alternatives).toEqual([]);
  });

  it('does not probe with stops on the trip, without alternatives, or when the router cannot do via', async () => {
    const stops = viaRouter();
    await planRouteOptions(stops.providers, TBILISI, BATUMI, { alternatives: true, waypoints: [BATUMI] });
    expect(stops.calls.some((c) => c.via?.length)).toBe(false);

    const single = viaRouter();
    await planRouteOptions(single.providers, TBILISI, BATUMI, { alternatives: false });
    expect(single.calls.some((c) => c.via?.length)).toBe(false);

    const cannot = viaRouter();
    cannot.providers.routing = { ...cannot.providers.routing, capabilities: { ...cannot.providers.routing.capabilities, via: false } };
    await planRouteOptions(cannot.providers, TBILISI, BATUMI, { alternatives: true });
    expect(cannot.calls.some((c) => c.via?.length)).toBe(false);
  });

  it('after the deadline it uses what has come back and does not wait for the rest', async () => {
    const { providers: p } = viaRouter({ delayMs: 400 });
    const t0 = Date.now();
    const found = await findViaRoutes(p, tbilisiBatumiRoute(), TBILISI, BATUMI, { deadlineMs: 30 });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(found).toEqual([]);
  });

  it('stops when the trip is cancelled', async () => {
    const { providers: p } = viaRouter({ delayMs: 50 });
    const ctrl = new AbortController();
    const promise = planRouteOptions(p, TBILISI, BATUMI, { alternatives: true, signal: ctrl.signal });
    const outcome = promise.then(() => 'done', (e) => e);
    setTimeout(() => ctrl.abort(), 20);
    expect(await outcome).toMatchObject({ kind: 'aborted' });
  });

  it('after a re-route, the other roads from there include probed ones too', async () => {
    const { providers: p, calls } = viaRouter();
    const reference = tbilisiBatumiRoute();
    const roads = await planOtherRoads(p, TBILISI, BATUMI, { reference });
    expect(calls.some((c) => c.via?.length)).toBe(true);
    expect(roads).toHaveLength(1);
    vi.useRealTimers();
  });
});
