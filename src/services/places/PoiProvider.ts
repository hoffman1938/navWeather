import type { LngLat } from '../../types/geo';
import type { ChargingInfo } from './evCharging';

export type PoiCategory =
  | 'fuel'
  | 'ev_charging'
  | 'restaurant'
  | 'cafe'
  | 'hotel'
  | 'parking'
  | 'atm'
  | 'pharmacy'
  | 'supermarket'
  | 'rest_area'
  | 'car_wash'
  | 'car_repair'
  | 'attraction'
  | 'toilets'
  | 'hospital';

export interface Poi {
  id: string;
  category: PoiCategory;
  name?: string;
  brand?: string;
  coordinate: LngLat;
  openingHours?: string;
  /** EV chargers: connectors and power, when mapped. */
  charging?: ChargingInfo;
  source: string;
}

/** Points of interest near a stretch of route (provider-independent). */
export interface PoiProvider {
  readonly name: string;
  search(
    category: PoiCategory,
    corridor: LngLat[],
    options: { corridorM: number; signal?: AbortSignal; language?: string },
  ): Promise<Poi[]>;
  /** Places of a category within `radiusM` of a point ("coffee near here"). */
  searchNear?(category: PoiCategory, center: LngLat, radiusM: number, options?: { signal?: AbortSignal; language?: string }): Promise<Poi[]>;
}
