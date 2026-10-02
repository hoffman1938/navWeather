import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../services/providers';
import { installFakeProviders, type Harness } from '../test/harness';
import { tbilisiBatumiDetour } from '../test/helpers';
import type { LngLat } from '../types/geo';
import { bearingDeg } from '../utils/distance';
import { useSettings } from './settings';
import { __resetStoreRuntime, useAppStore } from './store';

/**
 * Driving with several roads to the destination: the driver takes another
 * road we know → carry on along it at once; the driver turns onto a road we
 * don't know → new directions from there, plus the other roads from there.
 * Tbilisi → Batumi, with a second road that swings far north after 30 % of the way.
 */

const BASE = Date.UTC(2026, 8, 26, 4, 0); // 08:00 in Tbilisi
const FORK = 0.3;
const initial = useAppStore.getState();
let h: Harness;

const alt = () => tbilisiBatumiDetour(FORK, 0.7, 0.5, 1.15);

async function plan() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

let clock = BASE;
/** One GPS fix, 3 s after the last one (the clock moves with it, as it does on a real drive). */
function fix(coordinate: LngLat, headingDeg: number | undefined, accuracyM = 8) {
  clock += 3000;
  vi.setSystemTime(clock);
  useAppStore.getState().handlePosition({ coordinate, headingDeg, accuracyM, speedMps: 28, timestampMs: clock });
}

/**
 * Drive along a road's own vertices (≈ 90 m apart), heading as the road runs.
 * `step` vertices per fix (and that many times 3 s between fixes), so a long
 * stretch needs few fixes.
 */
function driveAlong(road: { timed: { route: { geometry: LngLat[] } } }, from: number, to: number, withHeading = true, step = 1) {
  const g = road.timed.route.geometry;
  for (let i = from; i <= to; i += step) {
    clock += 3000 * (step - 1); // fix() adds the last 3 s
    fix(g[i], withHeading ? bearingDeg(g[i], g[Math.min(i + 1, g.length - 1)]) : undefined);
  }
}

