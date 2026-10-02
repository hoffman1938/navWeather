import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providersForMode } from '../services/providers';
import { setProviders } from '../services/providers';
import type { SpeedLimitProvider } from '../services/speed/SpeedLimitProvider';
import { installFakeProviders, type Harness } from '../test/harness';
import { useSettings } from './settings';
import { __resetStoreRuntime, useAppStore } from './store';

/** Car, walking, bicycle, flight (an estimate) and public transport (timetabled) on Tbilisi → Batumi. */

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initial = useAppStore.getState();
let h: Harness;
let speedCalls = 0;

async function plan() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initial, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en' });
  h = installFakeProviders(BASE);
  speedCalls = 0;
  const speed: SpeedLimitProvider = {
    name: 'fake-osm',
    async getSpeedLimits() {
      speedCalls++;
      return [];
    },
    async getSpeedCameras() {
      speedCalls++;
      return [];
    },
    async getLevelCrossings() {
      speedCalls++;
      return [];
    },
  };
  h.providers.speedLimits = speed;
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('providersForMode', () => {
  it('the car uses the app\'s router; walking and cycling their own', () => {
    expect(providersForMode(h.providers, 'drive')).toBe(h.providers);
    expect(providersForMode(h.providers, 'walk')!.routing.name).toBe('fake-walk');
    expect(providersForMode(h.providers, 'bike')!.routing.name).toBe('fake-bike');
  });

  it('a flight has no places, elevation, speed limits or road data along it', () => {
    const p = providersForMode(h.providers, 'flight')!;
    expect(p.routing.name).toBe('flight-estimate');
    expect([p.places, p.elevation, p.poi, p.speedLimits]).toEqual([null, null, null, null]);
    expect(p.weather).toBe(h.providers.weather); // the weather is still the app's
  });

  it('public transport has its own (timetable) router, and no speed limits or fuel stops along it', () => {
    const p = providersForMode(h.providers, 'transit')!;
    expect(p.routing.name).toBe('fake-transit');
    expect([p.poi, p.speedLimits]).toEqual([null, null]);
    expect(p.places).toBe(h.providers.places); // towns along the way still name the forecast stops
  });

  it('public transport switched off (no timetable service) has no router', () => {
    delete h.providers.routingByMode!.transit;
    expect(providersForMode(h.providers, 'transit')).toBeNull();
  });
});

