import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { simProgress } from '../algorithms/simulation';
import { timeAtDistance } from '../algorithms/routeTiming';
import { PlanSheet } from '../components/Plan/PlanSheet';
import { setProviders } from '../services/providers';
import type { RoutingProvider } from '../services/routing/RoutingProvider';
import { installFakeProviders, type Harness } from '../test/harness';
import { tbilisiBatumiDetour, tbilisiBatumiRoute } from '../test/helpers';
import type { Route } from '../types/route';
import { createTripPlan, findStopPlaces } from '../trip/planning/planner';
import { sanitizeStopPlacesRequest, sanitizeTripRequest } from '../trip/protocol';
import type { RawPlace } from '../trip/stops/places';
import type { TripPlanRequest } from '../trip/types';
import { useSettings } from './settings';
import { __resetStoreRuntime, useAppStore } from './store';
import { initTrip, longTripActive, useTripStore } from './trip';

/**
 * Long Trip Mode end to end in the app: the client classifies, asks the
 * "Worker" (the real planner behind a stubbed fetch), applies the plan's stop
 * durations to every ETA, shows the plan, loads places, and replans when late.
 */

const BASE = Date.UTC(2026, 9, 5, 4, 0); // 08:00 in Tbilisi
const initial = useAppStore.getState();
let h: Harness;
let stop: () => void;
let requests: TripPlanRequest[];
let planFails: boolean;

/** The Tbilisi → Batumi fixture road, `factor` times slower (×3 ≈ 14.7 h: a long trip). */
function slowCarRouter(factor: number): RoutingProvider {
  return {
    name: 'fake-osrm',
    capabilities: { alternatives: false, avoid: [], laneGuidance: true, matrix: false, multiStop: true },
    async calculateRoutes() {
      return [
        tbilisiBatumiRoute((raw) => {
          raw.duration *= factor;
          raw.legs[0].duration *= factor;
          raw.legs[0].annotation!.duration = raw.legs[0].annotation!.duration!.map((d) => d * factor);
          raw.legs[0].steps.forEach((s) => (s.duration *= factor));
        }),
      ];
    },
  };
}

/** A route made `factor` times slower (segments, legs and steps). */
function slowed(route: Route, factor: number): Route {
  return {
    ...route,
    durationS: route.durationS * factor,
    segments: route.segments.map((x) => ({ ...x, durationS: x.durationS * factor })),
    legs: route.legs.map((l) => ({ ...l, durationS: l.durationS * factor, steps: l.steps.map((st) => ({ ...st, durationS: st.durationS * factor })) })),
  };
}

const hotels: RawPlace[] = [
  { id: 'n/1', category: 'hotel', type: 'hotel', lat: 42.27, lon: 42.7, tags: { tourism: 'hotel', name: 'Kutaisi Hotel', stars: '3' } },
];

async function plan(factor = 1, departAtMs = BASE) {
  if (factor !== 1) h.providers.routing = slowCarRouter(factor);
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: departAtMs } });
  await useAppStore.getState().calculateRoute();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en' });
  useTripStore.getState().reset();
  h = installFakeProviders(BASE);
  requests = [];
  planFails = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url === '/api/v1/trips/plan') {
      if (planFails) return new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } });
      const req = sanitizeTripRequest(body, Date.now());
      if (!req) return Response.json({ error: 'bad-request' }, { status: 400 });
      requests.push(req);
      return Response.json(await createTripPlan(req, { places: null, nowMs: Date.now() }));
    }
    if (url === '/api/v1/trips/borders') {
      // Georgia for the first half of the points, then Turkey.
      const n = body.points.length;
      const countries = body.points.map((_: unknown, i: number) => (i < n / 2 ? { code: 'GE', name: 'Georgia' } : { code: 'TR', name: 'Turkey' }));
      return Response.json({ countries, crossings: [{ alongM: body.alongM[Math.floor(n / 2)], from: countries[0], to: countries[n - 1] }] });
    }
    if (url === '/api/v1/trips/places') {
      const req = sanitizeStopPlacesRequest(body, Date.now());
      if (!req) return Response.json({ error: 'bad-request' }, { status: 400 });
      return Response.json({ places: await findStopPlaces(req, { find: async () => hotels }) });
    }
    return new Response('not found', { status: 404 });
  });
  stop = initTrip();
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setProviders(null);
});

