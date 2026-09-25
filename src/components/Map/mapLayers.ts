import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { LngLat } from '../../types/geo';

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Resolve a colour token (incl. light-dark()) to a concrete colour MapLibre understands. */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${name}, ${fallback})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || fallback;
}

/** Route + weather layers, inserted below the basemap's labels so place names stay readable. */
export function addRouteLayers(map: MLMap) {
  const route = cssVar('--route', '#0a6cff');
  const casing = cssVar('--route-casing', '#ffffff');
  const traveled = cssVar('--route-traveled', '#9aa3ad');
  const danger = cssVar('--danger', '#c62828');
  const surface = cssVar('--surface', '#ffffff');

  const beforeId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
  for (const id of ['route', 'route-weather', 'route-traveled', 'endpoints', 'focus']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
  }
  const lineLayout = { 'line-join': 'round', 'line-cap': 'round' } as const;

  // Weather: a soft glow *around* the route — never replaces the route colour.
  map.addLayer(
    {
      id: 'route-weather-halo',
      type: 'line',
      source: 'route-weather',
      layout: lineLayout,
      paint: {
        'line-color': [
          'match',
          ['get', 'cls'],
          'rain',
          '#38a3f5',
          'heavy-rain',
          '#1d5fd8',
          'snow',
          '#b9dcff',
          'sleet',
          '#7fb0dd',
          'fog',
          '#8f99a6',
          'thunderstorm',
          '#7c4ddb',
          '#000000',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 10, 9, 18, 14, 30],
        'line-opacity': [
          'match',
          ['get', 'cls'],
          'heavy-rain',
          0.5,
          'thunderstorm',
          0.5,
          'snow',
          0.75,
          'fog',
          0.45,
          0.4,
        ],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 4, 2, 14, 6],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: lineLayout,
      paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 9, 9, 14, 15] },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: lineLayout,
      paint: { 'line-color': route, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 5.5, 14, 10] },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'route-traveled',
      type: 'line',
      source: 'route-traveled',
      layout: lineLayout,
      paint: { 'line-color': traveled, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 5.5, 14, 10] },
    },
    beforeId,
  );
  map.addLayer({
    id: 'focus-halo',
    type: 'circle',
    source: 'focus',
    paint: {
      'circle-radius': ['case', ['get', 'strong'], 22, 16],
      'circle-color': route,
      'circle-opacity': ['case', ['get', 'strong'], 0.22, 0.14],
    },
  });
  map.addLayer({
    id: 'focus-dot',
    type: 'circle',
    source: 'focus',
    paint: {
      'circle-radius': ['case', ['get', 'strong'], 7, 5],
      'circle-color': route,
      'circle-stroke-color': surface,
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'endpoints',
    type: 'circle',
    source: 'endpoints',
    paint: {
      'circle-radius': ['match', ['get', 'role'], 'origin', 6.5, 8],
      'circle-color': ['match', ['get', 'role'], 'origin', surface, danger],
      'circle-stroke-color': ['match', ['get', 'role'], 'origin', route, surface],
      'circle-stroke-width': 3,
    },
  });
}

export function setData(map: MLMap, id: string, data: GeoJSON.GeoJSON) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  src?.setData(data);
}

export function lineFeature(coords: LngLat[], properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } };
}

export function pointFeature(c: LngLat, properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: c } };
}
