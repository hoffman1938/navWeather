import type { LngLat } from '../../types/geo';
import type { PlaceKind } from '../../types/route';

export interface RawPlace {
  id: string;
  name: string;
  kind: PlaceKind;
  population?: number;
  coordinate: LngLat;
}

/** Settlements near a route (for naming weather points and sampling anchors). */
export interface PlacesProvider {
  readonly name: string;
  getPlacesNearRoute(
    geometry: LngLat[],
    options: { includeVillages: boolean; signal?: AbortSignal; language?: string },
  ): Promise<RawPlace[]>;
}
