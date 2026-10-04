import type { LngLat } from '../../types/geo';
import { haversineM } from '../../utils/distance';
import { PlacesTiles, type TileLayer, type TilePoint } from '../../services/places/tiles';
import type { PlaceCategory } from '../types';
import { parseOverpass, type PlaceQuery, type RawPlace, type TripPlacesSource } from './places';

/** Our tile layers for each Long Trip stop category (the same OSM features the Overpass query asked for). */
const LAYERS: Record<PlaceCategory, TileLayer[]> = {
  hotel: ['hotel'],
  fuel: ['fuel'],
  charging: ['ev_charging'],
  food: ['restaurant', 'cafe'],
  rest: ['rest_area'],
};

/**
 * Places around a Long Trip stop from OUR tiles (DP-6.5): no Overpass and no edge cache inside the region the tiles
 * cover (B-22). Elsewhere the `fallback` source (Overpass, until the region is built) answers, or nothing.
 */
export class TileTripPlaces implements TripPlacesSource {
  constructor(
    private readonly tiles: PlacesTiles,
    private readonly fallback: TripPlacesSource | null = null,
  ) {}

  async find(q: PlaceQuery, signal?: AbortSignal): Promise<RawPlace[]> {
    const center: LngLat = [q.lon, q.lat];
    const index = await this.tiles.loadIndex(signal);
    if (!index || !this.tiles.covers(index, center)) {
      if (this.fallback) return this.fallback.find(q, signal);
      throw new Error('places: outside the region our data covers');
    }
    const out: RawPlace[] = [];
    for (const { category, radiusKm } of q.categories) {
      const r = Math.max(0.2, Math.min(25, radiusKm)) * 1000;
      const layers = [...LAYERS[category], ...(category === 'rest' && q.vehicle.kind === 'truck' ? (['parking'] as TileLayer[]) : [])];
      for (const layer of layers) {
        const features = (await this.tiles.features<TilePoint>(layer, [center], r, signal)).filter(([, lon, lat, tags]) => {
          if (haversineM(center, [lon, lat]) > r) return false;
          // Truck parking only where HGVs are allowed (as the Overpass filter did).
          return layer !== 'parking' || /^(yes|designated)$/.test(tags.hgv ?? '');
        });
        const elements = features.map(([id, lon, lat, tags]) => ({ type: (id[0] === 'w' ? 'way' : 'node') as 'node' | 'way', id: Number(id.slice(1)), lat, lon, tags }));
        out.push(...parseOverpass({ elements }).filter((p) => p.category === category || (category === 'rest' && layer === 'parking')));
      }
    }
    return out;
  }
}
