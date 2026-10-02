import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { isAbortError } from '../services/http';
import { forgetLocationFailure, latestFix, LocationError, LocationWatcher, rememberFix, tripStart, type LocationErrorKind, type LocationFix } from '../services/location';
import { getProviders } from '../services/providers';
import type { LayerKind } from '../algorithms/weatherGrid';
import type { Poi, PoiCategory } from '../services/places/PoiProvider';
import { parseCoordinateText } from '../services/routePlanner';
import { placeUrl } from '../share/links';
import { useLiveShare } from '../share/liveShare';
import type { LngLat, Place } from '../types/geo';
import type { LocationForecast } from '../types/weather';
import { haversineM } from '../utils/distance';
import { isLocationNotice } from './locationNotice';
import { currentMessages } from './settings';
import { chargingSummary } from '../services/places/evCharging';
import { tripLocationErrorText, useAppStore, type SheetState } from './store';

/**
 * EXPLORE — the "map app" side: where am I, what is this place, what will
 * the weather be there (now, and when I'd arrive), and how do I get there.
 */

export interface PlaceCard {
  place: Place;
  source: 'search' | 'pin' | 'link' | 'me';
  naming: boolean;
  weather: { status: 'loading' | 'ready' | 'error'; forecast: LocationForecast | null };
  /** European AQI where available. */
  air: number | null;
  /** Drive from the user's position (only when a recent fix exists). */
  drive: { status: 'loading' | 'ready' | 'error'; durationS?: number; distanceM?: number; arrivalMs?: number } | null;
}

export interface NearbyResult {
  poi: Poi;
  distanceM: number;
}

export interface NearbySearch {
  category: PoiCategory;
  center: LngLat;
  radiusM: number;
  status: 'loading' | 'ready' | 'error';
  results: NearbyResult[];
}

export interface ExploreState {
  myLocation: LocationFix | null;
  /** off → pending (waiting for first fix) → on (dot shown). */
  locate: 'off' | 'pending' | 'on';
  followMe: boolean;
  /** Bumped on every tap of the locate button (the map flies to you). */
  locateSeq: number;
  locationError: LocationErrorKind | null;
  directionsOpen: boolean;
  query: string;
  card: PlaceCard | null;
  cardSheet: SheetState;
  /** Visible map centre (explore mode) — for the weather chip. */
  view: { center: LngLat; zoom: number } | null;
  /** Place being shared as a link (dialog open). */
  sharePlace: Place | null;
  /** "Coffee near here" results (explore mode). */
  nearby: NearbySearch | null;
  /** Forecast layer over the map and the hour it shows (0 = now … 24). */
  layer: 'off' | LayerKind;
  layerHour: number;
  /** `partial`: some grid points failed; those areas stay blank (never filled in). */
  layerStatus: 'idle' | 'loading' | 'ready' | 'partial' | 'error';
  /** A typed search is being looked up (Enter in the search field). */
  searching: boolean;

  locateMe(): void;
  stopLocate(): void;
  setFollowMe(follow: boolean): void;
  setQuery(q: string): void;
  openDirections(open: boolean): void;
  searchSubmit(text: string): Promise<void>;
  selectPlace(place: Place, source: PlaceCard['source']): void;
  /** Load the open card's weather, air quality and drive time again (after a failure). */
  retryCard(): void;
  dropPin(coordinate: LngLat): void;
  closeCard(): void;
  setCardSheet(s: SheetState): void;
  setView(view: { center: LngLat; zoom: number }): void;
  /** Card for the user's own position (tap on the blue dot). */
  showMe(): void;
  openSharePlace(place: Place): void;
  setLayer(layer: 'off' | LayerKind): void;
  setLayerHour(hour: number): void;
  searchNearby(category: PoiCategory): Promise<void>;
  clearNearby(): void;
  openPoi(poi: Poi): void;
  closeSharePlace(): void;
  directionsTo(place: Place): Promise<void>;
  addAsStop(place: Place): Promise<void>;
  /**
   * "Your location" as the start (resolved when the route is calculated).
   * `warm`: ask for the position right away (permission prompt inside the tap).
   */
  useMyLocationAsOrigin(warm?: boolean): void;
}

let cardAbort: AbortController | null = null;
let nearbyAbort: AbortController | null = null;

export function coordsLabel([lon, lat]: LngLat): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Placeholder origin: calculateRoute swaps in a fresh fix. */
export function herePlace(): Place {
  const m = currentMessages();
  return { id: 'here', name: m.ui.currentLocation, label: m.ui.currentLocation, coordinate: latestFix(10 * 60_000)?.coordinate ?? [0, 0], kind: 'here' };
}

