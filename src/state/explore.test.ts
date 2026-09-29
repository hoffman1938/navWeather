import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberFix } from '../services/location';
import { setProviders } from '../services/providers';
import { installFakeProviders, type Harness } from '../test/harness';
import { BATUMI } from '../test/helpers';
import { herePlace, useExplore } from './explore';
import { useSettings } from './settings';
import { __resetStoreRuntime, useAppStore } from './store';

const BASE = Date.UTC(2026, 8, 27, 6, 0);
const initialApp = useAppStore.getState();
const initialExplore = useExplore.getState();
let h: Harness;

function stubGeolocation(result: { lon: number; lat: number } | { code: number }) {
  const geo = {
    getCurrentPosition: vi.fn((ok: PositionCallback, err: PositionErrorCallback) => {
      if ('code' in result) err({ code: result.code, message: '' } as GeolocationPositionError);
      else ok({ coords: { longitude: result.lon, latitude: result.lat, accuracy: 15, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
    }),
    watchPosition: vi.fn(() => 1),
    clearWatch: vi.fn(),
  };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  return geo;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE);
  __resetStoreRuntime();
  rememberFix(null);
  useAppStore.setState(initialApp, true);
  useExplore.setState(initialExplore, true);
  useSettings.getState().reset();
  useSettings.getState().update({ language: 'en', units: { distance: 'metric', temperature: 'c', wind: 'kmh' } });
  h = installFakeProviders(BASE);
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('place card', () => {
  it('a searched place gets its forecast; no drive time without a known position', async () => {
    useExplore.getState().selectPlace(BATUMI, 'search');
    expect(useExplore.getState().card?.weather.status).toBe('loading');
    await vi.waitFor(() => expect(useExplore.getState().card?.weather.status).toBe('ready'));
    const card = useExplore.getState().card!;
    expect(card.weather.forecast!.times.length).toBeGreaterThanOrEqual(7 * 24);
    expect(card.drive).toBeNull();
  });

  it('with a recent position it adds the drive time and arrival (for "weather when you arrive")', async () => {
    rememberFix({ coordinate: [44.793, 41.7151], timestampMs: BASE });
    useExplore.getState().selectPlace(BATUMI, 'search');
    await vi.waitFor(() => expect(useExplore.getState().card?.drive?.status).toBe('ready'));
    const d = useExplore.getState().card!.drive!;
    expect(d.durationS).toBeGreaterThan(3 * 3600);
    // Arrival = when the card was opened + drive time (waitFor ticks the fake clock a little).
    expect(d.arrivalMs! - d.durationS! * 1000 - BASE).toBeGreaterThanOrEqual(0);
    expect(d.arrivalMs! - d.durationS! * 1000 - BASE).toBeLessThan(1000);
  });

  it('a dropped pin is named by reverse geocoding; closing clears it', async () => {
    h.providers.geocoding.reverse = async () => ({ id: 'n', name: 'Rustaveli Avenue', label: 'Rustaveli Avenue, Tbilisi', coordinate: [44.8, 41.7] });
    useExplore.getState().dropPin([44.8, 41.7]);
    expect(useExplore.getState().card).toMatchObject({ source: 'pin', naming: true, place: { name: 'Dropped pin', label: '41.70000, 44.80000' } });
    await vi.waitFor(() => expect(useExplore.getState().card?.naming).toBe(false));
    expect(useExplore.getState().card!.place).toMatchObject({ name: 'Rustaveli Avenue', label: 'Rustaveli Avenue, Tbilisi', coordinate: [44.8, 41.7] });
    useExplore.getState().closeCard();
    expect(useExplore.getState().card).toBeNull();
  });

  it('typing coordinates into search drops a pin there', async () => {
    await useExplore.getState().searchSubmit('41.65, 41.63');
    expect(useExplore.getState().card?.place.coordinate).toEqual([41.63, 41.65]);
  });
});

describe('directions from a place', () => {
  it('starts from "Your location", resolved with a fresh fix when the route is calculated', async () => {
    stubGeolocation({ lon: 44.793, lat: 41.7151 });
    await useExplore.getState().directionsTo(BATUMI);
    const s = useAppStore.getState();
    expect(s.routeStatus).toBe('ready');
    const req = h.routingCalls.at(-1)!;
    expect(req.origin.name).toBe('Your location');
    expect(req.origin.coordinate).toEqual([44.793, 41.7151]);
    expect(req.destination.name).toBe('Batumi');
    expect(useExplore.getState().card).toBeNull();
  });

  it('when location is blocked, says exactly how to fix it instead of "unavailable"', async () => {
    stubGeolocation({ code: 1 });
    useAppStore.getState().setDestinationPlace(BATUMI);
    useAppStore.getState().setOriginPlace(herePlace());
    await useAppStore.getState().calculateRoute();
    const s = useAppStore.getState();
    expect(s.routeStatus).toBe('error');
    expect(s.routeError).toMatch(/Location is blocked for this site/);
    expect(h.routingCalls).toHaveLength(0);
  });
});

describe('quick categories near the map centre', () => {
  it('lists places nearest first, opens a card, and closing it returns to the list', async () => {
    useExplore.setState({ view: { center: [44.8015, 41.6937], zoom: 14 } });
    h.poi.results = [
      { id: 'far', category: 'cafe', name: 'Far Café', coordinate: [44.82, 41.70], source: 'test' },
      { id: 'near', category: 'cafe', name: 'Near Café', coordinate: [44.802, 41.694], source: 'test' },
    ];
    await useExplore.getState().searchNearby('cafe');
    const n = useExplore.getState().nearby!;
    expect(n).toMatchObject({ category: 'cafe', status: 'ready', radiusM: 3000 });
    expect(n.results.map((r) => r.poi.id)).toEqual(['near', 'far']);
    expect(n.results[0].distanceM).toBeLessThan(100);

    useExplore.getState().openPoi(n.results[0].poi);
    expect(useExplore.getState().card?.place).toMatchObject({ name: 'Near Café', label: 'café', kind: 'cafe' });
    useExplore.getState().closeCard();
    expect(useExplore.getState().nearby?.results).toHaveLength(2);
    useExplore.getState().clearNearby();
    expect(useExplore.getState().nearby).toBeNull();
  });
});
