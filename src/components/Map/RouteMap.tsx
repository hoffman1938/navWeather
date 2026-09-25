import { AttributionControl, Map as MLMap, Marker, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 resolves its worker relative to its own module URL, which breaks
// once bundled — let Vite build the worker and hand MapLibre the final URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { getProviders } from '../../services/providers';
import { useLayoutStore } from '../../state/layout';
import { selectScrub } from '../../state/scrub';
import { useAppStore } from '../../state/store';
import type { LngLat } from '../../types/geo';
import { sliceLine } from '../../utils/distance';
import { LocateIcon } from '../Icons/Icons';
import { WeatherMarker } from '../WeatherMarker/WeatherMarker';
import { addRouteLayers, EMPTY_FC, lineFeature, pointFeature, setData } from './mapLayers';
import './Map.css';

setWorkerUrl(maplibreWorkerUrl);

interface Host {
  id: string;
  el: HTMLDivElement;
  marker: Marker;
}

/**
 * The map: route, subtle weather glow, weather markers (the SAME points as
 * the timeline cards), vehicle, and camera behaviour for selection/follow.
 */
export default function RouteMap() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const hostsRef = useRef(new Map<string, Host>());
  const vehicleRef = useRef<Marker | null>(null);
  /** True while a deliberate camera transition runs; follow mode waits for it. */
  const transitioning = useRef(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const { theme } = useEffectiveTheme();
  const dark = theme === 'dark';
  const initialDark = useRef(dark);
  const reduced = useReducedMotion();
  const insets = useLayoutStore((s) => s.insets);

  const plan = useAppStore((s) => s.plan);
  const displayPoints = useAppStore((s) => s.derived.displayPoints);
  const allPoints = useAppStore((s) => s.derived.points);
  const segments = useAppStore((s) => s.derived.routeSegments);
  const selectedId = useAppStore((s) => s.selectedPointId);
  const selectionSource = useAppStore((s) => s.selectionSource);
  const highlightedId = useAppStore((s) => s.highlightedPointId);
  const scrub = useAppStore(selectScrub);
  const mode = useAppStore((s) => s.mode);
  const follow = useAppStore((s) => s.followVehicle);
  const navigating = mode !== 'planning';

  const padding = useMemo(
    () => {
      // Overlay insets, clamped so the visible map area never collapses.
      const h = typeof window !== 'undefined' ? window.innerHeight : 800;
      const top = insets.top + 8;
      const bottom = Math.min(insets.bottom + 8, Math.max(0, h - top - 160));
      return { top, bottom, left: 16, right: 16 };
    },
    [insets.top, insets.bottom],
  );
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  // ---- Create the map once ------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: container.current,
        style: getProviders().map.getStyleUrl(initialDark.current ? 'dark' : 'light'),
        center: [43.4, 42.0],
        zoom: 6.2,
        // Attribution goes top-right so the bottom sheet never hides it.
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        fadeDuration: 150,
      });
    } catch {
      setMapError('Map unavailable on this device — the forecast below still works.');
      return;
    }
    map.addControl(new AttributionControl({ compact: true }), 'top-right');
    map.touchZoomRotate.disableRotation();
    map.on('style.load', () => {
      addRouteLayers(map);
      setStyleVersion((v) => v + 1);
    });
    map.on('error', (e) => {
      if (!map.isStyleLoaded() && !map.loaded()) {
        setMapError('Map tiles unavailable right now — the forecast below still works.');
      }
      console.warn('[map]', e.error?.message ?? e);
    });
    const stopFollow = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return; // programmatic camera moves
      setUserMoved(true);
      const s = useAppStore.getState();
      if (s.mode !== 'planning' && s.followVehicle) s.setFollow(false);
    };
    map.on('dragstart', stopFollow);
    map.on('zoomstart', stopFollow);
    map.on('move', () => scheduleDeclutter());
    map.on('click', () => {
      const s = useAppStore.getState();
      if (s.selectedPointId) s.select(null, 'map');
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      hostsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Light/dark basemap ---------------------------------------------------
  const firstTheme = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    map.setStyle(getProviders().map.getStyleUrl(dark ? 'dark' : 'light'));
  }, [dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // setPadding would cancel an in-flight camera animation (e.g. flying to a
    // tapped card while the sheet grows) — apply it once the camera settles.
    if (map.isMoving()) {
      const apply = () => map.setPadding(paddingRef.current);
      map.once('moveend', apply);
      return () => {
        map.off('moveend', apply);
      };
    }
    map.setPadding(padding);
  }, [padding]);

  const fitRoute = useCallback(
    (animate: boolean) => {
      const map = mapRef.current;
      const s = useAppStore.getState();
      if (!map || !s.plan) return;
      const [w, so, e, n] = s.plan.timed.route.bbox;
      // fitBounds padding is *added* to the persistent overlay insets (setPadding),
      // so only a small margin is needed here.
      map.fitBounds(
        [
          [w, so],
          [e, n],
        ],
        { padding: 24, duration: animate && !reduced ? 700 : 0, maxZoom: 13 },
      );
      setUserMoved(false);
    },
    [reduced],
  );

  // Keep the whole route in view when the window/pane resizes (unless the user moved the map).
  const userMovedRef = useRef(userMoved);
  userMovedRef.current = userMoved;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (useAppStore.getState().mode === 'planning' && !userMovedRef.current) fitRoute(false);
      }, 200);
    };
    map.on('resize', onResize);
    return () => {
      window.clearTimeout(t);
      map.off('resize', onResize);
    };
  }, [fitRoute]);

  // ---- Route geometry ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    if (!plan) {
      for (const id of ['route', 'route-weather', 'route-traveled', 'endpoints', 'focus']) setData(map, id, EMPTY_FC);
      return;
    }
    const { route } = plan.timed;
    setData(map, 'route', lineFeature(route.geometry));
    setData(map, 'endpoints', {
      type: 'FeatureCollection',
      features: [
        pointFeature(route.geometry[0], { role: 'origin' }),
        pointFeature(route.geometry[route.geometry.length - 1], { role: 'destination' }),
      ],
    });
  }, [plan, styleVersion]);

  // Fit the whole route when a new route arrives (not on every re-derive).
  const routeId = plan?.timed.route.id;
  useEffect(() => {
    if (routeId && styleVersion && useAppStore.getState().mode === 'planning') fitRoute(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, styleVersion > 0]);

  // ---- Weather-coloured stretches -------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion || !plan) return;
    const { route } = plan.timed;
    setData(map, 'route-weather', {
      type: 'FeatureCollection',
      features: segments
        .map((s) => lineFeature(sliceLine(route.geometry, plan.timed.cumDistM, s.startM, s.endM), { cls: s.groupClass }))
        .filter((f) => (f.geometry as GeoJSON.LineString).coordinates.length > 1),
    });
  }, [segments, plan, styleVersion]);

  // ---- Focus ring for selected / scroll-highlighted point --------------------
  const focusPoint = useMemo(() => {
    if (!selectedId && scrub) return { coord: scrub.coordinate, strong: true };
    const id = selectedId ?? highlightedId;
    if (!id) return null;
    const p =
      id === 'current' ? useAppStore.getState().derived.currentPoint : allPoints.find((x) => x.id === id);
    return p ? { coord: [p.longitude, p.latitude] as LngLat, strong: id === selectedId } : null;
  }, [selectedId, highlightedId, allPoints, scrub]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    setData(map, 'focus', focusPoint ? pointFeature(focusPoint.coord, { strong: focusPoint.strong }) : EMPTY_FC);
  }, [focusPoint, styleVersion]);

  // Timeline → map: fly to the tapped card's route point.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || selectionSource !== 'timeline' || !focusPoint) return;
    map.easeTo({
      center: focusPoint.coord,
      zoom: Math.max(map.getZoom(), 9),
      duration: reduced ? 0 : 650,
    });
    setUserMoved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectionSource]);

  // ---- Weather markers (React portals into MapLibre markers) ----------------
  const declutterRaf = useRef(0);
  const scheduleDeclutter = useCallback(() => {
    cancelAnimationFrame(declutterRaf.current);
    declutterRaf.current = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      const s = useAppStore.getState();
      const list = s.derived.displayPoints;
      const priority = (id: string, i: number) =>
        id === s.selectedPointId ? 0 : id === s.highlightedPointId ? 1 : i === 0 || i === list.length - 1 ? 2 : 3;
      const ordered = list
        .map((p, i) => ({ p, pr: priority(p.id, i), i }))
        .sort((a, b) => a.pr - b.pr || a.i - b.i);
      const shown: { x: number; y: number; w: number }[] = [];
      for (const { p } of ordered) {
        const host = hostsRef.current.get(p.id);
        if (!host) continue;
        const pt = map.project([p.longitude, p.latitude]);
        const w = p.id === s.selectedPointId ? 170 : 74;
        const collide = shown.some((o) => Math.abs(o.x - pt.x) < (o.w + w) / 2 && Math.abs(o.y - pt.y) < 40);
        host.el.classList.toggle('is-collapsed', collide);
        host.el.classList.toggle('is-selected-host', p.id === s.selectedPointId);
        if (!collide) shown.push({ x: pt.x, y: pt.y, w });
      }
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Set(displayPoints.map((p) => p.id));
    for (const [id, h] of hostsRef.current) {
      if (!want.has(id)) {
        h.marker.remove();
        hostsRef.current.delete(id);
      }
    }
    for (const p of displayPoints) {
      const existing = hostsRef.current.get(p.id);
      if (existing) {
        existing.marker.setLngLat([p.longitude, p.latitude]);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'wmarker-host';
      const marker = new Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.longitude, p.latitude])
        .addTo(map);
      hostsRef.current.set(p.id, { id: p.id, el, marker });
    }
    setHosts(displayPoints.map((p) => hostsRef.current.get(p.id)!).filter(Boolean));
    scheduleDeclutter();
  }, [displayPoints, scheduleDeclutter]);

  useEffect(() => scheduleDeclutter(), [selectedId, highlightedId, scheduleDeclutter]);

  const onMarkerSelect = useCallback((id: string) => {
    const s = useAppStore.getState();
    s.select(s.selectedPointId === id ? null : id, 'map');
  }, []);

  // ---- Vehicle + traveled route (imperative: updates every frame) -----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let lastTraveled = 0;
    const update = () => {
      const s = useAppStore.getState();
      const v = s.vehicle;
      if (!v || s.mode === 'planning') {
        vehicleRef.current?.remove();
        vehicleRef.current = null;
        if (map.getSource('route-traveled')) setData(map, 'route-traveled', EMPTY_FC);
        return;
      }
      if (!vehicleRef.current) {
        const el = document.createElement('div');
        el.className = `vehicle${s.mode === 'simulating' ? ' vehicle--sim' : ''}`;
        el.innerHTML = '<span class="vehicle__pulse"></span><span class="vehicle__dot"><span class="vehicle__arrow"></span></span>';
        el.setAttribute('aria-label', 'Your position');
        vehicleRef.current = new Marker({ element: el, rotationAlignment: 'map' }).setLngLat(v.coordinate).addTo(map);
      }
      vehicleRef.current.setLngLat(v.coordinate);
      if (v.headingDeg !== undefined) vehicleRef.current.setRotation(v.headingDeg);
      if (s.followVehicle && !transitioning.current) {
        if (s.mode === 'simulating') map.jumpTo({ center: v.coordinate });
        else map.easeTo({ center: v.coordinate, duration: reduced ? 0 : 800, easing: (t) => t });
      }
      const now = performance.now();
      if (s.plan && s.progress && now - lastTraveled > 200 && map.getSource('route-traveled')) {
        lastTraveled = now;
        const { route } = s.plan.timed;
        setData(map, 'route-traveled', lineFeature(sliceLine(route.geometry, s.plan.timed.cumDistM, 0, s.progress.distanceAlongM)));
      }
    };
    update();
    const unsub = useAppStore.subscribe((s) => s.vehicle, update);
    const unsubMode = useAppStore.subscribe((s) => s.mode, update);
    return () => {
      unsub();
      unsubMode();
    };
  }, [styleVersion, reduced]);

  // Camera when navigation starts/stops.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const s = useAppStore.getState();
    if (mode === 'planning') {
      if (s.plan && styleVersion) fitRoute(true);
      return;
    }
    const v = s.vehicle;
    if (v) {
      transitioning.current = true;
      map.once('moveend', () => (transitioning.current = false));
      map.easeTo({ center: v.coordinate, zoom: mode === 'simulating' ? 10.5 : 14, duration: reduced ? 0 : 900 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const recenter = () => {
    const s = useAppStore.getState();
    s.setFollow(true);
    const v = s.vehicle;
    const map = mapRef.current;
    if (v && map) {
      transitioning.current = true;
      map.once('moveend', () => (transitioning.current = false));
      map.easeTo({ center: v.coordinate, zoom: Math.max(map.getZoom(), 10), duration: reduced ? 0 : 500 });
    }
  };

  const pointsById = useMemo(() => new Map(displayPoints.map((p) => [p.id, p])), [displayPoints]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" aria-label="Map of your route" role="region" />
      {mapError ? <div className="map-error">{mapError}</div> : null}
      {hosts.map((h) => {
        const p = pointsById.get(h.id);
        return p
          ? createPortal(
              <WeatherMarker
                point={p}
                selected={selectedId === p.id}
                highlighted={highlightedId === p.id}
                navigating={navigating}
                onSelect={onMarkerSelect}
              />,
              h.el,
              h.id,
            )
          : null;
      })}
      <div className="map-controls" style={{ bottom: insets.bottom + 12 }}>
        {navigating && !follow ? (
          <button className="map-fab" onClick={recenter} aria-label="Recenter on your position">
            <LocateIcon size={20} />
            <span>Recenter</span>
          </button>
        ) : null}
        {!navigating && plan && userMoved ? (
          <button className="map-fab" onClick={() => fitRoute(true)} aria-label="Show whole route">
            <span>Show whole route</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
