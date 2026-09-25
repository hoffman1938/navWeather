/** [longitude, latitude] — GeoJSON axis order, used everywhere internally. */
export type LngLat = [number, number];

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

/** A resolved, normalized location (provider-independent). */
export interface Place {
  id: string;
  /** Short display name, e.g. "Tbilisi". */
  name: string;
  /** Longer disambiguating label, e.g. "Tbilisi, Georgia". */
  label: string;
  coordinate: LngLat;
  /** Coarse type such as "city", "town", "street" — for icons and ranking only. */
  kind?: string;
}