const forkIndex = () => Math.round(FORK * (useAppStore.getState().routeOptions[0].timed.route.geometry.length - 1));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = BASE - 10 * 60000;
  vi.setSystemTime(clock);
  __resetStoreRuntime();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
  h = installFakeProviders(BASE);
  // Rain only far in the north — only the northern road runs into it.
  h.weather.hourFn = (lat, _lon, hourMs) => {
    const raining = lat > 42.4 && hourMs - BASE >= 3600_000;
    return { temperature: 18, code: raining ? 63 : 1, precipitation: raining ? 1.5 : 0, precipitationProbability: raining ? 80 : 5 };
  };
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('the driver takes another road we know', () => {
  async function driveToTheFork() {
    h.alternativeRoads.push(alt());
    await plan();
    useAppStore.getState().startNavigation();
    const [main] = useAppStore.getState().routeOptions;
    driveAlong(main, 0, forkIndex() - 4, true, 40);
    expect(useAppStore.getState().plan!.timed).toBe(main.timed);
    expect(useAppStore.getState().deviation.status).toBe('on-route');
  }

  it('carries on along it at once — no new route request, nothing to wait for', async () => {
    await driveToTheFork();
    const calls = h.routingCalls.length;
    const [main, other] = useAppStore.getState().routeOptions;
    driveAlong(other, forkIndex() - 3, forkIndex() + 30);

    const s = useAppStore.getState();
    expect(s.plan!.timed).toBe(other.timed);
    expect(s.selectedOption).toBe(1);
    expect(s.routeOptions[0].timed).toBe(main.timed); // both roads stay known
    expect(h.routingCalls.length).toBe(calls); // nobody was asked anything
    expect(s.recalculating).toBe(false);
    expect(s.deviation.status).toBe('on-route');
    expect(s.progress!.distanceFromRouteM).toBeLessThan(30);
    expect(h.tts.spoken).toContain('Route updated.');
    expect(s.notice?.text).toBe('Route updated');
  });

  it('shows the weather of the road it is on from then on, and the time it will get there', async () => {
    await driveToTheFork();
    const [, other] = useAppStore.getState().routeOptions;
    driveAlong(other, forkIndex() - 3, forkIndex() + 30);
    const s = useAppStore.getState();
    const upcoming = s.derived.upcoming;
    expect(upcoming.length).toBeGreaterThan(5);
    expect(upcoming.every((p) => p.weather !== null)).toBe(true);
    expect(upcoming.every((p) => p.id.startsWith(other.timed.route.id))).toBe(true);
    // The northern road runs into rain; the weather alerts now talk about THIS road.
    expect(upcoming.some((p) => p.weather!.condition === 'RAIN')).toBe(true);
    // ETA = now + what is left of this road.
    expect(s.derived.arrivalMs).toBeCloseTo(s.progress!.etaMs, -3);
    expect(s.progress!.etaMs).toBeGreaterThan(clock + 3 * 3600_000);
  });

  it('adds place names and elevation to that road afterwards, keeping the same road object', async () => {
    await driveToTheFork();
    const [, other] = useAppStore.getState().routeOptions;
    expect(other.warnings).toContain('not-enriched');
    driveAlong(other, forkIndex() - 3, forkIndex() + 30);
    await vi.waitFor(() => expect(useAppStore.getState().plan!.warnings).not.toContain('not-enriched'));
    const s = useAppStore.getState();
    expect(s.plan!.timed).toBe(other.timed);
    expect(s.routeOptions[1]).toBe(s.plan);
    expect(s.plan!.places.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(s.weatherStatus === 'ready' || useAppStore.getState().weatherStatus === 'ready').toBe(true));
  });

  it('works without a connection', async () => {
    await driveToTheFork();
    useAppStore.getState().setOnline(false);
    const calls = h.routingCalls.length;
    const [, other] = useAppStore.getState().routeOptions;
    driveAlong(other, forkIndex() - 3, forkIndex() + 30);
    expect(useAppStore.getState().plan!.timed).toBe(other.timed);
    expect(h.routingCalls.length).toBe(calls);
  });

  it('does not mistake crossing the other road for taking it (the heading disagrees)', async () => {
    await driveToTheFork();
    const [main, other] = useAppStore.getState().routeOptions;
    const g = other.timed.route.geometry;
    const i = forkIndex() + 20;
    // Park the car on the other road but pointing across it, then leave the main road.
    const across = bearingDeg(g[i], g[i + 1]) + 90;
    for (let k = 0; k < 6; k++) fix(g[i], across);
    expect(useAppStore.getState().plan!.timed).toBe(main.timed);
    expect(useAppStore.getState().selectedOption).toBe(0);
  });

  it('plans a new route instead when the car has no heading (it is not moving)', async () => {
    await driveToTheFork();
    const calls = h.routingCalls.length;
    const [, other] = useAppStore.getState().routeOptions;
    driveAlong(other, forkIndex() - 3, forkIndex() + 30, false);
    await vi.waitFor(() => expect(h.routingCalls.length).toBeGreaterThan(calls));
    expect(h.routingCalls.at(-1)!.origin.name).toBe('Your location');
  });
});