export function locationMessage(kind: LocationErrorKind): string {
  const m = currentMessages();
  // iPhone/iPad settings live elsewhere than desktop browsers'.
  if (kind === 'denied' && isAppleMobile()) return m.location.deniedIos;
  return m.location.errors[kind];
}

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function syncUrl(place: Place | null) {
  if (typeof history === 'undefined' || location.pathname.startsWith('/live/')) return;
  const next = place ? placeUrl(place) : `${location.origin}/`;
  if (next !== location.href) history.replaceState(null, '', next);
}

export const useExplore = create<ExploreState>()(
  subscribeWithSelector((set, get) => ({
    myLocation: null,
    locate: 'off',
    followMe: false,
    locateSeq: 0,
    locationError: null,
    directionsOpen: false,
    query: '',
    card: null,
    cardSheet: 'default',
    view: null,
    sharePlace: null,
    nearby: null,
    layer: 'off',
    layerHour: 0,
    layerStatus: 'idle',
    searching: false,

    locateMe() {
      const s = get();
      // A second tap while still searching cancels (e.g. an ignored permission prompt).
      if (s.locate === 'pending') {
        get().stopLocate();
        return;
      }
      set({ followMe: true, locationError: null, locateSeq: s.locateSeq + 1 });
      if (s.locate === 'off') set({ locate: s.myLocation && Date.now() - s.myLocation.timestampMs < 30_000 ? 'on' : 'pending' });
      locationWatcher.acquire('locate');
      // Nothing at all (typically an unanswered permission prompt): stop spinning and say so.
      const seq = get().locateSeq;
      setTimeout(() => {
        const cur = get();
        if (cur.locate !== 'pending' || cur.locateSeq !== seq) return;
        cur.stopLocate();
        useAppStore.getState().showNotice('warning', currentMessages().location.noAnswer, true);
      }, 35_000);
    },
    stopLocate() {
      set({ locate: 'off', followMe: false });
      locationWatcher.release('locate');
    },
    setFollowMe: (followMe) => set({ followMe }),
    setQuery: (query) => set({ query }),
    openDirections(open) {
      set({ directionsOpen: open });
      if (open) {
        const app = useAppStore.getState();
        const card = get().card;
        if (card && !app.destination.place && !app.destination.text) app.setDestinationPlace(card.place);
        if (!app.origin.place && !app.origin.text) get().useMyLocationAsOrigin();
        get().closeCard();
      }
    },

    async searchSubmit(text) {
      const q = text.trim();
      if (!q) return;
      const coord = parseCoordinateText(q);
      if (coord) {
        get().dropPin(coord);
        return;
      }
      const m = currentMessages();
      if (get().searching) return; // Enter pressed again while the first lookup runs
      set({ searching: true });
      const typed = get().query;
      try {
        const place = await getProviders().geocoding.geocode(q, { language: m.locale });
        // Typed something else meanwhile: that newer intent wins.
        if (get().query !== typed) return;
        if (place) get().selectPlace(place, 'search');
        else useAppStore.getState().showNotice('warning', m.ui.notFound(q));
      } catch {
        useAppStore.getState().showNotice('warning', m.explore.searchFailed);
      } finally {
        set({ searching: false });
      }
    },

    selectPlace(place, source) {
      cardAbort?.abort();
      const ctrl = new AbortController();
      cardAbort = ctrl;
      set({
        card: { place, source, naming: source === 'pin', weather: { status: 'loading', forecast: null }, air: null, drive: null },
        cardSheet: 'default',
        query: source === 'search' ? place.name : '',
        followMe: false,
      });
      syncUrl(source === 'pin' || source === 'me' ? null : place);
      void loadCardWeather(place, ctrl.signal);
      void loadCardAir(place, ctrl.signal);
      void loadCardDrive(place, ctrl.signal);
      if (source === 'pin') void nameCardPlace(place, ctrl.signal);
    },

    retryCard() {
      const card = get().card;
      if (card) get().selectPlace(card.place, card.source);
    },

    dropPin(coordinate) {
      const m = currentMessages();
      const label = coordsLabel(coordinate);
      get().selectPlace({ id: `pin:${label}`, name: m.explore.droppedPin, label, coordinate, kind: 'pin' }, 'pin');
    },

    closeCard() {
      cardAbort?.abort();
      cardAbort = null;
      if (get().card) set({ card: null });
      syncUrl(null);
    },
    setCardSheet: (cardSheet) => set({ cardSheet }),
    setView: (view) => set({ view }),
    showMe() {
      const fix = get().myLocation;
      if (!fix) return;
      const m = currentMessages();
      get().selectPlace({ id: 'me', name: m.ui.currentLocation, label: coordsLabel(fix.coordinate), coordinate: fix.coordinate, kind: 'me' }, 'me');
    },
    openSharePlace: (sharePlace) => set({ sharePlace }),
    setLayer: (layer) => set({ layer, layerHour: 0, layerStatus: layer === 'off' ? 'idle' : get().layerStatus }),
    setLayerHour: (layerHour) => set({ layerHour: Math.max(0, Math.min(24, Math.round(layerHour))) }),

    async searchNearby(category) {
      nearbyAbort?.abort();
      const ctrl = new AbortController();
      nearbyAbort = ctrl;
      const s = get();
      // Around you when the map follows you; otherwise around what you're looking at.
      const fix = s.myLocation && s.followMe ? s.myLocation.coordinate : null;
      const center = fix ?? s.view?.center ?? latestFix(10 * 60_000)?.coordinate;
      const provider = getProviders().poi;
      if (!center || !provider?.searchNear) return;
      const zoom = s.view?.zoom ?? 12;
      const radiusM = zoom >= 15 ? 1500 : zoom >= 13 ? 3000 : zoom >= 11 ? 8000 : 15_000;
      get().closeCard();
      set({ nearby: { category, center, radiusM, status: 'loading', results: [] } });
      try {
        const pois = await provider.searchNear(category, center, radiusM, { signal: ctrl.signal, language: currentMessages().locale });
        if (ctrl.signal.aborted) return;
        const results = pois
          .map((poi) => ({ poi, distanceM: haversineM(center, poi.coordinate) }))
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, 30);
        set({ nearby: { category, center, radiusM, status: 'ready', results } });
      } catch (e) {
        if (!isAbortError(e)) set({ nearby: { category, center, radiusM, status: 'error', results: [] } });
      }
    },

    clearNearby() {
      nearbyAbort?.abort();
      set({ nearby: null });
    },

    openPoi(poi) {
      const m = currentMessages();
      const name = poi.name ?? poi.brand ?? m.poi.unnamed(m.poi.category[poi.category]);
      const charging = poi.charging ? chargingSummary(poi.charging, m.poi.chargingUpTo) : null;
      const label = [poi.brand && poi.brand !== name ? poi.brand : null, m.poi.category[poi.category], charging].filter(Boolean).join(' · ');
      get().selectPlace({ id: poi.id, name, label, coordinate: poi.coordinate, kind: poi.category }, 'search');
    },
    closeSharePlace: () => set({ sharePlace: null }),

    async directionsTo(place) {
      const app = useAppStore.getState();
      app.setDestinationPlace(place);
      // No warm-up here: calculateRoute asks for the position and reports any problem once.
      if (!app.origin.place && !app.origin.text.trim()) get().useMyLocationAsOrigin(false);
      get().closeCard();
      set({ directionsOpen: true });
      await useAppStore.getState().calculateRoute();
    },

    async addAsStop(place) {
      get().closeCard();
      await useAppStore.getState().addStop(place);
    },

    useMyLocationAsOrigin(warm = true) {
      const here = herePlace();
      useAppStore.getState().setOriginPlace(here);
      if (!warm) return;
      // Ask now, inside the user's tap, so the permission prompt appears right away.
      tripStart().then(
        (start) => {
          const app = useAppStore.getState();
          // Only if "Your location" is still the start (not replaced meanwhile).
          if (!start.approximate || app.origin.place !== here) return;
          const m = currentMessages();
          app.setOriginPlace({ ...here, name: m.location.approxName, label: m.location.approxName, coordinate: start.coordinate });
          app.showNotice('info', m.location.approximate(start.approximate.city), true);
        },
        (e) => {
          if (!(e instanceof LocationError)) return;
          const app = useAppStore.getState();
          if (app.origin.place === here) app.setOriginPlace(null);
          app.showNotice('warning', tripLocationErrorText(e.kind), true);
        },
      );
    },
  })),
);