describe('planning the trip another way', () => {
  it('starts as a car trip', async () => {
    expect(useAppStore.getState().travelMode).toBe('drive');
    await plan();
    expect(h.routingCalls).toHaveLength(1);
    expect(h.modeCalls.walk).toHaveLength(0);
  });

  it('walking is planned by the walking router, never the car router, with the weather at the walker\'s own times', async () => {
    useAppStore.getState().setTravelMode('walk');
    await plan();
    const s = useAppStore.getState();
    expect(h.modeCalls.walk).toHaveLength(1);
    expect(h.routingCalls).toHaveLength(0);
    expect(s.plan!.timed.totalTimeS / 3600).toBeGreaterThan(40); // 9× the 4.9 h drive
    expect(s.derived.points.every((p) => p.weather !== null)).toBe(true);
    // The weather follows the (much slower) timing: the last stop is a day and a half after the first.
    const first = s.derived.points[0].arrivalMs;
    expect(s.derived.points.at(-1)!.arrivalMs - first).toBeGreaterThan(40 * 3600_000);
  });

  it('changing the mode with a trip on screen shows the trip that way at once', async () => {
    await plan();
    const carDuration = useAppStore.getState().plan!.timed.totalTimeS;
    useAppStore.getState().setTravelMode('bike');
    await vi.waitFor(() => expect(h.modeCalls.bike).toHaveLength(1));
    await vi.waitFor(() => expect(useAppStore.getState().routeStatus).toBe('ready'));
    const s = useAppStore.getState();
    expect(s.travelMode).toBe('bike');
    expect(s.plan!.timed.totalTimeS).toBeCloseTo(carDuration * 3, -2);
    // …and back to the car.
    useAppStore.getState().setTravelMode('drive');
    await vi.waitFor(() => expect(h.routingCalls).toHaveLength(2));
    await vi.waitFor(() => expect(useAppStore.getState().plan!.timed.totalTimeS).toBeCloseTo(carDuration, -2));
  });

  it('with nothing planned yet, only remembers the mode for Go', () => {
    useAppStore.getState().setTravelMode('walk');
    expect(useAppStore.getState().travelMode).toBe('walk');
    expect(h.modeCalls.walk).toHaveLength(0);
    expect(useAppStore.getState().plan).toBeNull();
  });

  it('a flight is the straight line with an estimated time, and no road data was asked for', async () => {
    useAppStore.getState().setTravelMode('flight');
    await plan();
    const s = useAppStore.getState();
    expect(s.plan!.timed.route.provider).toBe('flight-estimate');
    expect(s.plan!.timed.totalDistM / 1000).toBeGreaterThan(250);
    expect(s.plan!.timed.totalDistM / 1000).toBeLessThan(280); // the straight line, not 357 km of road
    expect(s.plan!.timed.totalTimeS / 60).toBeLessThan(60);
    expect(s.plan!.places).toEqual([]);
    expect(h.routingCalls).toHaveLength(0);
    // Weather at the departure and arrival times is still there.
    expect(s.derived.points[0].weather).not.toBeNull();
    expect(s.derived.points.at(-1)!.weather).not.toBeNull();
  });

  it('a flight cannot be started as navigation, or simulated: it is a plan', async () => {
    useAppStore.getState().setTravelMode('flight');
    await plan();
    await useAppStore.getState().requestNavigation();
    useAppStore.getState().startSimulation();
    expect(useAppStore.getState().mode).toBe('planning');
    expect(useAppStore.getState().locationPrimer).toBe(false);
  });

  it('public transport is planned on the timetable from the chosen departure, and the weather follows its times', async () => {
    useAppStore.getState().setTravelMode('transit');
    await plan();
    const s = useAppStore.getState();
    expect(h.modeCalls.transit).toHaveLength(1);
    expect(h.modeCalls.transit[0].departAtMs).toBe(BASE);
    expect(h.routingCalls).toHaveLength(0); // never the car router
    const trip = s.plan!.timed.route.transit!;
    expect(trip.legs.map((l) => [l.vehicle, l.line ?? ''])).toEqual([['walk', ''], ['rail', '871'], ['walk', '']]);
    expect(trip.legs[1]).toMatchObject({ fromName: 'Tbilisi Central', toName: 'Batumi Central', color: '#c62828', stops: 2 });
    // The trip starts when its timetable says (12 min after the chosen time), not at the chosen time…
    expect(trip.departMs).toBe(BASE + 12 * 60_000);
    expect(s.derived.departureMs).toBe(trip.departMs);
    expect(s.derived.points[0].arrivalMs).toBe(trip.departMs);
    // …and ends exactly at the timetabled arrival.
    expect(s.derived.arrivalMs).toBe(trip.arriveMs);
    expect(s.derived.points.at(-1)!.arrivalMs).toBe(trip.arriveMs);
    expect(s.derived.points.every((p) => p.weather !== null)).toBe(true);
  });

  it('each departure is an option of its own (none dropped as a copy of the same road), timed from its own start', async () => {
    useAppStore.getState().setTravelMode('transit');
    await plan();
    const s = useAppStore.getState();
    expect(s.routeOptions.map((o) => o.timed.route.transit!.legs[1].line)).toEqual(['871', '873']);
    const later = s.routeOptions[1].timed.route.transit!;
    expect(s.derived.options[1].arrivalMs).toBe(later.arriveMs);
    await useAppStore.getState().selectRouteOption(1);
    expect(useAppStore.getState().derived.departureMs).toBe(later.departMs);
  });

  it('another departure time asks the timetable again (it is another trip, not the same one later)', async () => {
    useAppStore.getState().setTravelMode('transit');
    await plan();
    useAppStore.getState().setDeparture({ mode: 'at', utcMs: BASE + 3 * 3600_000 });
    await vi.waitFor(() => expect(h.modeCalls.transit).toHaveLength(2));
    expect(h.modeCalls.transit[1].departAtMs).toBe(BASE + 3 * 3600_000);
    await vi.waitFor(() => expect(useAppStore.getState().plan!.timed.route.transit!.departMs).toBe(BASE + 3 * 3600_000 + 12 * 60_000));
  });

  it('no public transport found: says so plainly, and leaves no trip of another mode on the map under its label', async () => {
    await plan();
    h.transit.found = false;
    useAppStore.getState().setTravelMode('transit');
    await vi.waitFor(() => expect(useAppStore.getState().routeStatus).toBe('error'));
    const s = useAppStore.getState();
    expect(s.plan).toBeNull();
    expect(s.routeError).toMatch(/No public transport found/);
    // Choosing a real mode again brings the trip back, without retyping.
    useAppStore.getState().setTravelMode('drive');
    await vi.waitFor(() => expect(useAppStore.getState().plan).not.toBeNull());
    expect(useAppStore.getState().routeError).toBeNull();
  });

  it('public transport switched off says so — and shows no road trip under that label', async () => {
    delete h.providers.routingByMode!.transit;
    await plan();
    useAppStore.getState().setTravelMode('transit');
    const s = useAppStore.getState();
    expect(s.plan).toBeNull();
    expect(s.routeStatus).toBe('error');
    expect(s.routeError).toMatch(/Public transport is switched off/);
    expect(h.routingCalls).toHaveLength(1); // nothing new was asked of any router
  });

  it('a public-transport trip cannot be started as navigation, or simulated: it is a plan', async () => {
    useAppStore.getState().setTravelMode('transit');
    await plan();
    await useAppStore.getState().requestNavigation();
    useAppStore.getState().startSimulation();
    expect(useAppStore.getState().mode).toBe('planning');
  });

  it('the mode cannot change while navigating', async () => {
    await plan();
    useAppStore.getState().startSimulation();
    useAppStore.getState().setTravelMode('walk');
    expect(useAppStore.getState().travelMode).toBe('drive');
  });
});

describe('what only drivers get', () => {
  async function drive(mode: 'drive' | 'walk') {
    useSettings.getState().update({ speedCameras: true, speedWarnings: true, roadHazards: true, breakReminders: true });
    useAppStore.getState().setTravelMode(mode);
    await plan();
    useAppStore.getState().setSimulationSpeed(60);
    useAppStore.getState().startSimulation();
    await vi.waitFor(() => expect(useAppStore.getState().mode).toBe('simulating'));
  }

  it('a drive loads speed limits, cameras and crossings, and suggests breaks', async () => {
    await drive('drive');
    await vi.waitFor(() => expect(speedCalls).toBeGreaterThanOrEqual(3));
    expect(useAppStore.getState().derived.intelligence.events.some((e) => e.type === 'REST_BREAK')).toBe(true);
  });

  it('a walk asks for none of that: no speed limits, cameras, crossings, curves or driving breaks', async () => {
    await drive('walk');
    await new Promise((r) => setTimeout(r, 30));
    expect(speedCalls).toBe(0);
    expect(useAppStore.getState().roadHazards).toEqual([]);
    expect(useAppStore.getState().derived.intelligence.events.some((e) => e.type === 'REST_BREAK')).toBe(false);
  });
});