describe('other roads while driving', () => {
  it('lists the roads the car can still take, each with its own forecast — until the fork is passed', async () => {
    h.alternativeRoads.push(alt());
    await plan();
    useAppStore.getState().startNavigation();
    const [main] = useAppStore.getState().routeOptions;
    driveAlong(main, 0, forkIndex() - 20, true, 40);

    let { otherRoads } = useAppStore.getState().derived;
    expect(otherRoads).toHaveLength(1);
    const north = otherRoads[0];
    expect(north.index).toBe(1);
    expect(north.deltaS).toBeGreaterThan(10 * 60); // it is the slower road
    expect(north.forecast).not.toBeNull();
    expect(north.forecast!.ribbon.some((seg) => seg.groupClass === 'rain')).toBe(true); // …into the rain
    expect(north.wetMinutes).toBeGreaterThan(20);
    // It is the road ahead, from here — not the whole trip again.
    const along = useAppStore.getState().progress!.distanceAlongM;
    const northTotal = useAppStore.getState().routeOptions[1].timed.totalDistM;
    expect(along).toBeGreaterThan(50_000);
    expect(Math.abs(north.distanceM - (northTotal - along))).toBeLessThan(1000);

    driveAlong(main, forkIndex() - 19, forkIndex() + 40, true, 3); // past the fork, on the main road
    expect(useAppStore.getState().plan!.timed).toBe(main.timed);
    otherRoads = useAppStore.getState().derived.otherRoads;
    expect(otherRoads).toHaveLength(0);
  });

  it('lets the driver switch to one of them: the car carries on along it from where it is', async () => {
    h.alternativeRoads.push(alt());
    await plan();
    useAppStore.getState().startNavigation();
    const [main, other] = useAppStore.getState().routeOptions;
    driveAlong(main, 0, forkIndex() - 20, true, 40);
    const calls = h.routingCalls.length;
    const before = useAppStore.getState();

    useAppStore.getState().switchToRoad(1);
    const s = useAppStore.getState();
    expect(s.plan!.timed).toBe(other.timed);
    expect(s.selectedOption).toBe(1);
    expect(h.routingCalls.length).toBe(calls);
    expect(s.vehicle!.coordinate).toEqual(before.vehicle!.coordinate);
    expect(s.progress!.distanceFromRouteM).toBeLessThan(30);
    // Both roads are the same one until the fork, so the car is as far along as it was.
    expect(Math.abs(s.progress!.distanceAlongM - before.progress!.distanceAlongM)).toBeLessThan(150);
    // …and the road it left is now the other road to take.
    expect(s.derived.otherRoads.map((r) => r.index)).toEqual([0]);

    driveAlong(other, forkIndex() - 19, forkIndex() + 40);
    expect(useAppStore.getState().plan!.timed).toBe(other.timed);
    expect(useAppStore.getState().deviation.status).toBe('on-route');
  });

  it('ignores a request for the road already being driven or one that does not exist', async () => {
    h.alternativeRoads.push(alt());
    await plan();
    useAppStore.getState().startNavigation();
    const [main] = useAppStore.getState().routeOptions;
    driveAlong(main, 0, 10);
    useAppStore.getState().switchToRoad(0);
    useAppStore.getState().switchToRoad(7);
    expect(useAppStore.getState().plan!.timed).toBe(main.timed);
    // Before the planning screen: nothing to switch.
    useAppStore.getState().stopNavigation();
    useAppStore.getState().switchToRoad(1);
    expect(useAppStore.getState().plan!.timed).toBe(main.timed);
  });

  it('also switches roads in a simulated drive, from where the simulated car is', async () => {
    h.alternativeRoads.push(alt());
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    for (let k = 0; k < 60; k++) useAppStore.getState().advanceSimulationBy(500); // 30 sim-min ≈ 12 % of the way
    const before = useAppStore.getState();
    const along = before.progress!.distanceAlongM;
    expect(along / before.plan!.timed.totalDistM).toBeGreaterThan(0.05);
    expect(along / before.plan!.timed.totalDistM).toBeLessThan(0.25);
    expect(before.derived.otherRoads).toHaveLength(1);

    useAppStore.getState().switchToRoad(1);
    const after = useAppStore.getState();
    expect(after.mode).toBe('simulating');
    expect(after.plan!.timed).toBe(after.routeOptions[1].timed);
    expect(Math.abs(after.progress!.distanceAlongM - along)).toBeLessThan(120);
    expect(after.sim.modelTimeS).toBeCloseTo(after.progress!.modelTimeS, 3);
    for (let k = 0; k < 20; k++) useAppStore.getState().advanceSimulationBy(500);
    expect(useAppStore.getState().progress!.distanceAlongM).toBeGreaterThan(after.progress!.distanceAlongM + 1000);
    expect(useAppStore.getState().plan!.timed).toBe(after.plan!.timed);
  });
});

