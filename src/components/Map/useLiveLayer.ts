import { LngLatBounds, Marker, type Map as MLMap } from 'maplibre-gl';
import { useEffect, type RefObject } from 'react';
import type { ShareSnapshot } from '../../share/protocol';
import { useViewer } from '../../share/viewer';
import type { LngLat } from '../../types/geo';
import { EMPTY_FC, lineFeature, pointFeature, routeGradient, setData } from './mapLayers';

/**
 * Map side of a live-location link: the shared person's marker (moving
 * smoothly between updates), their route and destination, and a camera that
 * follows them until the viewer pans away.
 */
export function useLiveLayer(mapRef: RefObject<MLMap | null>, styleVersion: number, opts: { enabled: boolean; reduced: boolean }) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleVersion || !opts.enabled) return;
    let marker: Marker | null = null;
    let shown: LngLat | null = null;
    let anim = 0;
    let routeKey = '';
    let framed = false;
    let lastUpdateAt = 0;

    const place = (c: LngLat, hdg: number | undefined) => {
      marker?.setLngLat(c);
      const rot = marker?.getElement().querySelector<HTMLElement>('.friend__rot');
      if (rot) rot.style.transform = hdg !== undefined ? `rotate(${hdg}deg)` : '';
    };

    const moveTo = (to: LngLat, hdg: number | undefined) => {
      cancelAnimationFrame(anim);
      const from = shown;
      if (!from || opts.reduced) {
        shown = to;
        place(to, hdg);
        return;
      }
      // Glide over roughly the time between updates, so movement looks continuous.
      const start = performance.now();
      const dur = lastUpdateAt ? Math.min(5500, Math.max(800, start - lastUpdateAt)) : 800;
      lastUpdateAt = start;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const e = t * (2 - t);
        shown = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e];
        place(shown, hdg);
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };

    const render = (snap: ShareSnapshot | null, ended: boolean) => {
      const trip = snap?.trip ?? null;
      const key = trip ? `${trip.routeId}|${trip.route?.length ?? 0}|${trip.dest.c.join(',')}` : '';
      if (key !== routeKey) {
        routeKey = key;
        setData(map, 'route', trip?.route && trip.route.length > 1 ? lineFeature(trip.route) : EMPTY_FC);
        if (map.getLayer('route-line')) map.setPaintProperty('route-line', 'line-gradient', routeGradient(0));
        setData(map, 'endpoints', trip ? { type: 'FeatureCollection', features: [pointFeature(trip.dest.c, { role: 'destination' })] } : EMPTY_FC);
      }
      const pos = snap?.pos;
      if (!pos) return;
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'friend';
        el.innerHTML = '<span class="friend__rot vehicle__dot"><span class="vehicle__arrow"></span></span>';
        if (snap?.name) {
          const label = document.createElement('span');
          label.className = 'friend__label';
          label.textContent = snap.name; // text only — never HTML from the network
          el.appendChild(label);
        }
        marker = new Marker({ element: el }).setLngLat(pos.c).addTo(map);
      }
      marker.getElement().classList.toggle('is-ended', ended);
      moveTo(pos.c, pos.hdg);

      const follow = useViewer.getState().follow;
      if (!framed) {
        framed = true;
        if (trip) {
          const b = new LngLatBounds(pos.c, pos.c).extend(trip.dest.c);
          map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 0 });
        } else map.jumpTo({ center: pos.c, zoom: 14 });
      } else if (follow && !ended) {
        map.easeTo({ center: pos.c, zoom: Math.max(map.getZoom(), 12), duration: opts.reduced ? 0 : 1000 });
      }
    };

    const st = useViewer.getState();
    render(st.snapshot, st.status === 'ended');
    const unsub = useViewer.subscribe((s, prev) => {
      if (s.snapshot !== prev.snapshot || s.status !== prev.status) render(s.snapshot, s.status === 'ended');
    });
    const stopFollow = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && useViewer.getState().follow) useViewer.getState().setFollow(false);
    };
    map.on('dragstart', stopFollow);
    map.on('zoomstart', stopFollow);
    map.on('rotatestart', stopFollow);
    return () => {
      unsub();
      cancelAnimationFrame(anim);
      map.off('dragstart', stopFollow);
      map.off('zoomstart', stopFollow);
      map.off('rotatestart', stopFollow);
      marker?.remove();
    };
  }, [mapRef, styleVersion, opts.enabled, opts.reduced]);

  // "Follow" pressed again → jump back to them.
  useEffect(() => {
    if (!opts.enabled) return;
    return useViewer.subscribe((s, prev) => {
      if (!s.follow || prev.follow) return;
      const map = mapRef.current;
      const pos = s.snapshot?.pos;
      if (map && pos) map.easeTo({ center: pos.c, zoom: Math.max(map.getZoom(), 12), duration: opts.reduced ? 0 : 600 });
    });
  }, [mapRef, opts.enabled, opts.reduced]);
}