async function loadCardWeather(place: Place, signal: AbortSignal) {
  const [lon, lat] = place.coordinate;
  const weather = getProviders().weather;
  try {
    const lookup = await weather.getForecasts([{ latitude: lat, longitude: lon }], { needUntilMs: Date.now() + 7 * 86_400_000, signal });
    if (signal.aborted) return;
    const forecast = lookup.forecasts.get(weather.keyFor(lat, lon)) ?? null;
    patchCard(place, { weather: { status: forecast ? 'ready' : 'error', forecast } });
  } catch (e) {
    if (!isAbortError(e)) patchCard(place, { weather: { status: 'error', forecast: null } });
  }
}

async function loadCardAir(place: Place, signal: AbortSignal) {
  const air = getProviders().air;
  if (!air) return;
  try {
    const q = await air.current(place.coordinate, signal);
    if (!signal.aborted && q) patchCard(place, { air: q.europeanAqi });
  } catch {
    /* optional */
  }
}

async function loadCardDrive(place: Place, signal: AbortSignal) {
  if (place.kind === 'me') return;
  const fix = latestFix(5 * 60_000);
  if (!fix || haversineM(fix.coordinate, place.coordinate) < 300) return;
  patchCard(place, { drive: { status: 'loading' } });
  try {
    const m = currentMessages();
    const origin: Place = { id: 'here', name: m.ui.currentLocation, label: m.ui.currentLocation, coordinate: fix.coordinate };
    const [route] = await getProviders().routing.calculateRoutes({ origin, destination: place, alternatives: false, signal });
    if (signal.aborted) return;
    patchCard(place, {
      drive: route
        ? { status: 'ready', durationS: route.durationS, distanceM: route.distanceM, arrivalMs: Date.now() + route.durationS * 1000 }
        : { status: 'error' },
    });
  } catch (e) {
    if (!isAbortError(e)) patchCard(place, { drive: { status: 'error' } });
  }
}

