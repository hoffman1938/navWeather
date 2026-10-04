import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProviders } from '../services/providers';
import { installFakeProviders } from '../test/harness';
import type { LngLat } from '../types/geo';
import { skipKm } from '../dev/devTools';
import { useSettings } from './settings';
import { __devRerouteFrom, __resetStoreRuntime, useAppStore } from './store';

/**
 * The fuel reminder from the user's declared range is fixed to the road: the range is used up as the car drives,
 * also across a re-route, and entering a new range (after refuelling) starts again from there (B-02, REQ-CORE-013).
 */

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initialState = useAppStore.getState();

const along = (km: number): LngLat => {
  const t = useAppStore.getState().plan!.timed;
  let i = 0;
  while (i < t.cumDistM.length - 1 && t.cumDistM[i] < km * 1000) i++;
  return t.route.geometry[i];
};

const fuelStop = () => useAppStore.getState().derived.intelligence.events.find((e) => e.type === 'FUEL_STOP');

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
  useSettings.getState().update({ fuelRangeKm: 200, vehicle: 'fuel' });
  installFakeProviders(BASE);
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('fuel reminder from the declared range (B-02)', () => {
  it('stays where 70 % of the range is used while the car drives towards it', async () => {
    await plan();
    expect(fuelStop()!.distanceAlongM).toBeCloseTo(140_000, -3.5);
    useAppStore.getState().startSimulation();
    skipKm(100);
    useAppStore.getState().rederive();
    const stop = fuelStop()!;
    expect(useAppStore.getState().progress!.distanceAlongM).toBeGreaterThan(85_000);
    expect(stop.distanceAlongM).toBeCloseTo(140_000, -3.5); // not 240 km
    expect(stop.distanceFromCurrentM).toBeLessThan(55_000);
  });

  it('counts the road driven before a re-route, and starts again when a new range is entered', async () => {
    await plan();
    useAppStore.getState().startSimulation();
    skipKm(100);
    const drivenM = useAppStore.getState().progress!.distanceAlongM;
    await __devRerouteFrom(along(drivenM / 1000));
    const s = useAppStore.getState();
    expect(s.progress!.distanceAlongM).toBeLessThan(1000); // a new route from the car
    // 140 km − ~100 km already driven: about 40 km ahead on the new route.
    expect(fuelStop()!.distanceAlongM).toBeCloseTo(140_000 - drivenM, -3.5);

    // Refuelled: a full 500 km covers the ~260 km left, so there is nothing to remind.
    useSettings.getState().update({ fuelRangeKm: 500 });
    useAppStore.getState().rederive();
    expect(fuelStop()).toBeUndefined();
    // Back to a short range: counted from where it was entered, not from the start of the drive.
    useSettings.getState().update({ fuelRangeKm: 150 });
    useAppStore.getState().rederive();
    const here = useAppStore.getState().progress!.distanceAlongM;
    expect(fuelStop()!.distanceAlongM).toBeCloseTo(here + 105_000, -3.5);
  });
});
