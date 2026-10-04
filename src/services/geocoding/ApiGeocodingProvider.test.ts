import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat, Place } from '../../types/geo';
import { PlacesTiles, tileOf, type TilesIndex } from '../places/tiles';
import type { AutocompleteProvider, GeocodingProvider } from './GeocodingProvider';
import { ApiGeocodingProvider, TileReverseGeocoder } from './ApiGeocodingProvider';

/** Our geocoder in the app: `/api/v1/geocode` for search, settlement tiles for names — Photon only as a fallback. */

const TBILISI: LngLat = [44.8015, 41.6935];
const key = (p: LngLat, z: number) => tileOf(p, z).join('/');
let routes: Record<string, (url: URL) => Response>;
let calls: string[];

const kutaisi: Place = { id: 'osm:n218730242', name: 'Kutaisi', label: 'Kutaisi, Georgia', coordinate: [42.705448, 42.271608], kind: 'city' };
const istanbul: Place = { id: 'photon:R223474', name: 'Istanbul', label: 'Istanbul, Türkiye', coordinate: [28.97, 41.01], kind: 'city' };

function photonLike(): GeocodingProvider & AutocompleteProvider & { asked: string[] } {
  const asked: string[] = [];
  return {
    name: 'fake-photon',
    asked,
    async suggest(q) {
      asked.push(`suggest:${q}`);
      return [istanbul];
    },
    async geocode(q) {
      asked.push(`geocode:${q}`);
      return istanbul;
    },
    async reverse(c) {
      asked.push(`reverse:${c.join(',')}`);
      return { ...istanbul, coordinate: c };
    },
  };
}

beforeEach(() => {
  calls = [];
  const index: TilesIndex = {
    v: 1,
    region: 'test',
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    license: 'ODbL-1.0',
    dataDate: '2026-10-04',
    coverage: { z: 9, tiles: [key(TBILISI, 9)] },
    layers: { settlement: { z: 9, tiles: [key(TBILISI, 9)] } },
  };
  routes = {
    '/tiles/index.json': () => Response.json(index),
    [`/tiles/settlement/9/${key(TBILISI, 9)}.json`]: () =>
      Response.json({
        v: 1,
        e: [
          ['n1', 44.8015, 41.6935, { place: 'city', name: 'თბილისი', 'name:en': 'Tbilisi', 'name:ru': 'Тбилиси' }],
          ['n2', 44.73, 41.77, { place: 'village', name: 'წავკისი', 'name:en': 'Tsavkisi' }],
        ],
      }),
    '/api/v1/geocode': (url) => (url.searchParams.get('q')!.toLowerCase().startsWith('kut') ? Response.json({ places: [kutaisi] }) : Response.json({ places: [] })),
  };
  vi.stubGlobal('fetch', async (input: string) => {
    calls.push(input);
    const url = new URL(input, 'http://localhost');
    const route = routes[url.pathname];
    return route ? route(url) : new Response('not found', { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

function provider(fallback: ReturnType<typeof photonLike> | null) {
  const tiles = new PlacesTiles('/tiles');
  return new ApiGeocodingProvider('/api/v1/geocode', 'en', fallback, new TileReverseGeocoder(tiles, 'en', fallback));
}

describe('our geocoder in the app (DP-6.4)', () => {
  it('suggestions come from our index; the search text and a coarse position go only to our Worker', async () => {
    const photon = photonLike();
    const got = await provider(photon).suggest('Kut', { near: [44.80152, 41.69351], language: 'ru' });
    expect(got).toEqual([kutaisi]);
    expect(photon.asked).toEqual([]);
    expect(calls).toEqual(['/api/v1/geocode?q=Kut&lang=ru&limit=6&near=44.8%2C41.7']);
    expect(await provider(photon).suggest('k')).toEqual([]); // too short: nothing asked
  });

  it('a place our index does not have (a town abroad) — or an index that is not loaded — goes to the fallback', async () => {
    const photon = photonLike();
    expect(await provider(photon).geocode('Istanbul')).toEqual(istanbul);
    expect(photon.asked).toEqual(['suggest:Istanbul']);
    routes['/api/v1/geocode'] = () => Response.json({ error: 'unavailable' }, { status: 503 });
    expect(await provider(photon).suggest('Kutaisi')).toEqual([istanbul]);
    // Without a fallback the error surfaces (the search field says so).
    await expect(provider(null).suggest('Kutaisi')).rejects.toThrow();
    routes['/api/v1/geocode'] = () => Response.json({ places: [] });
    expect(await provider(null).suggest('Istanbul')).toEqual([]);
  });

  it('names a point by the nearest settlement from our tiles; outside them the fallback names it', async () => {
    const photon = photonLike();
    const p = provider(photon);
    expect(await p.reverse([44.79, 41.70], { language: 'ru' })).toMatchObject({ id: 'osm:1', name: 'Тбилиси', kind: 'city' });
    expect(await p.reverse([44.735, 41.768])).toMatchObject({ name: 'Tsavkisi', kind: 'village' });
    expect(photon.asked).toEqual([]);
    expect(await p.reverse([28.97, 41.01])).toMatchObject({ name: 'Istanbul' });
    expect(photon.asked).toEqual(['reverse:28.97,41.01']);
    expect(await provider(null).reverse([28.97, 41.01])).toBeNull();
  });
});
