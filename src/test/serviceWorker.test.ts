import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * public/sw.js runs outside the bundle, so it is loaded here into a minimal
 * fake worker scope. The privacy rule under test: provider/tile requests
 * (whose URLs carry route coordinates) are never intercepted or cached.
 */
type Listener = (event: FakeFetchEvent) => void;
interface FakeFetchEvent {
  request: { url: string; method: string; mode: string };
  respondWith: ReturnType<typeof vi.fn>;
}

function loadWorker() {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: 'https://navweather.pages.dev' },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const caches = { open: vi.fn(async () => ({ put: vi.fn() })), match: vi.fn(async () => undefined), keys: vi.fn(async () => []), delete: vi.fn() };
  const fetch = vi.fn(async () => new Response('ok'));
  const src = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
  new Function('self', 'caches', 'fetch', src)(self, caches, fetch);
  const dispatch = (url: string, init: { method?: string; mode?: string } = {}) => {
    const event: FakeFetchEvent = {
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith: vi.fn(),
    };
    listeners.fetch(event);
    return event;
  };
  return { dispatch, caches };
}

describe('service worker', () => {
  it('never intercepts provider or map tile requests', () => {
    const { dispatch, caches } = loadWorker();
    for (const url of [
      'https://router.project-osrm.org/route/v1/driving/44.79,41.71;41.63,41.64?overview=full',
      'https://api.open-meteo.com/v1/forecast?latitude=41.71,42.0&longitude=44.79,43.5',
      'https://nominatim.openstreetmap.org/reverse?lat=41.71&lon=44.79',
      'https://overpass-api.de/api/interpreter',
      'https://tiles.openfreemap.org/planet/20260901/6/39/23.pbf',
    ]) {
      expect(dispatch(url).respondWith).not.toHaveBeenCalled();
    }
    expect(caches.open).not.toHaveBeenCalled();
  });

  it('serves the app shell and hashed assets, and ignores non-GET', () => {
    const { dispatch } = loadWorker();
    expect(dispatch('https://navweather.pages.dev/', { mode: 'navigate' }).respondWith).toHaveBeenCalled();
    expect(dispatch('https://navweather.pages.dev/assets/index-abc.js').respondWith).toHaveBeenCalled();
    expect(dispatch('https://navweather.pages.dev/assets/x.js', { method: 'POST' }).respondWith).not.toHaveBeenCalled();
  });
});

describe('service worker: live data', () => {
  it('never intercepts the live-share API', () => {
    const { dispatch } = loadWorker();
    expect(dispatch('https://navweather.pages.dev/api/share/AAAAAAAAAAAAAAAAAAAAAA', { mode: 'navigate' }).respondWith).not.toHaveBeenCalled();
    expect(dispatch('https://navweather.pages.dev/api/share/AAAAAAAAAAAAAAAAAAAAAA').respondWith).not.toHaveBeenCalled();
  });
});
