import type { LngLat } from '../../types/geo';

export interface ElevationProvider {
  readonly name: string;
  /** Terrain elevation (m) for each coordinate, in order. */
  getElevations(coords: LngLat[], signal?: AbortSignal): Promise<number[]>;
}