describe('the driver turns onto a road we do not know', () => {
  /** A detour from wherever the new directions start: leaves the new route at 55 % and rejoins at 85 %. */
  const detourFromHere = (req: { origin: { coordinate: LngLat } }) => [tbilisiBatumiDetour(0.55, 0.85, 0.5, 1.2, req.origin.coordinate)];

  async function goOffRoad() {
    h.alternativeRoads.push(alt());
    h.rerouteAlternatives = detourFromHere;
    await plan();
    useAppStore.getState().startNavigation();
    const [main] = useAppStore.getState().routeOptions;
    driveAlong(main, 0, forkIndex() - 20, true, 40);
    // 600 m south of the road — a road neither of ours runs along.
    const g = main.timed.route.geometry;
    const i = forkIndex() - 20;
    const off: LngLat = [g[i][0], g[i][1] - 0.0055];
    for (let k = 0; k < 4; k++) fix(off, 180);
    return off;
  }

  it('makes new directions from there, and keeps the old plan out of it', async () => {
    const off = await goOffRoad();
    expect(useAppStore.getState().recalculating).toBe(true);
    await vi.waitFor(() => expect(useAppStore.getState().recalculating).toBe(false));
    const s = useAppStore.getState();
    expect(h.routingCalls.at(-1)!.origin.coordinate).toEqual(off);
    expect(h.routingCalls.at(-1)!.startBearingDeg).toBe(180);
    expect(s.plan!.timed.route.origin.name).toBe('Your location');
    expect(s.deviation.status).toBe('on-route');
    expect(h.tts.spoken).toContain('Route updated.');
  });

  it('then offers the other roads from there, with their forecast', async () => {
    await goOffRoad();
    // First the new directions replace the old plan (one road)…
    await vi.waitFor(() => expect(useAppStore.getState().plan!.timed.route.origin.name).toBe('Your location'));
    // …then the other roads from there arrive.
    await vi.waitFor(() => expect(useAppStore.getState().routeOptions).toHaveLength(2));
    expect(useAppStore.getState().routeOptions[1].timed).not.toBe(useAppStore.getState().plan!.timed);
    // From the new place: first the directions (one road, quickly), then — separately — the other roads.
    const fromHere = h.routingCalls.filter((c) => c.origin.name === 'Your location');
    expect(fromHere[0].alternatives).toBe(false);
    expect(fromHere.some((c) => c.alternatives === true)).toBe(true);
    await vi.waitFor(() => expect(useAppStore.getState().derived.otherRoads).toHaveLength(1));
    await vi.waitFor(() => expect(useAppStore.getState().derived.otherRoads[0].forecast).not.toBeNull());
    const [other] = useAppStore.getState().derived.otherRoads;
    expect(other.index).toBe(1);
    expect(other.deltaS).toBeGreaterThan(0);
    expect(other.forecast!.ribbon.some((seg) => seg.groupClass === 'rain')).toBe(true);
    expect(other.forecast!.stops.length).toBeGreaterThanOrEqual(2);
    expect(useAppStore.getState().plan).toBe(useAppStore.getState().routeOptions[0]);
  });

  it('keeps those roads available only until the car passes where they leave', async () => {
    await goOffRoad();
    await vi.waitFor(() => expect(useAppStore.getState().derived.otherRoads).toHaveLength(1));
    const route = useAppStore.getState().plan!;
    const last = route.timed.route.geometry.length - 1;
    // The new route starts ≈ 25 % into the trip, so the other road (which leaves at 55 %) leaves it at ≈ 40 %.
    driveAlong(route, 1, Math.round(0.3 * last), true, 40);
    expect(useAppStore.getState().plan!.timed).toBe(route.timed);
    expect(useAppStore.getState().derived.otherRoads).toHaveLength(1); // the fork is still ahead
    driveAlong(route, Math.round(0.3 * last) + 1, Math.round(0.5 * last), true, 40);
    expect(useAppStore.getState().plan!.timed).toBe(route.timed);
    expect(useAppStore.getState().derived.otherRoads).toHaveLength(0); // the fork is behind
  });

  it('does not wait for the other roads: the new directions come first, and a failure there is harmless', async () => {
    h.alternativeRoads.push(alt());
    await plan();
    useAppStore.getState().startNavigation();
    const [main] = useAppStore.getState().routeOptions;
    driveAlong(main, 0, forkIndex() - 20, true, 40);
    const g = main.timed.route.geometry;
    const i = forkIndex() - 20;
    // The request for the other roads blows up.
    h.rerouteAlternatives = () => {
      throw new Error('router down');
    };
    for (let k = 0; k < 4; k++) fix([g[i][0], g[i][1] - 0.0055], 180);
    await vi.waitFor(() => expect(useAppStore.getState().recalculating).toBe(false));
    await vi.waitFor(() => expect(useAppStore.getState().weatherStatus).toBe('ready'));
    const s = useAppStore.getState();
    expect(s.plan!.timed.route.origin.name).toBe('Your location');
    expect(s.routeOptions).toHaveLength(1);
    expect(s.derived.otherRoads).toEqual([]);
  });
});