async function nameCardPlace(place: Place, signal: AbortSignal) {
  const providers = getProviders();
  const language = currentMessages().locale;
  let named: Place | null = null;
  for (const p of [providers.geocoding, providers.reverseGeocoding]) {
    try {
      named = await p.reverse(place.coordinate, { signal, language });
      if (named) break;
    } catch (e) {
      if (isAbortError(e)) return;
    }
  }
  if (signal.aborted) return;
  const next: Place = named
    ? { ...place, name: named.name, label: named.label && named.label !== named.name ? named.label : place.label }
    : place;
  patchCard(place, { naming: false, place: next });
}

/** Update the open card only if it still shows the same place. */
function patchCard(place: Place, patch: Partial<PlaceCard>) {
  const card = useExplore.getState().card;
  if (!card || card.place.id !== place.id) return;
  useExplore.setState({ card: { ...card, ...patch } });
}

// ---------------------------------------------------------------------------
// The one location watcher (see services/location.ts).

export const locationWatcher = new LocationWatcher({
  onFix(fix) {
    const s = useExplore.getState();
    useExplore.setState({ myLocation: fix, locationError: null, ...(s.locate === 'pending' ? { locate: 'on' } : {}) });
    const app = useAppStore.getState();
    // Positions are flowing: a "blocked" / "waiting for GPS" warning from before is out of date.
    if (isLocationNotice(app.notice?.text)) app.dismissNotice();
    if (app.mode === 'navigating') app.handlePosition(fix);
  },
  onError(kind, hadFix) {
    const app = useAppStore.getState();
    const m = currentMessages();
    const fatal = kind === 'denied' || kind === 'insecure' || kind === 'unsupported';
    if (fatal) {
      locationWatcher.releaseAll();
      useExplore.setState({ locate: 'off', followMe: false, locationError: kind, myLocation: null });
      rememberFix(null);
      // A share without a position would only show viewers "waiting" forever.
      if (useLiveShare.getState().status === 'active' && app.mode !== 'simulating') void useLiveShare.getState().stop({ silent: true });
      if (app.mode === 'navigating') app.handleGeolocationError(locationMessage(kind));
      else app.showNotice('warning', locationMessage(kind), true);
      return;
    }
    if (hadFix) return; // a blip after positions were flowing (tunnel, indoors)
    if (useExplore.getState().locationError === kind) return; // said it already
    useExplore.setState({ locationError: kind });
    if (app.mode === 'navigating') {
      app.showNotice('info', m.location.waitingGps, true);
      return;
    }
    if (kind === 'unavailable' && locationWatcher.has('locate')) {
      locationWatcher.release('locate');
      useExplore.setState({ locate: 'off', followMe: false });
    }
    app.showNotice('warning', locationMessage(kind), kind === 'unavailable');
  },
});

/**
 * The user changed the site's location permission (in the address-bar icon or
 * the browser settings) while the app is open: drop the old failure and its
 * sticky warning, so the next tap on "Your location" asks the browser afresh.
 */
if (typeof navigator !== 'undefined' && typeof navigator.permissions?.query === 'function') {
  navigator.permissions
    .query({ name: 'geolocation' as PermissionName })
    .then((status) => {
      status.addEventListener('change', () => {
        if (status.state === 'denied') return;
        forgetLocationFailure();
        if (useExplore.getState().locationError) useExplore.setState({ locationError: null });
        const app = useAppStore.getState();
        if (isLocationNotice(app.notice?.text)) app.dismissNotice();
      });
    })
    .catch(() => undefined);
}
