import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../services/providers';
import type { SpeedLimitProvider } from '../services/speed/SpeedLimitProvider';
import { installFakeProviders } from '../test/harness';
import type { LngLat } from '../types/geo';
import { useSettings } from './settings';
import { __devRerouteFrom, __resetStoreRuntime, loadDriveExtras, useAppStore } from './store';

/** Speed limits, cameras and road hazards: loaded per drive, per setting, and never carried to a new route. */

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initialState = useAppStore.getState();
let calls: { limits: number; cameras: number; crossings: number };

const along = (km: number): LngLat => {
  const t = useAppStore.getState().plan!.timed;
  let i = 0;
  while (i < t.cumDistM.length - 1 && t.cumDistM[i] < km * 1000) i++;
  return t.route.geometry[i];
};

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
  useAppStore.setState(initialState, true);
  useSettings.getState().reset();
  const h = installFakeProviders(BASE);
  calls = { limits: 0, cameras: 0, crossings: 0 };
  const speed: SpeedLimitProvider = {
    name: 'fake-osm',
    async getSpeedLimits() {
      calls.limits++;
      return [];
    },
    async getSpeedCameras(route) {
      calls.cameras++;
      // One camera on whichever route is asked about, 60 % of the way along.
      return [{ id: `cam-${calls.cameras}`, coordinate: route[Math.floor(route.length * 0.6)], kmh: 90 }];
    },
    async getLevelCrossings() {
      calls.crossings++;
      return [];
    },
  };
  h.providers.speedLimits = speed;
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('drive extras', () => {
  it('cameras load when enabled even with speed-limit warnings off', async () => {
    useSettings.getState().update({ speedWarnings: false, speedCameras: true });
    await plan();
    useAppStore.getState().startSimulation();
    await vi.waitFor(() => expect(useAppStore.getState().speedCameras).toHaveLength(1));
    expect(calls.limits).toBe(0);
  });

  it('switching cameras on mid-drive loads them now, once per route', async () => {
    useSettings.getState().update({ speedCameras: false }); // cameras are on by default; this driver turned them off
    await plan();
    useAppStore.getState().startSimulation();
    expect(calls.cameras).toBe(0);
    useSettings.getState().update({ speedCameras: true });
    loadDriveExtras(); // what Settings does on the toggle
    await vi.waitFor(() => expect(useAppStore.getState().speedCameras).toHaveLength(1));
    loadDriveExtras();
    expect(calls.cameras).toBe(1);
  });

  it('a re-route never keeps cameras placed on the old route', async () => {
    useSettings.getState().update({ speedCameras: true });
    await plan();
    useAppStore.getState().startSimulation();
    await vi.waitFor(() => expect(useAppStore.getState().speedCameras).toHaveLength(1));
    const oldCam = useAppStore.getState().speedCameras[0];
    // What the drive would use at the moment it switches to the new route.
    let atSwitch: string[] | null = null;
    const unsub = useAppStore.subscribe(
      (st) => st.plan?.timed,
      () => (atSwitch ??= useAppStore.getState().speedCameras.map((c) => c.id)),
    );
    await __devRerouteFrom(along(80));
    unsub();
    expect(useAppStore.getState().plan!.timed.totalDistM).toBeLessThan(290_000);
    // Never the old route's camera (its distance means a different place on the new route).
    expect(atSwitch).not.toContain(oldCam.id);
    await vi.waitFor(() => expect(useAppStore.getState().speedCameras).toHaveLength(1));
    expect(useAppStore.getState().speedCameras[0].id).toBe('cam-2');
  });
});
