import { Marker, type Map as MLMap, type MapMouseEvent, type MapTouchEvent } from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';
import { useExplore } from '../../state/explore';
import { useSavedPlaces } from '../../state/savedPlaces';
import { currentMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { LngLat } from '../../types/geo';
import { circleFeature, EMPTY_FC, setData } from './mapLayers';

const PIN_SVG =
  '<svg viewBox="0 0 30 40" width="30" height="40" aria-hidden="true"><path d="M15 39s12-12.6 12-23A12 12 0 0 0 3 16c0 10.4 12 23 12 23z" fill="#d93025" stroke="#fff" stroke-width="2"/><circle cx="15" cy="16" r="4.5" fill="#fff"/></svg>';

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const SAVED_GLYPH: Record<'home' | 'work' | 'favorite', string> = {
  home: icon('M4 11l8-7 8 7M6 9.5V20h4v-5h4v5h4V9.5'),
  work: icon('M3.5 8.5h17v11h-17zM9 8.5v-2A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5v2'),
  favorite: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/></svg>`,
};

/** How long a finger must rest on the map to drop a pin. */
const LONG_PRESS_MS = 500;

/**
 * Map side of EXPLORE: the blue "you are here" dot (+ accuracy), follow-me
 * camera, the selected place's pin, and dropping pins (mouse click /
 * right-click, or press-and-hold on touch screens).
 */
export function useExploreLayer(mapRef: RefObject<MLMap | null>, styleVersion: number, opts: { viewer: boolean; reduced: boolean }) {
  const ready = styleVersion > 0;

  // ---- "You are here" -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let dot: Marker | null = null;
    let flyPending = useExplore.getState().locate === 'pending';

    const render = () => {
      const ex = useExplore.getState();
      const app = useAppStore.getState();
      const fix = ex.myLocation;
      // While driving the vehicle puck is the position.
      const show = !!fix && (opts.viewer || app.mode === 'planning');
      if (!show || !fix) {
        dot?.remove();
        dot = null;
        setData(map, 'me-accuracy', EMPTY_FC);
        return;
      }
      if (!dot) {
        // A button only where it does something (the "you" card); the viewer's dot is decoration.
        const el = document.createElement(opts.viewer ? 'div' : 'button');
        el.className = 'me-dot';
        if (opts.viewer) el.setAttribute('aria-hidden', 'true');
        else {
          (el as HTMLButtonElement).type = 'button';
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            useExplore.getState().showMe();
          });
        }
        el.innerHTML = '<span class="me-dot__pulse"></span><span class="me-dot__cone"></span><span class="me-dot__core"></span>';
        dot = new Marker({ element: el }).setLngLat(fix.coordinate).addTo(map);
      }
      dot.setLngLat(fix.coordinate);
      const el = dot.getElement();
      if (!opts.viewer) el.setAttribute('aria-label', currentMessages().ui.currentLocation);
      el.classList.toggle('has-heading', fix.headingDeg !== undefined && (fix.speedMps ?? 0) > 0.5);
      el.classList.toggle('is-stale', Date.now() - fix.timestampMs > 120_000);
      const cone = el.querySelector<HTMLElement>('.me-dot__cone');
      if (cone && fix.headingDeg !== undefined) cone.style.transform = `rotate(${fix.headingDeg}deg)`;
      setData(map, 'me-accuracy', fix.accuracyM && fix.accuracyM > 15 ? circleFeature(fix.coordinate, Math.min(fix.accuracyM, 5000)) : EMPTY_FC);
    };

    const camera = (fix: LngLat, first: boolean) => {
      if (first) map.flyTo({ center: fix, zoom: Math.max(map.getZoom(), 15.5), duration: opts.reduced ? 0 : 900 });
      else map.easeTo({ center: fix, duration: opts.reduced ? 0 : 500 });
    };

    render();
    const unsubFix = useExplore.subscribe(
      (s) => s.myLocation,
      (fix) => {
        render();
        if (!fix) return;
        const ex = useExplore.getState();
        if (flyPending) {
          flyPending = false;
          camera(fix.coordinate, true);
        } else if (ex.followMe && useAppStore.getState().mode === 'planning') camera(fix.coordinate, false);
      },
    );
    // A tap on "locate": fly now if we already know where you are, else on the first fix.
    const unsubLocate = useExplore.subscribe(
      (s) => s.locateSeq,
      () => {
        const fix = useExplore.getState().myLocation;
        if (fix && Date.now() - fix.timestampMs < 30_000) {
          flyPending = false;
          camera(fix.coordinate, true);
        } else flyPending = true;
      },
    );
    const unsubMode = useAppStore.subscribe((s) => s.mode, render);
    // Grey the dot out when fixes stop arriving.
    const staleTimer = window.setInterval(render, 30_000);
    return () => {
      unsubFix();
      unsubLocate();
      unsubMode();
      window.clearInterval(staleTimer);
      dot?.remove();
    };
    // styleVersion: the accuracy source is re-created with every basemap style.
  }, [mapRef, ready, styleVersion, opts.viewer, opts.reduced]);

  // ---- Selected place pin ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || opts.viewer) return;
    let pin: Marker | null = null;
    const render = (flyTo: boolean) => {
      const card = useExplore.getState().card;
      if (!card || card.place.kind === 'me') {
        pin?.remove();
        pin = null;
        return;
      }
      if (!pin) {
        const el = document.createElement('div');
        el.className = 'place-pin';
        el.innerHTML = PIN_SVG;
        pin = new Marker({ element: el, anchor: 'bottom' }).setLngLat(card.place.coordinate).addTo(map);
      }
      pin.setLngLat(card.place.coordinate);
      if (flyTo) {
        const kind = card.place.kind ?? '';
        const zoom = /city|country|state|county|region/.test(kind) ? 10 : /town|village|suburb/.test(kind) ? 12 : 14;
        map.flyTo({ center: card.place.coordinate, zoom: Math.max(zoom, Math.min(map.getZoom(), 15)), duration: opts.reduced ? 0 : 900 });
      }
    };
    // A place opened from a link before the map existed still gets flown to.
    const initial = useExplore.getState().card;
    render(!!initial && (initial.source === 'search' || initial.source === 'link'));
    const unsub = useExplore.subscribe(
      (s) => s.card?.place.id,
      () => {
        const card = useExplore.getState().card;
        render(!!card && (card.source === 'search' || card.source === 'link'));
      },
    );
    return () => {
      unsub();
      pin?.remove();
    };
  }, [mapRef, ready, opts.viewer, opts.reduced]);

  // ---- Saved places: parking spot, Home, Work, favourites (this device only) ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || opts.viewer) return;
    const markers = new Map<string, Marker>();
    const render = () => {
      const { saved } = useSavedPlaces.getState();
      const app = useAppStore.getState();
      // While driving, only the parking spot matters; the rest is planning context.
      const visible = app.mode === 'planning' ? saved : saved.filter((s) => s.slot === 'parking');
      const keep = new Set(visible.map((s) => `${s.slot}:${s.id}`));
      for (const [k, mk] of markers) {
        if (!keep.has(k)) {
          mk.remove();
          markers.delete(k);
        }
      }
      for (const place of visible) {
        const k = `${place.slot}:${place.id}`;
        let mk = markers.get(k);
        if (!mk) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = place.slot === 'parking' ? 'parking-pin' : `saved-pin saved-pin--${place.slot}`;
          if (place.slot === 'parking') el.textContent = 'P';
          else el.innerHTML = SAVED_GLYPH[place.slot];
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            useExplore.getState().selectPlace(place, 'search');
          });
          mk = new Marker({ element: el }).setLngLat(place.coordinate).addTo(map);
          markers.set(k, mk);
        }
        const m = currentMessages();
        const name = place.slot === 'home' ? m.explore.home : place.slot === 'work' ? m.explore.work : place.name;
        mk.getElement().setAttribute('aria-label', name);
        mk.getElement().title = name;
      }
    };
    render();
    const unsub = useSavedPlaces.subscribe(render);
    const unsubMode = useAppStore.subscribe((s) => s.mode, render);
    return () => {
      unsub();
      unsubMode();
      markers.forEach((mk) => mk.remove());
    };
  }, [mapRef, ready, opts.viewer]);

  // ---- Dropping pins --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || opts.viewer) return;
    let lastTouchAt = 0;
    let pressTimer = 0;
    let pressStart: { x: number; y: number } | null = null;
    let longPressAt = 0;
    let clickTimer = 0;
    /** The current touch already dropped a pin: its lift-off "click" is not a tap. */
    let pressDropped = false;

    const canDrop = () => useAppStore.getState().mode === 'planning';
    const drop = (lngLat: { lng: number; lat: number }) => {
      if (!canDrop()) return;
      useAppStore.getState().select(null, 'map');
      useExplore.getState().dropPin([lngLat.lng, lngLat.lat]);
    };
    const cancelPress = () => {
      window.clearTimeout(pressTimer);
      pressStart = null;
    };

    const onClick = (e: MapMouseEvent) => {
      if (e.originalEvent.target !== map.getCanvas()) return; // markers handle their own clicks
      // A tap on an alternative route selects it (RouteMap handles that), not a pin.
      if (map.getLayer('alt-hit') && map.queryRenderedFeatures(e.point, { layers: ['alt-hit'] }).length) return;
      if (map.getLayer('pois') && map.queryRenderedFeatures(e.point, { layers: ['pois'] }).length) return;
      const app = useAppStore.getState();
      if (app.mode !== 'planning') return;
      if (app.selectedPointId) {
        app.select(null, 'map');
        return;
      }
      const touch = Date.now() - lastTouchAt < 800;
      if (touch) {
        // Taps dismiss; press-and-hold drops a pin (as in other map apps).
        if (pressDropped) pressDropped = false;
        else if (useExplore.getState().card) useExplore.getState().closeCard();
        return;
      }
      // Mouse: wait a moment so a double-click (zoom) doesn't drop pins.
      const lngLat = e.lngLat;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => drop(lngLat), 250);
    };
    const onDblClick = () => window.clearTimeout(clickTimer);
    const onContext = (e: MapMouseEvent) => {
      if (Date.now() - longPressAt < 1000) return; // already handled as a long press
      e.preventDefault();
      drop(e.lngLat);
    };
    const onTouchStart = (e: MapTouchEvent) => {
      lastTouchAt = Date.now();
      pressDropped = false;
      cancelPress();
      if (e.points.length !== 1 || !canDrop()) return;
      const start = { x: e.point.x, y: e.point.y };
      pressStart = start;
      pressTimer = window.setTimeout(() => {
        pressStart = null;
        pressDropped = true;
        longPressAt = Date.now();
        navigator.vibrate?.(15);
        // Where the finger is now (the camera may have moved while holding).
        drop(map.unproject([start.x, start.y]));
      }, LONG_PRESS_MS);
    };
    const onTouchMove = (e: MapTouchEvent) => {
      lastTouchAt = Date.now();
      if (pressStart && (e.points.length !== 1 || Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 10)) cancelPress();
    };
    const onTouchEnd = () => {
      lastTouchAt = Date.now();
      cancelPress();
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('contextmenu', onContext);
    map.on('touchstart', onTouchStart);
    map.on('touchmove', onTouchMove);
    map.on('touchend', onTouchEnd);
    map.on('touchcancel', onTouchEnd);
    map.on('dragstart', cancelPress);
    map.on('zoomstart', cancelPress);
    return () => {
      cancelPress();
      window.clearTimeout(clickTimer);
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('contextmenu', onContext);
      map.off('touchstart', onTouchStart);
      map.off('touchmove', onTouchMove);
      map.off('touchend', onTouchEnd);
      map.off('touchcancel', onTouchEnd);
      map.off('dragstart', cancelPress);
      map.off('zoomstart', cancelPress);
    };
  }, [mapRef, ready, opts.viewer]);
}
