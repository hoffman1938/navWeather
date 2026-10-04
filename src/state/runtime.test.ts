import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../services/providers';
import type { Incident, IncidentProvider } from '../services/traffic/IncidentProvider';
import { installFakeProviders, type Harness } from '../test/harness';
import type { LngLat } from '../types/geo';
import { useSettings } from './settings';
import { __devRerouteFrom, __resetStoreRuntime, useAppStore } from './store';

/**
 * The real-time loop's costs: weather and events re-derived at most once a second on a real drive (B-10), forecasts
 * kept only for the trip's roads (B-11), and no driver-report requests from a simulated drive (DP-1.10).
 */

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initialState = useAppStore.getState();
let h: Harness;
let listCalls: number;

const along = (km: number): LngLat => {
  const t = useAppStore.getState().plan!.timed;
  let i = 0;
  while (i < t.cumDistM.length - 1 && t.cumDistM[i] < km * 1000) i++;
  return t.route.geometry[i];
};

async function plan(from = 'Tbilisi', to = 'Batumi') {
  const s = useAppStore.getState();
  s.setOriginText(from);
  s.setDestinationText(to);
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initialState, true);
  useSettings.getState().reset();
  h = installFakeProviders(BASE);
  listCalls = 0;
  const reports: IncidentProvider = {
    name: 'reports',
    async getIncidents(): Promise<Incident[]> {
      listCalls++;
      return [];
    },
  };
  h.providers.incidents = reports;
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('real-time loop costs', () => {
  it('a real drive re-derives weather and events at most once a second, however often the GPS reports (B-10)', async () => {
    await plan();
    useAppStore.getState().startNavigation();
    const derivedSeen = new Set<unknown>();
    // A 10 Hz GPS for one second: 10 fixes, 100 ms apart.
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(Date.now() + 100);
      useAppStore.getState().handlePosition({ coordinate: along(0.2 + i * 0.003), accuracyM: 5, speedMps: 25, timestampMs: Date.now() });
      derivedSeen.add(useAppStore.getState().derived);
    }
    expect(derivedSeen.size).toBeLessThanOrEqual(2);
    // A second later the next fix is due again.
    const before = useAppStore.getState().derived;
    vi.setSystemTime(Date.now() + 1500);
    useAppStore.getState().handlePosition({ coordinate: along(0.3), accuracyM: 5, speedMps: 25, timestampMs: Date.now() });
    expect(useAppStore.getState().derived).not.toBe(before);
  });

  it('forecasts are kept only for the trip on screen, not every route planned in the session (B-11)', async () => {
    await plan();
    const first = useAppStore.getState().forecasts.size;
    expect(first).toBeGreaterThan(0);
    // Another trip: only its own forecasts remain (the fake road is the same, so plan it from a point along it).
    const s = useAppStore.getState();
    const keyOf = (c: LngLat) => h.providers.weather.keyFor(c[1], c[0]);
    const firstKeys = new Set(s.plan!.samples.map((x) => keyOf(x.coordinate)));
    useAppStore.getState().clearRoute();
    await plan('Tbilisi', 'Batumi');
    const needed = new Set([...useAppStore.getState().plan!.samples, ...useAppStore.getState().routeOptions.flatMap((o) => o.samples)].map((x) => keyOf(x.coordinate)));
    for (const k of useAppStore.getState().forecasts.keys()) expect(needed.has(k)).toBe(true);
    expect(firstKeys.size).toBeGreaterThan(0);
    // A forecast left over from elsewhere is dropped at the next load.
    const stray = new Map(useAppStore.getState().forecasts);
    const any = [...stray.values()][0];
    stray.set('stray-cell', { ...any });
    useAppStore.setState({ forecasts: stray });
    await useAppStore.getState().loadWeather({ reason: 'manual' });
    expect(useAppStore.getState().forecasts.has('stray-cell')).toBe(false);
  });

  it('a simulated drive asks the reports relay for nothing, even after a re-route or a long while (DP-1.10)', async () => {
    await plan();
    await vi.waitFor(() => expect(listCalls).toBe(1)); // planning shows real reports on the route
    useAppStore.getState().startSimulation();
    vi.setSystemTime(Date.now() + 10 * 60_000); // past the 5-minute refresh
    useAppStore.getState().simulationSkip(20 * 60);
    await __devRerouteFrom(along(60));
    useAppStore.getState().simulationSkip(20 * 60);
    expect(listCalls).toBe(1);
  });
});
