import { AttributionControl, Map as MLMap, Marker, setWorkerUrl, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 resolves its worker relative to its own module URL, which breaks
// once bundled — let Vite build the worker and hand MapLibre the final URL.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEffectiveTheme } from '../../hooks/useEffectiveTheme';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { createRouteProjector } from '../../algorithms/placesAlongRoute';
import { formatDuration } from '../../i18n/format';
import { navigationZoom } from '../../navigation/instructions';
import { getProviders } from '../../services/providers';
import { useExplore } from '../../state/explore';
import { useLayoutStore } from '../../state/layout';
import { selectScrub } from '../../state/scrub';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { LngLat } from '../../types/geo';
import type { TimedRoute } from '../../types/route';
import { lowerIndex, sliceLine } from '../../utils/distance';
import { LocateIcon } from '../Icons/Icons';
import { exposureLine, roadNames } from '../Plan/RouteOptions';
import { WeatherMarker } from '../WeatherMarker/WeatherMarker';
import { add3dBuildings, addRouteLayers, EMPTY_FC, fillMissingStyleImages, lineFeature, pointFeature, routeGradient, setData } from './mapLayers';
import { useExploreLayer } from './useExploreLayer';
import { useLiveLayer } from './useLiveLayer';
import { useWeatherLayer } from './useWeatherLayer';
import './Map.css';

setWorkerUrl(maplibreWorkerUrl);

/** While driving, the camera returns to the car this long after the last pan/zoom. */
const RECENTER_AFTER_MS = 12_000;

interface Host {
  id: string;
  el: HTMLDivElement;
  marker: Marker;
}

/** Cumulative Web-Mercator length per vertex — what MapLibre's line-progress measures. */
function mercatorProgress(timed: TimedRoute): (distanceM: number) => number {
  const g = timed.route.geometry;
  const merc = new Float64Array(g.length);
  const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  for (let i = 1; i < g.length; i++) {
    const dx = ((g[i][0] - g[i - 1][0]) * Math.PI) / 180;
    const dy = y(g[i][1]) - y(g[i - 1][1]);
    merc[i] = merc[i - 1] + Math.hypot(dx, dy);
  }
  const total = merc[g.length - 1] || 1;
  return (d) => {
    const i = lowerIndex(timed.cumDistM, d);
    if (i >= g.length - 1) return 1;
    const span = timed.cumDistM[i + 1] - timed.cumDistM[i];
    const t = span > 0 ? (d - timed.cumDistM[i]) / span : 0;
    return (merc[i] + (merc[i + 1] - merc[i]) * t) / total;
  };
}

/**
 * The map: route (driven part greyed), subtle weather glow, weather markers
 * (the same points as the strip), places, the vehicle, and a navigation
 * camera (heading-up, auto-zoom around maneuvers, manual override + recenter).
 */
export default function RouteMap({ viewer = false }: { viewer?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const hostsRef = useRef(new Map<string, Host>());
  const vehicleRef = useRef<Marker | null>(null);
  const transitioning = useRef(false);
  const [styleVersion, setStyleVersion] = useState(0);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const { theme } = useEffectiveTheme();
  const m = useMessages();
  const dark = theme === 'dark';
  const initialDark = useRef(dark);
  const reduced = useReducedMotion();
  const batterySaver = useSettings((s) => s.batterySaver);
  const insets = useLayoutStore((s) => s.insets);

  const timed = useAppStore((s) => s.plan?.timed ?? null);
  const displayPoints = useAppStore((s) => s.derived.displayPoints);
  const allPoints = useAppStore((s) => s.derived.points);
  const segments = useAppStore((s) => s.derived.routeSegments);
  const selectedId = useAppStore((s) => s.selectedPointId);
  const selectionSource = useAppStore((s) => s.selectionSource);
  const highlightedId = useAppStore((s) => s.highlightedPointId);
  const scrub = useAppStore(selectScrub);
  const poi = useAppStore((s) => s.poi);
  const mode = useAppStore((s) => s.mode);
  const follow = useAppStore((s) => s.followVehicle);
  const navigating = mode !== 'planning';

  const padding = useMemo(() => {
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;
    const top = insets.top + 8;
    const bottom = Math.min(insets.bottom + 8, Math.max(0, h - top - 160));
    return { top, bottom, left: insets.left + 16, right: 16 };
  }, [insets.top, insets.bottom, insets.left]);
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
        attributionControl: false, // placed top-right so the sheet never hides it
        pitchWithRotate: false,
        fadeDuration: 150,
      });
    } catch {
      setMapError(m.ui.mapUnavailable);
      return;
    }
    map.addControl(new AttributionControl({ compact: true }), 'top-right');
    fillMissingStyleImages(map);
    map.on('style.load', () => {
      addRouteLayers(map);
      add3dBuildings(map);
      setStyleVersion((v) => v + 1);
    });
    map.on('error', (e) => {
      if (!map.isStyleLoaded() && !map.loaded()) setMapError(m.ui.mapUnavailable);
      console.warn('[map]', e.error?.message ?? e);
    });
    const stopFollow = (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) return; // programmatic camera moves
      setUserMoved(true);
      const s = useAppStore.getState();
      if (s.mode !== 'planning' && s.followVehicle) s.setFollow(false);
      if (useExplore.getState().followMe) useExplore.getState().setFollowMe(false);
    };
    map.on('dragstart', stopFollow);
    map.on('zoomstart', stopFollow);
    map.on('rotatestart', stopFollow);
    map.on('move', () => scheduleDeclutter());
    map.on('moveend', () => {
      const c = map.getCenter();
      useExplore.getState().setView({ center: [c.lng, c.lat], zoom: map.getZoom() });
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
    if (map.isMoving()) {
      const apply = () => map.setPadding(paddingRef.current);
      map.once('moveend', apply);
      return () => {
        map.off('moveend', apply);
      };
    }
    // A route the user hasn't panned away from is re-framed in the new space.
    const st = useAppStore.getState();
    if (st.mode === 'planning' && st.plan && !userMovedRef.current && !useExplore.getState().card) {
      map.setPadding(padding);
      fitRouteRef.current?.(true);
      return;
    }
    // Otherwise keep what's on screen still (a sheet opening must not slide
    // the map and the pin under your finger); camera moves use the new padding.
    const { width, height } = map.getContainer().getBoundingClientRect();
    const x = padding.left + (width - padding.left - padding.right) / 2;
    const y = padding.top + (height - padding.top - padding.bottom) / 2;
    if (width > 0 && height > 0) map.jumpTo({ center: map.unproject([x, y]), padding });
    else map.setPadding(padding);
  }, [padding]);

  const fitRoute = useCallback(
    (animate: boolean) => {
      const map = mapRef.current;
      const s = useAppStore.getState();
      if (!map || !s.plan) return;
      // While choosing, frame every option so the alternatives are visible too.
      const boxes = s.mode === 'planning' && s.routeOptions.length > 1 ? s.routeOptions.map((o) => o.timed.route.bbox) : [s.plan.timed.route.bbox];
      const w = Math.min(...boxes.map((b) => b[0]));
      const so = Math.min(...boxes.map((b) => b[1]));
      const e = Math.max(...boxes.map((b) => b[2]));
      const n = Math.max(...boxes.map((b) => b[3]));
      // fitBounds padding is added to the overlay insets (setPadding).
      map.fitBounds(
        [
          [w, so],
          [e, n],
        ],
        { padding: 24, bearing: 0, pitch: 0, duration: animate && !reduced ? 700 : 0, maxZoom: 13 },
      );
      setUserMoved(false);
    },
    [reduced],
  );

  const userMovedRef = useRef(userMoved);
  userMovedRef.current = userMoved;
  const fitRouteRef = useRef(fitRoute);
  fitRouteRef.current = fitRoute;
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

  // ---- Route geometry: only when the ROUTE changes (not on every plan update) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    if (!timed) {
      for (const id of ['route', 'route-weather', 'endpoints', 'focus', 'pois', 'cameras', 'hazards', 'incidents', 'alternatives', 'transit', 'transit-stops']) {
        setData(map, id, EMPTY_FC);
      }
      return;
    }
    const g = timed.route.geometry;
    // Public transport is drawn leg by leg (walks dotted, rides in their line's colour) instead of one route line.
    const trip = timed.route.transit;
    setData(map, 'route', trip ? EMPTY_FC : lineFeature(g));
    setData(map, 'transit', {
      type: 'FeatureCollection',
      features: (trip?.legs ?? [])
        .filter((l) => l.toIndex > l.fromIndex)
        .map((l) => lineFeature(g.slice(l.fromIndex, l.toIndex + 1), { walk: l.vehicle === 'walk', ...(l.color ? { color: l.color } : {}) })),
    });
    setData(map, 'transit-stops', {
      type: 'FeatureCollection',
      features: (trip?.legs ?? [])
        .filter((l) => l.vehicle !== 'walk')
        .flatMap((l) => [pointFeature(g[l.fromIndex], l.color ? { color: l.color } : {}), pointFeature(g[l.toIndex], l.color ? { color: l.color } : {})]),
    });
    setData(map, 'endpoints', {
      type: 'FeatureCollection',
      features: [pointFeature(g[0], { role: 'origin' }), pointFeature(g[g.length - 1], { role: 'destination' })],
    });
    map.setPaintProperty('route-line', 'line-gradient', routeGradient(0));
  }, [timed, styleVersion]);

  const routeId = timed?.route.id;
  useEffect(() => {
    if (routeId && styleVersion && useAppStore.getState().mode === 'planning') fitRoute(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, styleVersion > 0]);

  // ---- Weather-coloured stretches -------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion || !timed) return;
    setData(map, 'route-weather', {
      type: 'FeatureCollection',
      features: segments
        .map((s) => lineFeature(sliceLine(timed.route.geometry, timed.cumDistM, s.startM, s.endM), { cls: s.groupClass }))
        .filter((f) => (f.geometry as GeoJSON.LineString).coordinates.length > 1),
    });
  }, [segments, timed, styleVersion]);

  // ---- Alternative routes: grey lines + a time/weather label; tap to choose ----------
  const routeOptions = useAppStore((s) => s.routeOptions);
  const selectedOption = useAppStore((s) => s.selectedOption);
  const optionSummaries = useAppStore((s) => s.derived.options);
  const otherRoads = useAppStore((s) => s.derived.otherRoads);
  const offered = useAppStore((s) => s.weatherReroute?.plan ?? null);
  const altLabels = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    altLabels.current.forEach((mk) => mk.remove());
    altLabels.current = [];
    // Public-transport trips are other departures, mostly on the same streets: chosen in the sheet, not on the map.
    const planning = mode === 'planning' && routeOptions.length > 1 && !routeOptions[0]?.timed.route.transit;
    const alts = planning ? routeOptions.map((o, i) => ({ o, i })).filter(({ i }) => i !== selectedOption) : [];
    // Driving: a re-route on offer, and the other roads the car can still take (quiet, not tappable — switching is in the sheet).
    const driving = mode !== 'planning'
      ? [
          ...(offered ? [lineFeature(offered.timed.route.geometry, { index: -1 })] : []),
          ...otherRoads.flatMap((r) => (routeOptions[r.index] ? [lineFeature(routeOptions[r.index].timed.route.geometry, { index: -1 })] : [])),
        ]
      : null;
    setData(map, 'alternatives', {
      type: 'FeatureCollection',
      features: driving ?? alts.map(({ o, i }) => lineFeature(o.timed.route.geometry, { index: i })),
    });
    const chosen = routeOptions[selectedOption];
    if (!planning || !chosen) return;
    const project = createRouteProjector(chosen.timed);
    for (const { o, i } of alts) {
      // Label where this option is furthest from the chosen route (where it visibly differs).
      const g = o.timed.route.geometry;
      let best = g[Math.floor(g.length / 2)];
      let bestD = -1;
      for (let k = 0; k < g.length; k += Math.max(1, Math.floor(g.length / 60))) {
        const d = project(g[k]).distanceFromLineM;
        if (d > bestD) {
          bestD = d;
          best = g[k];
        }
      }
      const summary = optionSummaries.find((x) => x.index === i);
      const delta = o.timed.totalTimeS - chosen.timed.totalTimeS;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'altlabel';
      const time = Math.abs(delta) < 60 ? m.ui.same : `${delta > 0 ? '+' : '−'}${formatDuration(Math.abs(delta), m)}`;
      const wet = summary?.hasWeather ? exposureLine(summary, m, 1) : '';
      el.textContent = wet ? `${time} · ${wet}` : time;
      el.setAttribute('aria-label', `${roadNames(optionSummaries, m).get(i) ?? `${m.ui.alternative} ${i}`}: ${el.textContent}`);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        void useAppStore.getState().selectRouteOption(i);
      });
      // Open towards the middle of the routes so a label near the edge isn't cut off.
      const [w, , e] = chosen.timed.route.bbox;
      const anchor = best[0] < (w + e) / 2 ? 'left' : 'right';
      altLabels.current.push(new Marker({ element: el, anchor, offset: [anchor === 'left' ? 6 : -6, 0] }).setLngLat(best).addTo(map));
    }
  }, [routeOptions, selectedOption, optionSummaries, otherRoads, offered, mode, styleVersion, m]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const i = Number(e.features?.[0]?.properties?.index);
      if (Number.isFinite(i) && useAppStore.getState().mode === 'planning') void useAppStore.getState().selectRouteOption(i);
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', 'alt-hit', onClick);
    map.on('mouseenter', 'alt-hit', enter);
    map.on('mouseleave', 'alt-hit', leave);
    return () => {
      map.off('click', 'alt-hit', onClick);
      map.off('mouseenter', 'alt-hit', enter);
      map.off('mouseleave', 'alt-hit', leave);
    };
  }, [styleVersion]);

  // ---- Speed cameras (only when enabled) ------------------------------------------
  const cameras = useAppStore((s) => s.speedCameras);
  const camerasOn = useSettings((s) => s.speedCameras);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    setData(map, 'cameras', {
      type: 'FeatureCollection',
      features: camerasOn ? cameras.map((c) => pointFeature(c.coordinate, { id: c.id })) : [],
    });
  }, [cameras, camerasOn, styleVersion]);

  // ---- Road hazards ahead (sharp curves, level crossings) while driving ------------
  const hazards = useAppStore((s) => (s.mode !== 'planning' ? s.roadHazards : null));
  const hazardsOn = useSettings((s) => s.roadHazards);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    setData(map, 'hazards', {
      type: 'FeatureCollection',
      features: hazardsOn && hazards ? hazards.map((h) => pointFeature(h.coordinate, { id: h.id, kind: h.kind })) : [],
    });
  }, [hazards, hazardsOn, styleVersion]);

  // ---- Incidents / driver reports on the route --------------------------------------
  const incidents = useAppStore((s) => s.incidents);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    setData(map, 'incidents', {
      type: 'FeatureCollection',
      features: timed ? incidents.map((i) => pointFeature(i.coordinate, { id: i.id, kind: i.kind, verified: i.verified })) : [],
    });
  }, [incidents, timed, styleVersion]);

  // ---- Places: along the route, or "near here" while exploring; tap → card ----------
  const nearby = useExplore((s) => s.nearby);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    const list = poi?.results.map((r) => r.poi) ?? (timed ? [] : (nearby?.results.map((r) => r.poi) ?? []));
    setData(map, 'pois', {
      type: 'FeatureCollection',
      features: list.map((p) => pointFeature(p.coordinate, { id: p.id })),
    });
    if (!timed && nearby?.status === 'ready' && nearby.results.length) {
      const pts = nearby.results.slice(0, 12).map((r) => r.poi.coordinate).concat([nearby.center]);
      const w = Math.min(...pts.map((p) => p[0]));
      const e = Math.max(...pts.map((p) => p[0]));
      const s = Math.min(...pts.map((p) => p[1]));
      const n = Math.max(...pts.map((p) => p[1]));
      map.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 16, duration: reduced ? 0 : 600 });
    }
  }, [poi, nearby, timed, styleVersion, reduced]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      const all = [...(useAppStore.getState().poi?.results ?? []), ...(useExplore.getState().nearby?.results ?? [])];
      const hit = all.find((r) => r.poi.id === id);
      if (hit && useAppStore.getState().mode === 'planning') useExplore.getState().openPoi(hit.poi);
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', 'pois', onClick);
    map.on('mouseenter', 'pois', enter);
    map.on('mouseleave', 'pois', leave);
    return () => {
      map.off('click', 'pois', onClick);
      map.off('mouseenter', 'pois', enter);
      map.off('mouseleave', 'pois', leave);
    };
  }, [styleVersion]);

  // ---- Focus ring (selected card > scrubbed time > scroll highlight) ---------
  const focusPoint = useMemo(() => {
    if (!selectedId && scrub) return { coord: scrub.coordinate, strong: true };
    const id = selectedId ?? highlightedId;
    if (!id) return null;
    const p = id === 'current' ? useAppStore.getState().derived.currentPoint : allPoints.find((x) => x.id === id);
    return p ? { coord: [p.longitude, p.latitude] as LngLat, strong: id === selectedId } : null;
  }, [selectedId, highlightedId, allPoints, scrub]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion) return;
    setData(map, 'focus', focusPoint ? pointFeature(focusPoint.coord, { strong: focusPoint.strong }) : EMPTY_FC);
  }, [focusPoint, styleVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || selectionSource !== 'timeline' || !focusPoint) return;
    map.easeTo({ center: focusPoint.coord, zoom: Math.max(map.getZoom(), 9), duration: reduced ? 0 : 650 });
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
      const ordered = list.map((p, i) => ({ p, pr: priority(p.id, i), i })).sort((a, b) => a.pr - b.pr || a.i - b.i);
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
    let changed = false;
    for (const [id, h] of hostsRef.current) {
      if (!want.has(id)) {
        h.marker.remove();
        hostsRef.current.delete(id);
        changed = true;
      }
    }
    for (const p of displayPoints) {
      if (hostsRef.current.has(p.id)) continue;
      const el = document.createElement('div');
      el.className = 'wmarker-host';
      const marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([p.longitude, p.latitude]).addTo(map);
      hostsRef.current.set(p.id, { id: p.id, el, marker });
      changed = true;
    }
    if (changed) setHosts(displayPoints.map((p) => hostsRef.current.get(p.id)!).filter(Boolean));
    scheduleDeclutter();
  }, [displayPoints, scheduleDeclutter]);

  useEffect(() => scheduleDeclutter(), [selectedId, highlightedId, scheduleDeclutter]);

  const onMarkerSelect = useCallback((id: string) => {
    const s = useAppStore.getState();
    s.select(s.selectedPointId === id ? null : id, 'map');
  }, []);

  // ---- Vehicle, driven route and the navigation camera (imperative) ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let lastTraveled = 0;
    let lastCamera = 0;
    let progressFn: ((d: number) => number) | null = null;
    let progressFor: TimedRoute | null = null;
    let bearing = map.getBearing();
    let zoom = map.getZoom();
    // The smoothing below eases from the camera's last zoom/bearing. Whenever something else moved the camera
    // (the start-of-drive move, a pan, the overview), pick up from where it actually is — not from where it was
    // when this effect ran, or the camera would drift back out to the overview and creep in.
    let steering = false;

    const update = () => {
      const s = useAppStore.getState();
      const v = s.vehicle;
      if (!v || s.mode === 'planning' || !s.plan) {
        vehicleRef.current?.remove();
        vehicleRef.current = null;
        if (map.getLayer('route-line')) map.setPaintProperty('route-line', 'line-gradient', routeGradient(0));
        return;
      }
      if (!vehicleRef.current) {
        const el = document.createElement('div');
        el.className = 'vehicle';
        el.innerHTML = '<span class="vehicle__dot"><span class="vehicle__arrow"></span></span>';
        el.setAttribute('aria-hidden', 'true');
        vehicleRef.current = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(v.coordinate).addTo(map);
      }
      vehicleRef.current.setLngLat(v.coordinate);
      if (v.headingDeg !== undefined) vehicleRef.current.setRotation(v.headingDeg);

      const now = performance.now();
      const saver = useSettings.getState().batterySaver;

      // Driven part of the route: one paint property, ≤5×/s.
      if (s.progress && now - lastTraveled > (saver ? 1000 : 200) && map.getLayer('route-line')) {
        lastTraveled = now;
        if (progressFor !== s.plan.timed) {
          progressFn = mercatorProgress(s.plan.timed);
          progressFor = s.plan.timed;
        }
        map.setPaintProperty('route-line', 'line-gradient', routeGradient(progressFn!(s.progress.distanceAlongM)));
      }

      // Navigation camera: heading-up, zoom out on open road, in near maneuvers.
      if (!s.followVehicle || transitioning.current) {
        steering = false;
        return;
      }
      if (saver && now - lastCamera < 500) return;
      lastCamera = now;
      if (!steering) {
        zoom = map.getZoom();
        bearing = map.getBearing();
        steering = true;
      }
      const g = s.guidance;
      const targetZoom = navigationZoom(g?.next ? g.distanceToNextM : null, v.speedMps ?? 14);
      const simFast = s.mode === 'simulating' && s.sim.speed > 10;
      zoom += (targetZoom - (simFast ? 1 : 0) - zoom) * (reduced ? 1 : 0.08);
      if (v.headingDeg !== undefined && Number.isFinite(v.headingDeg)) {
        const d = ((v.headingDeg - bearing + 540) % 360) - 180;
        bearing = (bearing + d * (reduced ? 1 : 0.15) + 360) % 360;
      }
      const pitch = saver || reduced ? 0 : 45;
      if (s.mode === 'simulating') map.jumpTo({ center: v.coordinate, bearing, zoom, pitch });
      else map.easeTo({ center: v.coordinate, bearing, zoom, pitch, duration: reduced ? 0 : 800, easing: (t) => t });
    };
    update();
    const unsub = useAppStore.subscribe((s) => s.vehicle, update);
    const unsubMode = useAppStore.subscribe((s) => s.mode, update);
    return () => {
      unsub();
      unsubMode();
    };
  }, [styleVersion, reduced, batterySaver]);

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
      // Straight to street level, like a phone's navigation app: the road you're on and the next turn.
      const g = s.guidance;
      const simFast = mode === 'simulating' && s.sim.speed > 10;
      map.easeTo({
        center: v.coordinate,
        zoom: navigationZoom(g?.next ? g.distanceToNextM : null, v.speedMps ?? 0) - (simFast ? 1 : 0),
        bearing: v.headingDeg ?? 0,
        pitch: reduced ? 0 : 45,
        duration: reduced ? 0 : 1200,
      });
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
      map.easeTo({
        center: v.coordinate,
        zoom: Math.max(map.getZoom(), 16.5),
        bearing: v.headingDeg ?? map.getBearing(),
        pitch: reduced ? 0 : 45,
        duration: reduced ? 0 : 500,
      });
    }
  };

  useExploreLayer(mapRef, styleVersion, { viewer, reduced });
  useLiveLayer(mapRef, styleVersion, { enabled: viewer, reduced });
  useWeatherLayer(mapRef, styleVersion);

  // Driving: after the user pans away and leaves the map alone, go back to following.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigating || follow) return;
    let t = window.setTimeout(maybeRecenter, RECENTER_AFTER_MS);
    function maybeRecenter() {
      const s = useAppStore.getState();
      if (s.mode !== 'planning' && !s.followVehicle && !s.selectedPointId && !map!.isMoving()) recenter();
    }
    const restart = () => {
      window.clearTimeout(t);
      t = window.setTimeout(maybeRecenter, RECENTER_AFTER_MS);
    };
    map.on('movestart', restart);
    map.on('moveend', restart);
    return () => {
      window.clearTimeout(t);
      map.off('movestart', restart);
      map.off('moveend', restart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating, follow, styleVersion]);

  // Compass: visible when the map is rotated or tilted (not while the car camera steers it).
  const [bearing, setBearing] = useState(0);
  const [tilted, setTilted] = useState(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      setBearing(Math.round(map.getBearing()));
      setTilted(map.getPitch() > 1);
    };
    sync();
    map.on('rotate', sync);
    map.on('pitch', sync);
    return () => {
      map.off('rotate', sync);
      map.off('pitch', sync);
    };
  }, [styleVersion]);
  const showCompass = (bearing !== 0 || tilted) && (!navigating || !follow);

  // 3D buildings only while the map is tilted (and not in battery saver).
  const show3d = tilted && !batterySaver;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion || !map.getLayer('building-3d')) return;
    map.setLayoutProperty('building-3d', 'visibility', show3d ? 'visible' : 'none');
  }, [show3d, styleVersion]);
  const resetNorth = () => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: reduced ? 0 : 400 });

  const pointsById = useMemo(() => new Map(displayPoints.map((p) => [p.id, p])), [displayPoints]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" aria-label={m.ui.overview} role="region" />
      {mapError ? <div className="map-error">{mapError}</div> : null}
      {showCompass ? (
        <button className="compass" onClick={resetNorth} aria-label={m.ui.northUp} title={m.ui.northUp}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
            <path d="M12 3l3.2 9H8.8L12 3z" fill="var(--sev-critical)" />
            <path d="M12 21l-3.2-9h6.4L12 21z" fill="currentColor" opacity="0.55" />
          </svg>
        </button>
      ) : null}
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
      <div className="map-controls">
        {navigating && !follow ? (
          <button className="map-fab" onClick={recenter}>
            <LocateIcon size={20} />
            <span>{m.ui.recenter}</span>
          </button>
        ) : null}
        {!navigating && timed && userMoved ? (
          <button className="map-fab" onClick={() => fitRoute(true)}>
            <span>{m.ui.overview}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