describe('Long Trip Mode in the app', () => {
  it('Tbilisi → Batumi (357 km, ~5 h): classified at once, standard mode, no plan asked for', async () => {
    await plan();
    await vi.waitFor(() => expect(useTripStore.getState().classification).not.toBeNull());
    const t = useTripStore.getState();
    expect(t.classification!.category).toBe('MEDIUM');
    expect(t.classification!.longTripMode).toBe(false);
    expect(longTripActive()).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('an evening departure past the latest arrival: offered, not switched on — and planned when the user asks (B-24)', async () => {
    await plan(1, Date.UTC(2026, 9, 5, 14, 27)); // 18:27 in Tbilisi: arrival 23:19, after the balanced pace's 22:00
    await vi.waitFor(() => expect(useTripStore.getState().classification?.reasons).toContain('overnight'));
    const c = useTripStore.getState().classification!;
    expect(c.category).toBe('MEDIUM');
    // A 5-hour drive never moves to the next morning by itself…
    expect(c.longTripMode).toBe(false);
    expect(longTripActive()).toBe(false);
    expect(useAppStore.getState().derived.arrivalMs).toBe(Date.UTC(2026, 9, 5, 14, 27) + useAppStore.getState().plan!.timed.totalTimeS * 1000);
    expect(requests).toHaveLength(0);
    // …but the user can turn it on, and then the stops are planned (never left "Planning stops…").
    useTripStore.getState().setOverride('on');
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    expect(requests).toHaveLength(1);
    expect(useTripStore.getState().plan!.recommendedStops.some((st) => st.kinds.includes('overnight'))).toBe(true);
  });

  it('the user can switch it on for a shorter trip: stops are planned and every ETA after them moves', async () => {
    await plan();
    const before = useAppStore.getState().derived.arrivalMs!;
    useTripStore.getState().setOverride('on');
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    const t = useTripStore.getState();
    const dwell = t.plan!.recommendedStops.reduce((a, s) => a + s.dwellMinutes, 0);
    expect(dwell).toBeGreaterThan(0);
    const after = useAppStore.getState().derived.arrivalMs!;
    expect(Math.round((after - before) / 60000)).toBe(dwell);
    // A forecast point after the first stop is matched to the later time.
    const first = t.plan!.recommendedStops[0];
    const pts = useAppStore.getState().derived.points;
    const later = pts.find((p) => p.distanceFromStartKm * 1000 > first.alongM + 1000)!;
    expect(later.arrivalMs - (BASE + timeAtDistance(useAppStore.getState().plan!.timed, later.distanceFromStartKm * 1000) * 1000)).toBeGreaterThanOrEqual(first.dwellMinutes * 60000 - 5000);
    // …and "Keep standard mode" takes it all back.
    useTripStore.getState().setOverride('off');
    expect(useAppStore.getState().derived.arrivalMs).toBe(before);
  });

  it('a long drive switches on by itself: overnight, the plan replaces the generic break reminders, planned stops become route events', async () => {
    await plan(3);
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    const t = useTripStore.getState();
    expect(t.classification!.longTripMode).toBe(true);
    expect(t.classification!.reasons).toContain('driving-time');
    expect(t.plan!.summary.overnights).toBeGreaterThanOrEqual(1);
    expect(requests[0].weather!.length).toBeGreaterThan(5); // the client's forecasts went with the request
    expect(requests[0].departAtMs).toBe(BASE);
    const events = useAppStore.getState().derived.intelligence.events;
    expect(events.some((e) => e.type === 'TRIP_STOP')).toBe(true);
    expect(events.some((e) => e.type === 'REST_BREAK')).toBe(false);
    // The first night's hotels were fetched for the dashboard, and the borders along the route.
    const night = t.plan!.recommendedStops.find((s) => s.kinds.includes('overnight'))!;
    await vi.waitFor(() => expect(useTripStore.getState().stopPlaces[night.id]?.status).toBe('ready'));
    await vi.waitFor(() => expect(useTripStore.getState().borders.status).toBe('ready'));
    expect(useTripStore.getState().borders.crossings).toHaveLength(1);
    expect(useTripStore.getState().classification!.requiresBorderCrossing).toBe(true);
  });

  it('the plan screen: banner, totals, overnight stay with hotels labelled "not checked", day-by-day timeline', async () => {
    await plan(3);
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    useAppStore.getState().setSheet('expanded');
    render(<PlanSheet />);
    expect(screen.getByText(/Long Trip Mode is on for this trip/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep standard mode' })).toBeInTheDocument();
    expect(screen.getByText('Estimated arrival')).toBeInTheDocument();
    // The detail sections load on demand (their own chunk).
    expect(await screen.findByText(/availability, prices and ratings are not checked/)).toBeInTheDocument();
    expect(screen.getAllByText('Overnight stay').length).toBeGreaterThan(0);
    expect(screen.getByText('Day 1', { exact: false })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getAllByText(/Georgia → Turkey/).length).toBeGreaterThan(0));
    expect(screen.queryByText('When to leave')).toBeNull(); // no 12-hour comparison for a multi-day trip
  });

  it('a new departure time asks for a new plan; a failed request leaves ETAs without planned stops and says so', async () => {
    await plan(3);
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    useAppStore.getState().setDeparture({ mode: 'at', utcMs: BASE + 3 * 3600_000 });
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));
    expect(requests.at(-1)!.departAtMs).toBe(BASE + 3 * 3600_000);

    useTripStore.getState().reset();
    planFails = true;
    await plan(3);
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('error'));
    expect(useTripStore.getState().error).toBe('unavailable');
    const nonstop = BASE + useAppStore.getState().plan!.timed.totalTimeS * 1000;
    expect(useAppStore.getState().derived.arrivalMs).toBe(nonstop);
  });

  it('replans from the car when a real drive falls well behind the plan', async () => {
    useSettings.getState().update({ fuelRangeKm: 300 });
    await plan(3);
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    const timed = useAppStore.getState().plan!.timed;
    const along = 60_000;
    const modelTimeS = timeAtDistance(timed, along);
    vi.setSystemTime(BASE + (modelTimeS + 2 * 3600) * 1000); // two hours late at km 60
    const progress = simProgress(timed, { nowMs: Date.now(), modelTimeS, distanceM: along, arrived: false } as never);
    useAppStore.setState({ mode: 'navigating', progress });
    await vi.waitFor(() => expect(requests.length).toBe(2));
    const replan = requests[1];
    expect(replan.progress!.alongM).toBe(along);
    expect(replan.progress!.drivenTodayS).toBeGreaterThan(0);
    // The range used on the way is subtracted, not reset to what the trip started with (B-01).
    expect(replan.progress!.rangeKm).toBeCloseTo(240, 0);
    await vi.waitFor(() => expect(useTripStore.getState().plan!.progress?.alongM).toBe(along));
  });

  it('"Stay in X instead" re-plans with the chosen night', async () => {
    await plan(3);
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    const night = useTripStore.getState().plan!.recommendedStops.find((s) => s.kinds.includes('overnight'))!;
    useTripStore.getState().chooseOvernight(night.id, night.alongM - 20_000);
    await vi.waitFor(() => expect(requests.length).toBe(2));
    expect(requests[1].overnightsM).toEqual([night.alongM - 20_000]);
    await vi.waitFor(() => expect(useTripStore.getState().plan!.recommendedStops.find((s) => s.kinds.includes('overnight'))!.alongM).toBe(night.alongM - 20_000));
  });

  it('picking another road keeps Long Trip Mode: a new plan for that road at once (its forecasts are already loaded)', async () => {
    h.providers.routing = {
      name: 'fake-osrm',
      capabilities: { alternatives: true, avoid: [], laneGuidance: true, matrix: false, multiStop: true },
      async calculateRoutes() {
        return [slowed(tbilisiBatumiRoute(), 3), slowed(tbilisiBatumiDetour(0.3, 0.7, 0.3, 1.15), 3)];
      },
    };
    await plan();
    await vi.waitFor(() => expect(useTripStore.getState().status).toBe('ready'));
    expect(useAppStore.getState().routeOptions.length).toBeGreaterThan(1);
    const first = useTripStore.getState().plan!.routeId;
    await useAppStore.getState().selectRouteOption(1);
    await vi.waitFor(() => expect(useTripStore.getState().plan?.routeId).toBe(useAppStore.getState().plan!.timed.route.id));
    expect(useTripStore.getState().plan!.routeId).not.toBe(first);
    // The chosen road's card shows its times with the planned stops; arrival matches the dashboard.
    const card = useAppStore.getState().derived.options.find((o) => o.index === 1)!;
    expect(card.arrivalMs).toBe(useAppStore.getState().derived.arrivalMs);
  });
});
