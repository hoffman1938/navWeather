import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type * as maplibregl from 'maplibre-gl';
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
  const danger = cssVar('--danger', '#c62828');
  const surface = cssVar('--surface', '#ffffff');

  const beforeId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
  // lineMetrics → line-progress, so the driven part is a gradient stop, not a re-uploaded line.
  if (!map.getSource('route')) map.addSource('route', { type: 'geojson', data: EMPTY_FC, lineMetrics: true });
  for (const id of ['route-weather', 'endpoints', 'focus', 'pois', 'me-accuracy', 'cameras', 'hazards', 'incidents', 'alternatives', 'transit', 'transit-stops']) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
  }
  const lineLayout = { 'line-join': 'round', 'line-cap': 'round' } as const;

  // "You are here" accuracy circle (the dot itself is an HTML marker).
  map.addLayer(
    {
      id: 'me-accuracy',
      type: 'fill',
      source: 'me-accuracy',
      paint: { 'fill-color': route, 'fill-opacity': 0.1, 'fill-outline-color': route },
    },
    beforeId,
  );

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
  // Alternative routes: quieter lines under the chosen one; a wide invisible
  // line makes them easy to tap.
  const alt = cssVar('--route-alt', '#9aa3ad');
  map.addLayer(
    {
      id: 'alt-casing',
      type: 'line',
      source: 'alternatives',
      layout: lineLayout,
      paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 9, 8, 14, 13] },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'alt-line',
      type: 'line',
      source: 'alternatives',
      layout: lineLayout,
      paint: { 'line-color': alt, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 9, 4.5, 14, 8] },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'alt-hit',
      type: 'line',
      source: 'alternatives',
      layout: lineLayout,
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 24 },
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
      paint: {
        'line-color': route,
        'line-gradient': routeGradient(0),
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 5.5, 14, 10],
      },
    },
    beforeId,
  );
  // Public transport (instead of the route line): walks dotted, each ride in its line's colour, stops as rings.
  map.addLayer(
    {
      id: 'transit-walk',
      type: 'line',
      source: 'transit',
      filter: ['==', ['get', 'walk'], true],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': route,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 5, 17, 7],
        'line-dasharray': [0, 2],
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'transit-ride-casing',
      type: 'line',
      source: 'transit',
      filter: ['!=', ['get', 'walk'], true],
      layout: lineLayout,
      paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 9, 9, 14, 15] },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'transit-ride',
      type: 'line',
      source: 'transit',
      filter: ['!=', ['get', 'walk'], true],
      layout: lineLayout,
      paint: {
        'line-color': ['coalesce', ['get', 'color'], route],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 5.5, 14, 10],
      },
    },
    beforeId,
  );
  map.addLayer({
    id: 'transit-stops',
    type: 'circle',
    source: 'transit-stops',
    minzoom: 10,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 15, 6],
      'circle-color': surface,
      'circle-stroke-color': ['coalesce', ['get', 'color'], route],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3],
    },
  });
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
    id: 'pois',
    type: 'circle',
    source: 'pois',
    paint: {
      'circle-radius': 6,
      'circle-color': route,
      'circle-stroke-color': surface,
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'cameras',
    type: 'circle',
    source: 'cameras',
    minzoom: 9,
    paint: {
      'circle-radius': 5,
      'circle-color': cssVar('--text', '#111418'),
      'circle-stroke-color': surface,
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'hazards',
    type: 'circle',
    source: 'hazards',
    minzoom: 10,
    paint: {
      'circle-radius': 5,
      'circle-color': cssVar('--sev-high', '#b45309'),
      'circle-stroke-color': surface,
      'circle-stroke-width': 2,
    },
  });
  // Reports / incidents on the route: a ring + dot (unconfirmed reports are hollow).
  map.addLayer({
    id: 'incidents',
    type: 'circle',
    source: 'incidents',
    minzoom: 7,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4.5, 13, 7],
      'circle-color': ['case', ['get', 'verified'], cssVar('--sev-critical', '#b42318'), surface],
      'circle-stroke-color': cssVar('--sev-critical', '#b42318'),
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 13, 3.5],
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

/**
 * Route colour with the driven part greyed out, as a gradient stop on
 * line-progress (Mercator length fraction). Updating this paint property is
 * cheap; re-uploading a growing polyline was not.
 */
export function routeGradient(fraction: number): maplibregl.ExpressionSpecification {
  const route = cssVar('--route', '#0a6cff');
  const traveled = cssVar('--route-traveled', '#9aa3ad');
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return ['interpolate', ['linear'], ['line-progress'], 0, route, 1, route];
  if (f >= 1) return ['interpolate', ['linear'], ['line-progress'], 0, traveled, 1, traveled];
  return ['step', ['line-progress'], traveled, f, route];
}

/** Geodesic-enough circle polygon (accuracy radius) around a point. */
export function circleFeature(center: LngLat, radiusM: number, steps = 48): GeoJSON.Feature {
  const [lon, lat] = center;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * 3D buildings from the basemap's own building heights (OpenMapTiles
 * `render_height`), under the route so it stays visible. Added hidden; shown
 * while the map is tilted. Skipped when the style has no building layer.
 */
export function add3dBuildings(map: MLMap) {
  if (map.getLayer('building-3d')) return;
  const layers = map.getStyle().layers ?? [];
  const flat = layers.find((l) => l.type === 'fill' && 'source-layer' in l && l['source-layer'] === 'building') as maplibregl.FillLayerSpecification | undefined;
  if (!flat || typeof flat.source !== 'string') return;
  const before = map.getLayer('me-accuracy') ? 'me-accuracy' : layers.find((l) => l.type === 'symbol')?.id;
  map.addLayer(
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: flat.source,
      'source-layer': 'building',
      minzoom: 15,
      filter: ['!=', ['get', 'hide_3d'], true],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': cssVar('--map-building-3d', '#dcdcd5'),
        // Grow in over half a zoom level instead of popping up.
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, ['coalesce', ['get', 'render_height'], 0]],
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': 0.8,
      },
    },
    before,
  );
}
