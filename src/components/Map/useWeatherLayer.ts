import type { CanvasSource, Map as MLMap } from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';
import { contains, gridPoints, gridValues, pad, renderField, type Bounds } from '../../algorithms/weatherGrid';
import { isAbortError } from '../../services/http';
import { getProviders } from '../../services/providers';
import { useExplore } from '../../state/explore';
import type { LocationForecast } from '../../types/weather';

const GRID = 7; // 49 points: one batched forecast request
const PX = 96;
const HOUR = 3_600_000;
const ID = 'wx-layer';
const STALE_MS = 30 * 60_000;

/** Hour `h` ahead of now, matched mid-hour (same rule as everywhere else). */
export function layerTime(hour: number, now = Date.now()): number {
  return Math.floor(now / HOUR) * HOUR + hour * HOUR + HOUR / 2;
}

/**
 * Forecast precipitation / temperature over the visible map. The grid is
 * fetched once per area (refetched when the view leaves it or zooms far
 * out) and redrawn locally for every hour on the slider.
 */
export function useWeatherLayer(mapRef: RefObject<MLMap | null>, styleVersion: number) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    const canvas = document.createElement('canvas');
    canvas.width = PX;
    canvas.height = PX;
    let grid: { bounds: Bounds; forecasts: (LocationForecast | undefined)[]; at: number } | null = null;
    let ctrl: AbortController | null = null;
    let timer = 0;

    const coords = ([w, s, e, n]: Bounds): [[number, number], [number, number], [number, number], [number, number]] => [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ];

    const draw = () => {
      const { layer, layerHour } = useExplore.getState();
      if (layer === 'off' || !grid) {
        if (map.getLayer(ID)) map.setLayoutProperty(ID, 'visibility', 'none');
        return;
      }
      const values = gridValues(grid.forecasts, layerTime(layerHour), layer);
      canvas.getContext('2d')!.putImageData(new ImageData(renderField(values, GRID, layer, PX), PX, PX), 0, 0);
      const src = map.getSource(ID) as CanvasSource | undefined;
      if (!src) {
        map.addSource(ID, { type: 'canvas', canvas, coordinates: coords(grid.bounds), animate: false });
        // Under the route and labels: context, not decoration.
        map.addLayer(
          { id: ID, type: 'raster', source: ID, paint: { 'raster-opacity': layer === 'precip' ? 0.8 : 0.55, 'raster-fade-duration': 0 } },
          map.getLayer('alt-casing') ? 'alt-casing' : undefined,
        );
      } else {
        src.setCoordinates(coords(grid.bounds));
        map.setPaintProperty(ID, 'raster-opacity', layer === 'precip' ? 0.8 : 0.55);
      }
      map.setLayoutProperty(ID, 'visibility', 'visible');
      const s = map.getSource(ID) as CanvasSource;
      s.play();
      s.pause();
    };

    const refresh = () => {
      if (useExplore.getState().layer === 'off') {
        draw();
        return;
      }
      const b = map.getBounds();
      const view: Bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      const width = view[2] - view[0];
      if (grid && contains(grid.bounds, view) && grid.bounds[2] - grid.bounds[0] < width * 2.5 && Date.now() - grid.at < STALE_MS) {
        draw();
        return;
      }
      ctrl?.abort();
      const c = new AbortController();
      ctrl = c;
      const bounds = pad(view, 0.2);
      const pts = gridPoints(bounds, GRID);
      const svc = getProviders().weather;
      useExplore.setState({ layerStatus: 'loading' });
      svc
        .getForecasts(
          pts.map(([lon, lat]) => ({ latitude: lat, longitude: lon })),
          { needUntilMs: Date.now() + 26 * HOUR, signal: c.signal },
        )
        .then(({ forecasts }) => {
          if (c.signal.aborted) return;
          const got = pts.map(([lon, lat]) => forecasts.get(svc.keyFor(lat, lon)));
          const missing = got.filter((f) => !f).length;
          // A partial grid is retried on the next move after a minute.
          grid = { bounds, forecasts: got, at: missing ? Date.now() - STALE_MS + 60_000 : Date.now() };
          useExplore.setState({ layerStatus: missing === got.length ? 'error' : missing ? 'partial' : 'ready' });
          draw();
        })
        .catch((e) => {
          if (!isAbortError(e)) useExplore.setState({ layerStatus: 'error' });
        });
    };

    const onMove = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 600);
    };
    map.on('moveend', onMove);
    const unsubLayer = useExplore.subscribe((s) => s.layer, refresh);
    const unsubHour = useExplore.subscribe((s) => s.layerHour, draw);
    refresh();
    return () => {
      window.clearTimeout(timer);
      ctrl?.abort();
      map.off('moveend', onMove);
      unsubLayer();
      unsubHour();
      if (map.getLayer(ID)) map.removeLayer(ID);
      if (map.getSource(ID)) map.removeSource(ID);
    };
  }, [mapRef, styleVersion]);
}
