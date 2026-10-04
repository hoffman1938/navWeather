import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../../types/geo';
import type { PlacesProvider } from './PlacesProvider';
import type { PoiProvider } from './PoiProvider';
import { PlacesTiles, splitByCoverage, tileOf, tilesAlong, type TilesIndex } from './tiles';
import { TilePlacesProvider, TilePoiProvider, TileSpeedLimitProvider } from './TileProviders';
import { TileTripPlaces } from '../../trip/stops/tilePlaces';
import type { TripPlacesSource } from '../../trip/stops/places';

/** A small "region" around Tbilisi with a few features, served by a stubbed fetch. */
const TBILISI: LngLat = [44.8015, 41.6935];
const MTSKHETA: LngLat = [44.7166, 41.8452];
const FAR: LngLat = [41.64, 41.65]; // Batumi — outside this test region

const key = (p: LngLat, z: number) => tileOf(p, z).join('/');
let files: Record<string, unknown>;
let fetched: string[];

beforeEach(() => {
  const z9 = [key(TBILISI, 9), key(MTSKHETA, 9)];
  const index: TilesIndex = {
    v: 1,
    region: 'test',
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    license: 'ODbL-1.0',
    dataDate: '2026-10-04',
    coverage: { z: 9, tiles: z9 },
    layers: {
      settlement: { z: 9, tiles: [key(TBILISI, 9)] },
      fuel: { z: 11, tiles: [key(TBILISI, 11)] },
      speed_camera: { z: 11, tiles: [key(TBILISI, 11)] },
      maxspeed: { z: 11, tiles: [key(TBILISI, 11)] },
    },
  };
  files = {
    '/tiles/index.json': index,
    [`/tiles/settlement/9/${key(TBILISI, 9)}.json`]: {
      v: 1,
      e: [
        ['n1', 44.8015, 41.6935, { place: 'city', name: 'თბილისი', 'name:en': 'Tbilisi', 'name:ru': 'Тбилиси', population: '1331485' }],
        ['n2', 44.75, 41.75, { place: 'village', name: 'Village', 'name:en': 'Village' }],
      ],
    },
    [`/tiles/fuel/11/${key(TBILISI, 11)}.json`]: {
      v: 1,
      e: [
        ['n10', 44.802, 41.694, { amenity: 'fuel', name: 'Gulf', brand: 'Gulf', opening_hours: '24/7' }],
        ['w11', 44.79, 41.69, { amenity: 'fuel', name: 'SOCAR' }],
      ],
    },
    [`/tiles/speed_camera/11/${key(TBILISI, 11)}.json`]: { v: 1, e: [['n20', 44.801, 41.6936, { highway: 'speed_camera', maxspeed: '60' }]] },
    [`/tiles/maxspeed/11/${key(TBILISI, 11)}.json`]: {
      v: 1,
      e: [
        ['w30', '60', [[44.8, 41.69], [44.81, 41.7]], 'primary'],
        ['w31', 'GE:urban', [[44.8, 41.69], [44.805, 41.692]], 'residential'],
      ],
    },
  };
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    const body = files[url];
    return body ? Response.json(body) : new Response('not found', { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('places tiles', () => {
  it('tile maths: the tiles along a line, padded', () => {
    expect(tileOf(TBILISI, 11)).toEqual([1278, 762]); // the pipeline writes Tbilisi to maxspeed/11/1278/762.json
    const along = tilesAlong([TBILISI, MTSKHETA], 500, 11);
    expect(along).toContain(key(TBILISI, 11));
    expect(along).toContain(key(MTSKHETA, 11));
  });

  it('splits a route into stretches inside and outside the region', async () => {
    const tiles = new PlacesTiles('/tiles');
    const index = (await tiles.loadIndex())!;
    const runs = splitByCoverage(tiles, index, [TBILISI, MTSKHETA, FAR]);
    expect(runs.map((r) => r.covered)).toEqual([true, false]);
    expect(runs[1].points).toEqual([MTSKHETA, FAR]); // continues from the last covered point
  });

  it('settlements and fuel come from our tiles, in the same shape as before, with no third-party request', async () => {
    const tiles = new PlacesTiles('/tiles');
    const places = await new TilePlacesProvider(tiles, 'en').getPlacesNearRoute([TBILISI, MTSKHETA], { includeVillages: false, language: 'ru' });
    expect(places).toEqual([{ id: 'osm:1', name: 'Тбилиси', kind: 'city', population: 1331485, coordinate: [44.8015, 41.6935] }]);
    const fuel = await new TilePoiProvider(tiles, 'en').search('fuel', [TBILISI, MTSKHETA], { corridorM: 1000 });
    expect(fuel.map((p) => [p.id, p.name, p.brand, p.openingHours])).toEqual([
      ['osm:node/10', 'Gulf', 'Gulf', '24/7'],
      ['osm:way/11', 'SOCAR', undefined, undefined],
    ]);
    const near = await new TilePoiProvider(tiles, 'en').searchNear('fuel', TBILISI, 500);
    expect(near.map((p) => p.id)).toEqual(['osm:node/10']); // the other one is ~1 km away
    expect(fetched.every((u) => u.startsWith('/tiles/'))).toBe(true);
    // Tiles are fetched once and kept.
    const n = fetched.length;
    await new TilePoiProvider(tiles, 'en').search('fuel', [TBILISI, MTSKHETA], { corridorM: 1000 });
    expect(fetched.length).toBe(n);
  });

  it('speed limits (explicit numbers only), cameras with their limit', async () => {
    const tiles = new PlacesTiles('/tiles');
    const p = new TileSpeedLimitProvider(tiles);
    expect(await p.getSpeedLimits([TBILISI, MTSKHETA])).toEqual([{ kmh: 60, geometry: [[44.8, 41.69], [44.81, 41.7]] }]);
    expect(await p.getSpeedCameras([TBILISI, MTSKHETA])).toEqual([{ id: 'osm:20', coordinate: [44.801, 41.6936], kmh: 60 }]);
    expect(await p.getLevelCrossings([TBILISI, MTSKHETA])).toEqual([]); // no tiles for this layer: nothing to fetch
  });

  it('outside the region the fallback answers for that stretch only; its failure there does not hide our part', async () => {
    const tiles = new PlacesTiles('/tiles');
    const asked: LngLat[][] = [];
    const fallback: PoiProvider = {
      name: 'fake-overpass',
      async search(_c, corridor) {
        asked.push(corridor);
        return [{ id: 'osm:node/99', category: 'fuel', coordinate: FAR, source: 'openstreetmap' }];
      },
    };
    const both = await new TilePoiProvider(tiles, 'en', fallback).search('fuel', [TBILISI, MTSKHETA, FAR], { corridorM: 1000 });
    expect(both.map((p) => p.id)).toEqual(['osm:node/10', 'osm:way/11', 'osm:node/99']);
    expect(asked).toEqual([[MTSKHETA, FAR]]);
    const failing: PoiProvider = { name: 'down', search: async () => Promise.reject(new Error('429')) };
    const ours = await new TilePoiProvider(tiles, 'en', failing).search('fuel', [TBILISI, MTSKHETA, FAR], { corridorM: 1000 });
    expect(ours.map((p) => p.id)).toEqual(['osm:node/10', 'osm:way/11']);
    // Entirely outside: the fallback's own answer — and its errors — as before.
    await expect(new TilePoiProvider(tiles, 'en', failing).search('fuel', [FAR, [41.7, 41.7]], { corridorM: 1000 })).rejects.toThrow('429');
    expect(await new TilePoiProvider(tiles, 'en').search('fuel', [FAR, [41.7, 41.7]], { corridorM: 1000 })).toEqual([]);
  });

  it('no tiles deployed: the fallback answers everything (or nothing without one)', async () => {
    delete files['/tiles/index.json'];
    const tiles = new PlacesTiles('/tiles');
    const fallback: PlacesProvider = { name: 'fake', getPlacesNearRoute: async () => [{ id: 'x', name: 'X', kind: 'town', coordinate: TBILISI }] };
    expect(await new TilePlacesProvider(tiles, 'en', fallback).getPlacesNearRoute([TBILISI, MTSKHETA], { includeVillages: true })).toHaveLength(1);
    expect(await new TilePlacesProvider(tiles, 'en').getPlacesNearRoute([TBILISI, MTSKHETA], { includeVillages: true })).toEqual([]);
  });
});

describe('Long Trip stop places from our tiles (Worker side)', () => {
  const car = { kind: 'car', powertrain: 'fuel' } as const;
  const truck = { kind: 'truck', powertrain: 'fuel' } as const;

  beforeEach(() => {
    const idx = files['/tiles/index.json'] as TilesIndex;
    idx.layers.hotel = { z: 11, tiles: [key(TBILISI, 11)] };
    idx.layers.parking = { z: 11, tiles: [key(TBILISI, 11)] };
    idx.layers.rest_area = { z: 11, tiles: [key(TBILISI, 11)] };
    files[`/tiles/hotel/11/${key(TBILISI, 11)}.json`] = { v: 1, e: [['w40', 44.803, 41.695, { tourism: 'hotel', name: 'Old Town Hotel', stars: '4' }]] };
    files[`/tiles/parking/11/${key(TBILISI, 11)}.json`] = {
      v: 1,
      e: [
        ['n41', 44.804, 41.694, { amenity: 'parking', hgv: 'designated' }],
        ['n42', 44.804, 41.6941, { amenity: 'parking' }],
      ],
    };
    files[`/tiles/rest_area/11/${key(TBILISI, 11)}.json`] = { v: 1, e: [] };
  });

  it('finds hotels, fuel and truck parking around a stop, like the Overpass query did', async () => {
    const source = new TileTripPlaces(new PlacesTiles('/tiles'));
    const q = { lat: TBILISI[1], lon: TBILISI[0], categories: [{ category: 'hotel' as const, radiusKm: 5 }, { category: 'fuel' as const, radiusKm: 2 }], vehicle: car };
    const found = await source.find(q);
    expect(found.map((p) => [p.id, p.category, p.type])).toEqual([
      ['way/40', 'hotel', 'hotel'],
      ['node/10', 'fuel', 'fuel'],
      ['way/11', 'fuel', 'fuel'],
    ]);
    const rest = await source.find({ ...q, categories: [{ category: 'rest', radiusKm: 3 }], vehicle: truck });
    expect(rest.map((p) => [p.id, p.type])).toEqual([['node/41', 'truck_parking']]); // HGV parking only
    expect(await source.find({ ...q, categories: [{ category: 'rest', radiusKm: 3 }] })).toEqual([]); // a car: rest areas only
  });

  it('outside the region: the fallback source (Overpass until the region is built), or an error the planner shows', async () => {
    const q = { lat: FAR[1], lon: FAR[0], categories: [{ category: 'hotel' as const, radiusKm: 5 }], vehicle: car };
    const fallback: TripPlacesSource = { find: async () => [{ id: 'node/7', category: 'hotel', type: 'hotel', lat: FAR[1], lon: FAR[0], tags: {} }] };
    expect(await new TileTripPlaces(new PlacesTiles('/tiles'), fallback).find(q)).toHaveLength(1);
    await expect(new TileTripPlaces(new PlacesTiles('/tiles')).find(q)).rejects.toThrow(/outside/);
  });
});
