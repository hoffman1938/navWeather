import type { LngLat, Place } from '../../types/geo';

export interface GeocodeOptions {
  signal?: AbortSignal;
  /** Bias results toward this location, if supported. */
  near?: LngLat;
  limit?: number;
  /** Preferred language for names (falls back to the provider default). */
  language?: string;
}

/** Resolve free text / coordinates into normalized places. */
export interface GeocodingProvider {
  readonly name: string;
  /** Best match for a free-text query, or null when nothing matched. */
  geocode(query: string, options?: GeocodeOptions): Promise<Place | null>;
  /** Human-readable place for a coordinate (settlement level), or null. */
  reverse(coordinate: LngLat, options?: GeocodeOptions): Promise<Place | null>;
}

/**
 * Search-as-you-type suggestions. Separate from GeocodingProvider because
 * some geocoders (e.g. Nominatim) forbid autocomplete usage.
 */
export interface AutocompleteProvider {
  readonly name: string;
  suggest(query: string, options?: GeocodeOptions): Promise<Place[]>;
}
