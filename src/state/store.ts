import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { dueCamera, snapCamerasToRoute, type RouteCamera } from '../algorithms/cameras';
import { dueHazard, findSharpCurves, hazardLabelKind, mergeHazards, roadSurface, snapLevelCrossings, weatherAtDistance, type RoadHazard } from '../algorithms/roadHazards';
import { snapIncidentsToRoute, type RouteIncident } from '../algorithms/incidents';
import { matchKnownRoad, projectorFor, roadsNearCar } from '../algorithms/roadMatching';
import { initialDeviationState, updateDeviation } from '../algorithms/routeDeviation';
import { createProgressTracker, edgeSpeedMps, hasArrived } from '../algorithms/routeProgress';
import { timeAtDistance } from '../algorithms/routeTiming';
import { diffForecast } from '../algorithms/routeWeather';
import { exposureOf, pickWeatherReroute, remainingSamples, sharedForecastFor, worthChecking, type Exposure } from '../algorithms/weatherReroute';
import { advanceSimulation, simProgress } from '../algorithms/simulation';
import { matchSpeedLimits, speedLimitAt, updateSpeeding, type SpeedLimitProfile } from '../algorithms/speedLimits';
import { config } from '../config';
import { countOf, speedValue, spokenDuration } from '../i18n/format';
import {
  acknowledge,
  evaluateDriverAlerts,
  initialDriverAlertState,
  type DriverAlertState,
  type VisualAlert,
} from '../intelligence/driverAlerts';
import { dueManeuverPrompt, markSpoken, spokenPrompt } from '../navigation/instructions';
import { computeGuidance, type Guidance } from '../navigation/maneuvers';
import { isAbortError, mapWithConcurrency } from '../services/http';
import type { IncidentKind } from '../services/traffic/IncidentProvider';
import { reportFailure, reportToIncident } from '../services/traffic/ReportsIncidentProvider';
import type { ReportKind, Vote } from '../reports/protocol';
import { LocationError, tripStart } from '../services/location';
import type { PoiCategory } from '../services/places/PoiProvider';
import { searchAlongRoute, type PoiResult } from '../services/placesAlongRoute';
import { getProviders } from '../services/providers';
import {
  applyLatePlaces,
  describeError,
  enrichRoute,
  fetchSampleForecasts,
  forecastLookupFn,
  planOtherRoads,
  planRoute,
  planRouteOptions,
  refinePlanWithWeather,
  resolvePlace,
  type PlannedRoute,
  type PlanStage,
} from '../services/routePlanner';
import type { LngLat, Place } from '../types/geo';
import type { DeviationState, NavigationMode, RouteProgress, VehicleState } from '../types/navigation';
import type { RouteSample } from '../types/route';
import type { LocationForecast, WeatherAtTime, WeatherCondition } from '../types/weather';
import { haversineM } from '../utils/distance';
import { deviceTimeZone } from '../utils/timezone';
import { VoiceQueue } from '../voice/queue';
import { deriveRouteWeather, emptyDerived, type Derived } from './derive';
import { clearDriveSession, saveDriveSession } from './driveSession';
import { useSavedPlaces } from './savedPlaces';
import { isLocationNotice } from './locationNotice';
import { currentMessages, settingsSnapshot, useSettings } from './settings';

export type RouteStatus = 'idle' | PlanStage | 'ready' | 'error';
export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SheetState = 'compact' | 'default' | 'expanded';
export type Departure = { mode: 'now' } | { mode: 'at'; utcMs: number };
export type RefreshReason = 'initial' | 'auto' | 'model-update' | 'manual' | 'recalculation' | 'refinement';

export interface PlaceField {
  text: string;
  place: Place | null;
}

export interface Notice {
  id: number;
  kind: 'info' | 'warning' | 'error' | 'success';
  text: string;
  persistent?: boolean;
}

export interface SimulationState {
  playing: boolean;
  speed: number;
  nowMs: number;
  modelTimeS: number;
  startMs: number;
  arrived: boolean;
}

export interface NavPrompt {
  kind: 'far-from-route';
  distanceM: number;
  coordinate: LngLat;
  headingDeg?: number;
}

/** "Still there?" for another driver's report the car just passed. */
export interface ReportPrompt {
  incidentId: string;
  reportId: string;
  kind: IncidentKind;
}

export interface PoiSearchState {
  category: PoiCategory;
  status: 'loading' | 'ready' | 'error';
  results: PoiResult[];
}

/** Accumulated while driving; turned into a summary on arrival. Memory only. */
interface TripTracker {
  startedAt: number;
  plannedDurationS: number;
  distanceM: number;
  lastCoordinate: LngLat | null;
  lastWeatherAt: number;
  /** Minutes (route clock) spent in each condition at the vehicle position. */
  conditionMinutes: Partial<Record<WeatherCondition, number>>;
  minTemp: number | null;
  maxTemp: number | null;
  reroutes: number;
  simulated: boolean;
}

/** "Trip complete" — shown on arrival, never stored. */
export interface TripSummary {
  destination: string;
  simulated: boolean;
  durationS: number;
  distanceM: number;
  /** Actual minus planned drive time (s); positive = later than planned. */
  delayS: number;
  conditions: { condition: WeatherCondition; minutes: number }[];
  minTemp: number | null;
  maxTemp: number | null;
  reroutes: number;
  arrivalWeather: WeatherAtTime | null;
  timezone: string;
}

export interface AssistantState {
  activity: 'idle' | 'listening' | 'thinking';
  transcript: string;
  reply: { text: string; at: number } | null;
}

export interface AppState {
  origin: PlaceField;
  destination: PlaceField;
  waypoints: PlaceField[];
  departure: Departure;

  routeStatus: RouteStatus;
  routeError: string | null;
  plan: PlannedRoute | null;
  /** Primary + alternatives (planning). `plan` is the selected one. */
  routeOptions: PlannedRoute[];
  selectedOption: number;
  speedLimits: SpeedLimitProfile | null;
  /** Incidents on the current route (empty without an incident provider). */
  incidents: RouteIncident[];
  /** Driver reports relay: reachable (`ready`) or not, for the data-sources panel. */
  reportsStatus: 'idle' | 'ready' | 'unavailable';
  reportDialogOpen: boolean;
  reportSending: boolean;
  reportPrompt: ReportPrompt | null;
  /** Mapped speed cameras on the route (only when enabled in Settings). */
  speedCameras: RouteCamera[];
  /** Sharp curves + railway crossings on the route being driven. */
  roadHazards: RoadHazard[];
  /** A route around severe weather ahead, offered while driving (never taken automatically). */
  weatherReroute: WeatherRerouteOffer | null;

  forecasts: Map<string, LocationForecast>;
  /** Dev tools injected simulated weather/incidents — the UI labels it. */
  simulatedData: boolean;
  weatherStatus: WeatherStatus;
  weatherError: string | null;
  weatherUpdatedAt: number | null;
  weatherStale: boolean;
  lastRefresh: { atMs: number; changedIds: string[]; reason: RefreshReason } | null;

  mode: NavigationMode;
  vehicle: VehicleState | null;
  progress: RouteProgress | null;
  guidance: Guidance | null;
  deviation: DeviationState;
  navStartedMs: number | null;
  recalculating: boolean;
  navPrompt: NavPrompt | null;
  locationPrimer: boolean;
  sim: SimulationState;
  speeding: { speeding: boolean; since: number | null };

  alertState: DriverAlertState;
  activeAlert: VisualAlert | null;
  arrival: TripSummary | null;
  poi: PoiSearchState | null;
  assistant: AssistantState;
  online: boolean;

  clockMs: number;
  derived: Derived;
  notice: Notice | null;

  selectedPointId: string | null;
  selectionSource: 'timeline' | 'map' | null;
  scrubMs: number | null;
  highlightedPointId: string | null;
  sheet: SheetState;
  followVehicle: boolean;
  settingsOpen: boolean;

  // --- actions ---
  setOriginText(text: string): void;
  setDestinationText(text: string): void;
  setOriginPlace(place: Place | null): void;
  setDestinationPlace(place: Place | null): void;
  swapPlaces(): void;
  addWaypoint(): void;
  setWaypointText(i: number, text: string): void;
  setWaypointPlace(i: number, place: Place | null): void;
  removeWaypoint(i: number): void;
  setDeparture(d: Departure): void;
  calculateRoute(): Promise<void>;
  selectRouteOption(i: number): Promise<void>;
  /** While driving: continue on another known road (the ones listed as "other roads"), no network needed. */
  switchToRoad(i: number): void;
  clearRoute(): void;
  loadWeather(opts?: { force?: boolean; reason?: RefreshReason }): Promise<void>;
  refreshIfStale(): Promise<void>;
  nameDisplayPoints(): Promise<void>;
  tickClock(): void;
  select(id: string | null, source: 'timeline' | 'map'): void;
  highlight(id: string | null): void;
  setScrub(ms: number | null): void;
  setSheet(s: SheetState): void;
  setFollow(f: boolean): void;
  setSettingsOpen(open: boolean): void;
  showNotice(kind: Notice['kind'], text: string, persistent?: boolean): void;
  dismissNotice(): void;
  dismissAlert(): void;
  setOnline(online: boolean): void;
  rederive(): void;

  requestNavigation(): Promise<void>;
  confirmLocationPrimer(allow: boolean): void;
  startNavigation(): void;
  handlePosition(pos: { coordinate: LngLat; accuracyM?: number; headingDeg?: number; speedMps?: number; timestampMs: number }): void;
  handleGeolocationError(message: string): void;
  resolveNavPrompt(choice: 'route-from-here' | 'simulate' | 'cancel'): void;
  stopNavigation(): void;

  startSimulation(): void;
  pauseSimulation(): void;
  resumeSimulation(): void;
  setSimulationSpeed(speed: number): void;
  advanceSimulationBy(realDtMs: number): void;
  /** Skip simulated time forward (dev tools), even while paused. */
  simulationSkip(simSeconds: number): void;
  exitSimulation(): void;

  searchPoi(category: PoiCategory, opts?: { aroundM?: number; signal?: AbortSignal }): Promise<PoiResult[]>;
  clearPoi(): void;
  addStop(place: Place): Promise<void>;

  dismissArrival(): void;
  /** Driver reports: re-fetch the ones on the route (every few minutes while driving). */
  refreshIncidents(): void;
  setReportDialogOpen(open: boolean): void;
  /** Report what's on the road at the car's position (real drives only). `notify: false` → caller shows the result. */
  reportIncident(kind: ReportKind, opts?: { notify?: boolean }): Promise<{ ok: boolean; message: string }>;
  /** Answer (or, with null, dismiss) the "still there?" prompt. */
  answerReportPrompt(vote: Vote | null): void;
  acceptWeatherReroute(): Promise<void>;
  dismissWeatherReroute(): void;
  /** Re-plan: from the vehicle while driving, else the current request. */
  recalculate(): void;
  setAssistant(patch: Partial<AssistantState>): void;
  say(text: string, priority?: number): void;
}

// ---------------------------------------------------------------------------
// Runtime (non-serializable) helpers kept outside state.

let routeAbort: AbortController | null = null;
let weatherAbort: AbortController | null = null;
/** Background work tied to the current route (late places, speed limits, naming). */
let planTasks: AbortController | null = null;
let tracker: ReturnType<typeof createProgressTracker> | null = null;
let lastDeriveAt = 0;
let lastDeriveSimMs = 0;
let lastRecalcAt = 0;
let rerouteCheckedAt = 0;
let rerouteQuietUntil = 0;
let rerouteCheck: AbortController | null = null;
/** Last weather re-route check, for the developer panel. */
let rerouteDiag = '';
export const weatherRerouteDiagnostics = () => rerouteDiag;

export interface WeatherRerouteOffer {
  plan: PlannedRoute;
  /** Extra driving time vs the current route from here (s; may be negative). */
  extraS: number;
  current: Exposure;
  alternative: Exposure;
  /** The worst weather it avoids, for the headline. */
  condition: 'storm' | 'snow' | 'heavy' | 'fog';
  /** Where the car was when offered: stale ~1.5 km later. */
  atProgressM: number;
  from: LngLat;
  headingDeg?: number;
}
let noticeSeq = 0;
const namingAttempted = new Set<string>();
const spokenManeuvers = new Set<string>();
const spokenCameras = new Set<string>();
const spokenHazards = new Set<string>();
let voiceQueue: VoiceQueue | null = null;
let voiceHintShown = false;
let trip: TripTracker | null = null;
/** Reports never to ask "still there?" about: sent from this tab, or asked once already. Memory only. */
const askedReports = new Set<string>();
let incidentsLoadedAt = 0;
/** The incident load in flight (a newer one supersedes it). */
let incidentsLoad = 0;
let incidentsLoading = false;
const INCIDENT_REFRESH_MS = 5 * 60_000;

function startTrip(plannedDurationS: number, startedAt: number, simulated: boolean) {
  trip = {
    startedAt,
    plannedDurationS,
    distanceM: 0,
    lastCoordinate: null,
    lastWeatherAt: startedAt,
    conditionMinutes: {},
    minTemp: null,
    maxTemp: null,
    reroutes: 0,
    simulated,
  };
}

/** Distance driven and the weather actually encountered at the vehicle. */
function trackTrip(coordinate: LngLat, nowMs: number, weather: WeatherAtTime | null | undefined) {
  if (!trip) return;
  if (trip.lastCoordinate) {
    const d = haversineM(trip.lastCoordinate, coordinate);
    if (d < 5000) trip.distanceM += d; // ignore GPS jumps
  }
  trip.lastCoordinate = coordinate;
  if (weather && nowMs > trip.lastWeatherAt) {
    const minutes = (nowMs - trip.lastWeatherAt) / 60_000;
    trip.conditionMinutes[weather.condition] = (trip.conditionMinutes[weather.condition] ?? 0) + minutes;
    trip.minTemp = trip.minTemp === null ? weather.temperature : Math.min(trip.minTemp, weather.temperature);
    trip.maxTemp = trip.maxTemp === null ? weather.temperature : Math.max(trip.maxTemp, weather.temperature);
  }
  trip.lastWeatherAt = nowMs;
}

function finishTrip(s: AppState, arrivedAt: number): TripSummary | null {
  if (!trip || !s.plan) return null;
  const t = trip;
  trip = null;
  const durationS = Math.max(0, (arrivedAt - t.startedAt) / 1000);
  const last = s.derived.points.at(-1);
  return {
    destination: s.plan.timed.route.destination.name,
    simulated: t.simulated,
    durationS,
    distanceM: Math.max(t.distanceM, s.plan.timed.totalDistM - (s.progress?.remainingDistanceM ?? 0)),
    delayS: durationS - t.plannedDurationS,
    conditions: (Object.entries(t.conditionMinutes) as [WeatherCondition, number][])
      .filter(([, min]) => min >= 3)
      .sort((a, b) => b[1] - a[1])
      .map(([condition, minutes]) => ({ condition, minutes: Math.round(minutes) })),
    minTemp: t.minTemp,
    maxTemp: t.maxTemp,
    reroutes: t.reroutes,
    arrivalWeather: s.derived.currentPoint?.weather ?? last?.weather ?? null,
    timezone: last?.timezone ?? deviceTimeZone(),
  };
}

function newPlanTasks(): AbortSignal {
  planTasks?.abort();
  planTasks = new AbortController();
  return planTasks.signal;
}

/** Once per session: guidance is on but nothing on this device can speak the language. */
function voiceHint() {
  if (voiceHintShown || !useSettings.getState().voice) return;
  if (getProviders().tts.canSpeak?.(currentMessages().speechLang) !== false) return;
  voiceHintShown = true;
  useAppStore.getState().showNotice('info', currentMessages().ui.noVoice);
}

/** The app's single voice channel (created lazily from the speech provider). */
export function getVoiceQueue(): VoiceQueue {
  if (!voiceQueue) {
    voiceQueue = new VoiceQueue(getProviders().tts, () => currentMessages().speechLang);
    voiceQueue.setMuted(!useSettings.getState().voice);
    // Voice guidance switched off in Settings (not only with the map button) mutes at once.
    useSettings.subscribe((st, prev) => {
      if (st.voice !== prev.voice) voiceQueue?.setMuted(!st.voice);
    });
  }
  return voiceQueue;
}

function departureMsOf(s: Pick<AppState, 'departure' | 'clockMs'>): number {
  return s.departure.mode === 'now' ? s.clockMs : s.departure.utcMs;
}

function lookupFor(forecasts: Map<string, LocationForecast>) {
  return forecastLookupFn(getProviders(), forecasts);
}

function clockNow(s: Pick<AppState, 'mode' | 'sim' | 'clockMs'>): number {
  return s.mode === 'simulating' ? s.sim.nowMs : s.mode === 'navigating' ? Date.now() : s.clockMs;
}

/** Recompute everything the UI shows from the current inputs. */
function derive(s: AppState): Derived {
  const navigating = s.mode !== 'planning' && s.progress !== null;
  const settings = settingsSnapshot();
  lastDeriveAt = performance.now();
  lastDeriveSimMs = s.sim.nowMs;
  return deriveRouteWeather({
    plan: s.plan,
    options: s.mode === 'planning' ? s.routeOptions : [],
    knownRoads: s.mode === 'planning' ? [] : s.routeOptions,
    forecastFor: lookupFor(s.forecasts),
    mode: s.mode,
    departureMs: navigating && s.navStartedMs !== null ? s.navStartedMs : departureMsOf(s),
    nowMs: clockNow(s),
    progress: navigating ? s.progress : null,
    vehicleCoordinate: s.vehicle?.coordinate ?? null,
    fallbackTimeZone: deviceTimeZone(),
    m: currentMessages(),
    units: settings.units,
    weatherPrefs: settings.weatherAlerts,
    speedLimits: s.speedLimits,
    fuelRangeKm: settings.fuelRangeKm,
    vehicle: settings.vehicle,
    incidents: s.incidents,
    breakReminders: settings.breakReminders,
    speedCameras: settings.speedCameras ? s.speedCameras : [],
    extraEvents: [],
    previous: s.derived,
  });
}

function oldestFetch(samples: RouteSample[], forecasts: Map<string, LocationForecast>): number | null {
  const get = lookupFor(forecasts);
  let oldest: number | null = null;
  for (const s of samples) {
    const f = get(s);
    if (f && (oldest === null || f.fetchedAt < oldest)) oldest = f.fetchedAt;
  }
  return oldest;
}

const initialSim: SimulationState = {
  playing: false,
  speed: config.simulation.defaultSpeed,
  nowMs: 0,
  modelTimeS: 0,
  startMs: 0,
  arrived: false,
};

const initialAssistant: AssistantState = { activity: 'idle', transcript: '', reply: null };

export const useAppStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    origin: { text: '', place: null },
    destination: { text: '', place: null },
    waypoints: [],
    departure: { mode: 'now' },
    routeStatus: 'idle',
    routeError: null,
    plan: null,
    routeOptions: [],
    selectedOption: 0,
    speedLimits: null,
    incidents: [],
    reportsStatus: 'idle',
    reportDialogOpen: false,
    reportSending: false,
    reportPrompt: null,
    speedCameras: [],
    roadHazards: [],
    forecasts: new Map(),
    simulatedData: false,
    weatherStatus: 'idle',
    weatherError: null,
    weatherUpdatedAt: null,
    weatherStale: false,
    lastRefresh: null,
    mode: 'planning',
    vehicle: null,
    progress: null,
    guidance: null,
    deviation: initialDeviationState,
    navStartedMs: null,
    recalculating: false,
    navPrompt: null,
    locationPrimer: false,
    sim: initialSim,
    speeding: { speeding: false, since: null },
    alertState: initialDriverAlertState,
    activeAlert: null,
    weatherReroute: null,
    arrival: null,
    poi: null,
    assistant: initialAssistant,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    clockMs: Date.now(),
    derived: emptyDerived,
    notice: null,
    selectedPointId: null,
    selectionSource: null,
    scrubMs: null,
    highlightedPointId: null,
    sheet: 'default',
    followVehicle: true,
    settingsOpen: false,

    // ---------------- Search ----------------
    setOriginText: (text) => set({ origin: { text, place: null } }),
    setDestinationText: (text) => set({ destination: { text, place: null } }),
    setOriginPlace: (place) => set({ origin: { text: place?.name ?? '', place } }),
    setDestinationPlace: (place) => set({ destination: { text: place?.name ?? '', place } }),
    swapPlaces: () => set((s) => ({ origin: s.destination, destination: s.origin, waypoints: [...s.waypoints].reverse() })),
    addWaypoint: () => set((s) => (s.waypoints.length >= 3 ? {} : { waypoints: [...s.waypoints, { text: '', place: null }] })),
    setWaypointText: (i, text) => set((s) => ({ waypoints: s.waypoints.map((w, k) => (k === i ? { text, place: null } : w)) })),
    setWaypointPlace: (i, place) =>
      set((s) => ({ waypoints: s.waypoints.map((w, k) => (k === i ? { text: place?.name ?? '', place } : w)) })),
    removeWaypoint: (i) => set((s) => ({ waypoints: s.waypoints.filter((_, k) => k !== i) })),

    setDeparture: (departure) => {
      set({ departure, clockMs: Date.now() });
      const s = get();
      if (s.mode === 'planning') set({ derived: derive(s) });
      if (s.plan) void get().loadWeather({ reason: 'auto' });
    },

    async calculateRoute() {
      if (get().mode !== 'planning') get().stopNavigation();
      routeAbort?.abort();
      weatherAbort?.abort();
      const ctrl = new AbortController();
      routeAbort = ctrl;
      const m = currentMessages();
      const empty = (f: PlaceField) => !f.place && !f.text.trim();
      if (empty(get().origin) || empty(get().destination)) {
        set({ routeStatus: 'error', routeError: empty(get().origin) ? m.ui.enterStart : m.ui.enterDestination });
        return;
      }
      set({ routeStatus: 'geocoding', routeError: null, poi: null, arrival: null, simulatedData: false });
      // A start typed in by the user settles any earlier "location is blocked" warning: it no longer applies.
      const fields = [get().origin, get().destination, ...get().waypoints];
      if (!fields.some((f) => f.place?.kind === 'here') && isLocationNotice(get().notice?.text)) get().dismissNotice();
      const providers = getProviders();
      try {
        // "Your location" (in any field — it can be swapped) is resolved now, with a fresh fix —
        // or, if the device can't give one, the connection's rough area (said so in the field and a notice).
        let approximateCity: string | null | undefined;
        const resolveHere = async (f: PlaceField): Promise<PlaceField> => {
          if (f.place?.kind !== 'here') return f;
          const start = await tripStart(ctrl.signal);
          if (start.approximate) approximateCity = start.approximate.city;
          else if (isLocationNotice(get().notice?.text)) get().dismissNotice(); // the device gave a position: the old warning is out of date
          const name = start.approximate ? m.location.approxName : m.ui.currentLocation;
          return { text: name, place: { ...f.place, name, label: name, coordinate: start.coordinate } };
        };
        const originField = await resolveHere(get().origin);
        const destinationField = await resolveHere(get().destination);
        const waypointFields = await Promise.all(get().waypoints.map(resolveHere));
        if (ctrl.signal.aborted) return;
        set({ origin: originField, destination: destinationField, waypoints: waypointFields });
        const origin = await resolvePlace(providers, originField, ctrl.signal, m);
        const destination = await resolvePlace(providers, destinationField, ctrl.signal, m);
        const waypoints: Place[] = [];
        for (const w of waypointFields) {
          if (w.place || w.text.trim()) waypoints.push(await resolvePlace(providers, w, ctrl.signal, m));
        }
        if (haversineM(origin.coordinate, destination.coordinate) < 50 && waypoints.length === 0) {
          throw new Error('same-place');
        }
        set({
          origin: { text: get().origin.text || origin.name, place: origin },
          destination: { text: get().destination.text || destination.name, place: destination },
        });
        const { primary, alternatives } = await planRouteOptions(providers, origin, destination, {
          signal: ctrl.signal,
          waypoints,
          alternatives: true,
          language: m.locale,
          onStage: (stage) => set({ routeStatus: stage }),
        });
        if (ctrl.signal.aborted) return;
        tracker = null;
        namingAttempted.clear();
        spokenManeuvers.clear();
        spokenCameras.clear();
        spokenHazards.clear();
        set({
          plan: primary,
          routeOptions: [primary, ...alternatives],
          selectedOption: 0,
          speedLimits: null,
          speedCameras: [],
          roadHazards: [],
          routeStatus: 'ready',
          clockMs: Date.now(),
          selectedPointId: null,
          highlightedPointId: null,
          selectionSource: null,
          scrubMs: null,
          lastRefresh: null,
          alertState: initialDriverAlertState,
          activeAlert: null,
          weatherReroute: null,
          reportPrompt: null,
          derived: emptyDerived,
          sheet: 'default',
        });
        set({ derived: derive(get()) });
        useSavedPlaces.getState().addRecent(destination);
        startPlanTasks(primary);
        if (primary.warnings.includes('places-unavailable')) get().showNotice('info', m.ui.placesLimited);
        if (approximateCity !== undefined) get().showNotice('info', m.location.approximate(approximateCity), true);
        await get().loadWeather({ reason: 'initial' });
      } catch (e) {
        if (isAbortError(e)) return;
        const msg =
          e instanceof LocationError
            ? tripLocationErrorText(e.kind)
            : (e as Error)?.message === 'same-place'
              ? m.ui.samePlace
              : describeError(e, m.ui.unableRoute, m);
        set({ routeStatus: 'error', routeError: msg });
      } finally {
        if (routeAbort === ctrl) routeAbort = null;
      }
    },

    async selectRouteOption(i) {
      const s = get();
      const option = s.routeOptions[i];
      if (!option || i === s.selectedOption || s.mode !== 'planning') return;
      set({ selectedOption: i, plan: option, selectedPointId: null, scrubMs: null, speedLimits: null });
      set({ derived: derive(get()) });
      if (option.warnings.includes('not-enriched')) {
        // Alternatives were only timed + sampled; add names/elevation now.
        try {
          const enriched = await enrichRoute(getProviders(), option.timed.route, {
            signal: newPlanTasks(),
            language: currentMessages().locale,
          });
          const cur = get();
          if (cur.routeOptions[i] !== option) return;
          const options = [...cur.routeOptions];
          options[i] = enriched;
          set({ routeOptions: options, ...(cur.selectedOption === i ? { plan: enriched } : {}) });
          if (get().plan === enriched) startPlanTasks(enriched, true);
        } catch (e) {
          if (!isAbortError(e)) get().rederive();
        }
      } else {
        startPlanTasks(option, true);
      }
      await get().loadWeather({ reason: 'auto' });
    },

    switchToRoad(i) {
      switchDriveTo(i);
    },

    clearRoute: () => {
      clearDriveSession();
      routeAbort?.abort();
      weatherAbort?.abort();
      planTasks?.abort();
      getVoiceQueue().clear();
      tracker = null;
      set({
        plan: null,
        routeOptions: [],
        selectedOption: 0,
        speedLimits: null,
        incidents: [],
        speedCameras: [],
        roadHazards: [],
        reportPrompt: null,
        reportDialogOpen: false,
        simulatedData: false,
        routeStatus: 'idle',
        routeError: null,
        mode: 'planning',
        vehicle: null,
        progress: null,
        guidance: null,
        sim: { ...initialSim, speed: get().sim.speed },
        derived: emptyDerived,
        weatherStatus: 'idle',
        weatherError: null,
        weatherUpdatedAt: null,
        weatherStale: false,
        lastRefresh: null,
        selectedPointId: null,
        highlightedPointId: null,
        navPrompt: null,
        poi: null,
        activeAlert: null,
        weatherReroute: null,
      });
    },

    // ---------------- Weather ----------------
    async loadWeather({ force = false, reason = 'auto' } = {}) {
      const s = get();
      const plan = s.plan;
      if (!plan) return;
      const routeKey = plan.timed; // a new object ≠ a new route: naming/refinement keep `timed`
      weatherAbort?.abort();
      const ctrl = new AbortController();
      weatherAbort = ctrl;
      set({ weatherStatus: 'loading' });
      const providers = getProviders();
      const m = currentMessages();
      // Every option's samples in one batched lookup (alternatives compare weather).
      const samples = s.mode === 'planning' ? s.routeOptions.flatMap((o) => o.samples) : [...plan.samples, ...reachableRoads(s).flatMap((o) => o.samples)];
      const longest = Math.max(plan.timed.totalTimeS, ...s.routeOptions.map((o) => o.timed.totalTimeS));
      const latestArrival = Math.max(
        s.derived.arrivalMs ?? 0,
        departureMsOf(s) + longest * 1000,
        s.mode === 'simulating' ? s.sim.nowMs + plan.timed.totalTimeS * 1000 : 0,
      );
      const isCurrent = () => !ctrl.signal.aborted && get().plan?.timed === routeKey;
      try {
        const lookup = await fetchSampleForecasts(providers, samples.length ? samples : plan.samples, latestArrival, {
          force,
          signal: ctrl.signal,
        });
        if (!isCurrent()) return;
        const forecasts = new Map(get().forecasts);
        for (const [k, f] of lookup.forecasts) forecasts.set(k, f);
        const prevPoints = get().derived.points;
        const hasData = lookup.forecasts.size > 0;
        set({
          forecasts,
          weatherStatus: lookup.error && !hasData ? 'error' : 'ready',
          weatherError: lookup.error ? m.weather.summary.unavailable : null,
          weatherStale: lookup.staleKeys.size > 0,
          weatherUpdatedAt: oldestFetch(get().plan!.samples, forecasts),
        });
        const derived = derive(get());
        const upcomingIds = new Set(derived.upcoming.map((p) => p.id));
        const changedIds =
          reason === 'initial' ? [] : diffForecast(prevPoints, derived.points).filter((id) => upcomingIds.has(id));
        set({ derived, lastRefresh: { atMs: Date.now(), changedIds, reason } });
        const changes = countOf(changedIds.length, 'change', m);
        if (reason === 'model-update' && changedIds.length) get().showNotice('info', m.ui.newForecast(changes));
        if (reason === 'manual') {
          get().showNotice(
            lookup.error ? 'warning' : 'success',
            lookup.error ? m.weather.summary.unavailable : changedIds.length ? m.ui.forecastUpdated(changes) : m.ui.forecastUpToDate,
          );
        }

        // One-time refinement where neighbouring forecasts differ a lot.
        const current = get().plan!;
        if (!current.refined && !lookup.error) {
          const st = get();
          const arrivalById = new Map(st.derived.points.map((p) => [p.id, p.arrivalMs]));
          const dep = departureMsOf(st);
          const { plan: refined, lookup: extra } = await refinePlanWithWeather(
            providers,
            current,
            (smp) => arrivalById.get(smp.id) ?? dep + smp.travelTimeS * 1000,
            forecasts,
            ctrl.signal,
          );
          if (!isCurrent()) return;
          const merged = new Map(get().forecasts);
          if (extra) for (const [k, f] of extra.forecasts) merged.set(k, f);
          replacePlan(refined);
          set({ forecasts: merged });
          set({ derived: derive(get()) });
        }
      } catch (e) {
        if (isAbortError(e)) return;
        set({
          weatherStatus: get().forecasts.size ? 'ready' : 'error',
          weatherError: m.weather.summary.unavailable,
          weatherStale: get().forecasts.size > 0,
        });
      } finally {
        // Never leave the status stuck in "loading" (audit race).
        if (weatherAbort === ctrl) {
          weatherAbort = null;
          if (get().weatherStatus === 'loading') set({ weatherStatus: get().forecasts.size ? 'ready' : 'idle' });
        }
      }
    },

    async refreshIfStale() {
      const s = get();
      const plan = s.plan;
      if (!plan || s.weatherStatus === 'loading' || !s.online) return;
      const ageMs = s.weatherUpdatedAt ? Date.now() - s.weatherUpdatedAt : Infinity;
      if (ageMs >= config.weather.refreshMinutes * 60000) {
        await get().loadWeather({ reason: 'auto' });
        return;
      }
      if (ageMs < 5 * 60000) return;
      const lookup = lookupFor(s.forecasts);
      const used = plan.samples.map(lookup).filter((f): f is LocationForecast => !!f);
      const newer = await getProviders().weather.hasNewerForecast(used);
      const cur = get();
      if (newer && cur.plan?.timed === plan.timed && cur.weatherStatus !== 'loading') {
        await cur.loadWeather({ force: true, reason: 'model-update' });
      }
    },

    async nameDisplayPoints() {
      const s = get();
      const plan = s.plan;
      if (!plan) return;
      const unnamed = s.derived.displayPoints.filter((p) => !p.placeName && !namingAttempted.has(p.id)).slice(0, 8);
      if (unnamed.length === 0) return;
      unnamed.forEach((p) => namingAttempted.add(p.id));
      const providers = getProviders();
      const signal = planTasks?.signal;
      const names = await mapWithConcurrency(unnamed, 2, async (p) => {
        try {
          return (await providers.reverseGeocoding.reverse([p.longitude, p.latitude], { signal, language: currentMessages().locale }))?.name ?? null;
        } catch {
          return null;
        }
      });
      const current = get().plan;
      if (!current || current.timed !== plan.timed) return;
      const byId = new Map(unnamed.map((p, i) => [p.id, names[i]]));
      if (![...byId.values()].some(Boolean)) return;
      // Apply by sample id to whatever the current plan object is (audit race).
      replacePlan({
        ...current,
        samples: current.samples.map((smp) => {
          const name = byId.get(smp.id);
          return name && !smp.placeName ? { ...smp, placeName: name, placeRelation: 'near' as const } : smp;
        }),
      });
      set({ derived: derive(get()) });
    },

    tickClock() {
      set({ clockMs: Date.now() });
      const pre = get();
      // A chosen departure that has long passed (tab left open) means "now" — say so once.
      if (pre.mode === 'planning' && pre.plan && pre.departure.mode === 'at' && pre.departure.utcMs < Date.now() - 60 * 60_000) {
        pre.setDeparture({ mode: 'now' });
        pre.showNotice('info', currentMessages().ui.departurePassed);
        return;
      }
      const s = get();
      if (s.plan && (s.mode === 'planning' ? s.departure.mode === 'now' : s.mode === 'navigating')) {
        set({ derived: derive(s) });
      }
    },

    // ---------------- UI ----------------
    select: (id, source) => {
      const s = get();
      set({
        selectedPointId: id,
        selectionSource: id ? source : null,
        highlightedPointId: id,
        followVehicle: id && s.mode !== 'planning' ? false : s.followVehicle,
      });
    },
    highlight: (id) => {
      if (get().highlightedPointId !== id) set({ highlightedPointId: id });
    },
    setScrub: (scrubMs) => set({ scrubMs }),
    setSheet: (sheet) => set({ sheet }),
    setFollow: (followVehicle) => set({ followVehicle, ...(followVehicle ? { selectedPointId: null } : {}) }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    showNotice: (kind, text, persistent) => set({ notice: { id: ++noticeSeq, kind, text, persistent } }),
    dismissNotice: () => set({ notice: null }),
    dismissAlert: () => {
      const a = get().activeAlert;
      if (!a) return;
      set({ activeAlert: null, alertState: acknowledge(get().alertState, a.eventIds) });
    },
    setOnline: (online) => {
      if (get().online === online) return;
      set({ online });
      if (online) void get().refreshIfStale();
    },
    rederive: () => set({ derived: derive(get()) }),

    // ---------------- Live GPS navigation ----------------
    async requestNavigation() {
      if (!get().plan) return;
      getVoiceQueue(); // create inside the user gesture
      getProviders().tts.unlock();
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        get().showNotice('warning', locationErrorText('insecure'), true);
        return;
      }
      let state: PermissionState | 'unknown' = 'unknown';
      try {
        state = (await navigator.permissions?.query({ name: 'geolocation' as PermissionName }))?.state ?? 'unknown';
      } catch {
        state = 'unknown';
      }
      if (state === 'granted') get().startNavigation();
      else if (state === 'denied') get().showNotice('warning', locationErrorText('denied'), true);
      else set({ locationPrimer: true }); // explain before the browser asks
    },

    confirmLocationPrimer(allow) {
      set({ locationPrimer: false });
      if (allow) get().startNavigation();
    },

    startNavigation() {
      const s = get();
      if (!s.plan) return;
      tracker = createProgressTracker(s.plan.timed);
      spokenManeuvers.clear();
      spokenCameras.clear();
      spokenHazards.clear();
      // The route was just chosen with its weather in view: first weather re-route check in ~10 min.
      rerouteCheckedAt = Date.now();
      rerouteQuietUntil = 0;
      startTrip(s.plan.timed.totalTimeS, Date.now(), false);
      set({
        arrival: null,
        mode: 'navigating',
        navStartedMs: Date.now(),
        progress: null,
        vehicle: null,
        guidance: null,
        deviation: initialDeviationState,
        followVehicle: true,
        selectedPointId: null,
        scrubMs: null,
        sheet: 'compact',
        navPrompt: null,
        alertState: initialDriverAlertState,
        activeAlert: null,
        weatherReroute: null,
      });
      get().showNotice('info', currentMessages().ui.waitingForLocation, true);
      rememberDrive();
      loadDriveExtras();
    },

    handlePosition(pos) {
      const s = get();
      if (s.mode !== 'navigating' || !s.plan || s.navPrompt) return;
      const settings = settingsSnapshot();
      const now = Date.now();
      // Battery saver: when the next maneuver is far, process at most one fix per 3 s.
      if (settings.batterySaver && s.progress && s.guidance && s.guidance.distanceToNextM > 3000 && now - s.progress.nowMs < 3000) {
        set({ vehicle: { ...pos } });
        return;
      }
      if (!tracker) tracker = createProgressTracker(s.plan.timed);
      const progress = tracker(pos.coordinate, now, { headingDeg: pos.headingDeg, accuracyM: pos.accuracyM });
      const vehicle: VehicleState = { ...pos };

      if (!s.progress && progress.distanceFromRouteM > config.navigation.farFromRouteM) {
        set({
          vehicle,
          navPrompt: { kind: 'far-from-route', distanceM: progress.distanceFromRouteM, coordinate: pos.coordinate, headingDeg: pos.headingDeg },
          notice: null,
        });
        return;
      }
      if (!s.progress) {
        set({ notice: null });
        voiceHint();
      }

      const deviation = updateDeviation(
        s.deviation,
        {
          distanceFromRouteM: progress.distanceFromRouteM,
          accuracyM: pos.accuracyM,
          timestampMs: pos.timestampMs,
          roadSpeedMps: edgeSpeedMps(s.plan.timed, progress.segmentIndex),
        },
        {
          minThresholdM: config.navigation.offRouteMinThresholdM,
          maxThresholdM: config.navigation.offRouteMaxThresholdM,
          maxUsableAccuracyM: config.navigation.maxUsableAccuracyM,
          persistReadings: config.navigation.offRoutePersistReadings,
          persistSeconds: config.navigation.offRoutePersistSeconds,
        },
      );
      set({ deviation });
      onProgress(vehicle, progress, pos.speedMps, true);

      const st = get();
      if (deviation.status === 'off-route' && !st.recalculating) {
        // Left the road — onto ANOTHER road we know (one offered at the start, or after the last re-route)?
        // Then carry on along it at once: no waiting for a network round trip, and its forecast is already here.
        const roads = st.routeOptions.map((o) => o.timed);
        const known = matchKnownRoad(
          roads,
          { coordinate: pos.coordinate, headingDeg: pos.headingDeg, accuracyM: pos.accuracyM },
          { except: roads.indexOf(s.plan.timed) },
        );
        if (known) switchDriveTo(known.index);
        else if (st.online && now - lastRecalcAt > config.navigation.minRecalculationIntervalS * 1000) {
          void recalculateFrom(pos.coordinate, pos.headingDeg);
        }
      }
      if (hasArrived(progress)) {
        const m = currentMessages();
        const summary = finishTrip(get(), now);
        get().stopNavigation(); // clears the voice queue — announce after it
        get().say(m.voice.arrived(st.plan!.timed.route.destination.name), 1);
        set({ arrival: summary, sheet: 'default', activeAlert: null, weatherReroute: null });
      }
    },

    handleGeolocationError(message) {
      if (get().mode !== 'navigating') return;
      get().stopNavigation();
      get().showNotice('warning', message, true);
    },

    resolveNavPrompt(choice) {
      const p = get().navPrompt;
      set({ navPrompt: null });
      if (!p) return;
      if (choice === 'route-from-here') void recalculateFrom(p.coordinate, p.headingDeg);
      else if (choice === 'simulate') {
        get().stopNavigation();
        get().startSimulation();
      } else get().stopNavigation();
    },

    stopNavigation() {
      clearDriveSession();
      // Cancel an in-flight re-route so it can't resurrect navigation (audit race).
      routeAbort?.abort();
      routeAbort = null;
      tracker = null;
      trip = null;
      getVoiceQueue().clear();
      set({
        mode: 'planning',
        vehicle: null,
        progress: null,
        guidance: null,
        navStartedMs: null,
        deviation: initialDeviationState,
        navPrompt: null,
        recalculating: false,
        sheet: 'default',
        clockMs: Date.now(),
        activeAlert: null,
        weatherReroute: null,
        reportPrompt: null,
        reportDialogOpen: false,
        speeding: { speeding: false, since: null },
        notice: get().notice?.persistent ? null : get().notice,
      });
      set({ derived: derive(get()) });
    },

    // ---------------- Demo simulation ----------------
    startSimulation() {
      const s = get();
      if (!s.plan) return;
      getVoiceQueue();
      getProviders().tts.unlock();
      spokenManeuvers.clear();
      spokenCameras.clear();
      spokenHazards.clear();
      const startMs = departureMsOf({ ...s, clockMs: Date.now() });
      const first = advanceSimulation(s.plan.timed, { nowMs: startMs, modelTimeS: 0 }, startMs, 0, 1);
      // The route was just chosen with its weather in view: first weather re-route check in ~10 min.
      rerouteCheckedAt = Date.now();
      rerouteQuietUntil = 0;
      startTrip(s.plan.timed.totalTimeS, startMs, true);
      set({
        arrival: null,
        mode: 'simulating',
        navStartedMs: startMs,
        sim: { ...s.sim, playing: true, nowMs: startMs, modelTimeS: 0, startMs, arrived: false },
        vehicle: { coordinate: first.coordinate, headingDeg: first.headingDeg, timestampMs: startMs },
        progress: simProgress(s.plan.timed, first),
        followVehicle: true,
        selectedPointId: null,
        highlightedPointId: null,
        scrubMs: null,
        sheet: 'compact',
        alertState: initialDriverAlertState,
        activeAlert: null,
        weatherReroute: null,
      });
      set({ derived: derive(get()), guidance: computeGuidance(get().derived.maneuvers, s.plan.timed, 0) });
      const m = currentMessages();
      get().say(m.voice.routeStarted(s.plan.timed.route.destination.name, spokenDuration(s.plan.timed.totalTimeS, m, false)), 3);
      voiceHint();
      loadDriveExtras();
    },
    pauseSimulation: () => set((s) => ({ sim: { ...s.sim, playing: false } })),
    resumeSimulation: () => {
      const s = get();
      if (s.sim.arrived) {
        get().startSimulation();
        return;
      }
      set({ sim: { ...s.sim, playing: true } });
    },
    setSimulationSpeed: (speed) => set((s) => ({ sim: { ...s.sim, speed } })),

    advanceSimulationBy(realDtMs) {
      const s = get();
      if (s.mode !== 'simulating' || !s.sim.playing || !s.plan) return;
      const step = advanceSimulation(s.plan.timed, s.sim, s.sim.startMs, realDtMs, s.sim.speed);
      const simDtS = step.nowMs - s.sim.nowMs > 0 ? (step.nowMs - s.sim.nowMs) / 1000 : 0;
      const speedMps = simDtS > 0 && s.progress ? (step.distanceM - s.progress.distanceAlongM) / simDtS : undefined;
      const vehicle: VehicleState = { coordinate: step.coordinate, headingDeg: step.headingDeg, speedMps, timestampMs: step.nowMs };
      set({ sim: { ...s.sim, nowMs: step.nowMs, modelTimeS: step.modelTimeS, arrived: step.arrived, playing: !step.arrived } });
      onProgress(vehicle, simProgress(s.plan.timed, step), speedMps, false);
      if (step.arrived) {
        const summary = finishTrip(get(), step.nowMs);
        set({ arrival: summary, sheet: 'default', activeAlert: null, weatherReroute: null, reportPrompt: null, reportDialogOpen: false });
      }
    },

    simulationSkip(simSeconds) {
      const s = get();
      if (s.mode !== 'simulating' || !s.plan || s.sim.arrived) return;
      const wasPlaying = s.sim.playing;
      set({ sim: { ...s.sim, playing: true } });
      get().advanceSimulationBy((simSeconds * 1000) / s.sim.speed);
      const after = get();
      if (!wasPlaying && after.mode === 'simulating' && !after.sim.arrived) set({ sim: { ...after.sim, playing: false } });
    },

    exitSimulation() {
      getVoiceQueue().clear();
      trip = null;
      set({
        arrival: null,
        mode: 'planning',
        vehicle: null,
        progress: null,
        guidance: null,
        navStartedMs: null,
        sim: { ...get().sim, playing: false, arrived: false },
        sheet: 'default',
        clockMs: Date.now(),
        followVehicle: true,
        activeAlert: null,
        weatherReroute: null,
        reportDialogOpen: false,
      });
      set({ derived: derive(get()) });
    },

    // ---------------- Places along the route ----------------
    async searchPoi(category, opts = {}) {
      const s = get();
      const providers = getProviders();
      if (!s.plan || !providers.poi) return [];
      set({ poi: { category, status: 'loading', results: [] } });
      const fromM = opts.aroundM !== undefined ? Math.max(0, opts.aroundM - 5000) : (s.progress?.distanceAlongM ?? 0);
      const aheadM = opts.aroundM !== undefined ? 10_000 : 60_000;
      try {
        const results = await searchAlongRoute({
          places: providers.poi,
          routing: providers.routing,
          timed: s.plan.timed,
          category,
          fromM,
          aheadM,
          signal: opts.signal ?? planTasks?.signal,
          language: currentMessages().locale,
        });
        if (get().plan?.timed !== s.plan.timed) return [];
        set({ poi: { category, status: 'ready', results } });
        return results;
      } catch (e) {
        if (!isAbortError(e)) set({ poi: { category, status: 'error', results: [] } });
        return [];
      }
    },
    clearPoi: () => set({ poi: null }),

    async addStop(place) {
      const s = get();
      if (s.mode !== 'planning' && s.vehicle) {
        // While driving: re-route from here through the stop.
        await recalculateFrom(s.vehicle.coordinate, s.vehicle.headingDeg, [place]);
        return;
      }
      set({ waypoints: [...s.waypoints, { text: place.name, place }].slice(0, 3), poi: null });
      await get().calculateRoute();
    },

    recalculate() {
      const s = get();
      if (s.mode !== 'planning' && s.vehicle) void recalculateFrom(s.vehicle.coordinate, s.vehicle.headingDeg);
      else if (s.plan) void s.calculateRoute();
    },

    async acceptWeatherReroute() {
      const s = get();
      const offer = s.weatherReroute;
      if (!offer || s.mode === 'planning') return;
      set({ weatherReroute: null, recalculating: true });
      if (trip) trip.reroutes++;
      let plan = offer.plan;
      if (plan.warnings.includes('not-enriched')) {
        // Alternatives are only timed + sampled; add place names/elevation (best effort).
        plan = await enrichRoute(getProviders(), plan.timed.route, { signal: newPlanTasks(), language: currentMessages().locale }).catch(() => offer.plan);
      }
      const cur = get();
      if (cur.mode === 'planning') return;
      await adoptRoute(plan, cur.vehicle?.coordinate ?? offer.from, cur.vehicle?.headingDeg ?? offer.headingDeg);
    },
    dismissWeatherReroute() {
      // Don't ask again for a while (unless the user asks for a re-route).
      rerouteQuietUntil = Date.now() + 30 * 60_000;
      set({ weatherReroute: null });
    },
    dismissArrival() {
      const s = get();
      set({ arrival: null });
      if (s.mode === 'simulating') s.exitSimulation();
      get().clearRoute();
    },

    // ---------------- Driver reports ----------------
    refreshIncidents() {
      const s = get();
      if (!s.plan || !s.online) return;
      incidentsLoadedAt = Date.now(); // also paces retries after a failure
      loadIncidents(s.plan.timed, planTasks && !planTasks.signal.aborted ? planTasks.signal : newPlanTasks());
    },
    setReportDialogOpen: (reportDialogOpen) => set({ reportDialogOpen }),

    async reportIncident(kind, { notify = true } = {}) {
      const s = get();
      const m = currentMessages();
      const provider = getProviders().incidents;
      const done = (ok: boolean, message: string, tone: Notice['kind']) => {
        if (notify) get().showNotice(tone, message);
        return { ok, message };
      };
      if (!provider.report) return done(false, m.reports.unavailable, 'warning');
      // Only what a driver sees on a real road: never from a simulation or a planning screen.
      if (s.mode === 'simulating') return done(false, m.reports.simulated, 'info');
      if (s.mode !== 'navigating') return done(false, m.assistant.reportNeedsDrive, 'info');
      if (!s.vehicle || !s.progress) return done(false, m.reports.noPosition, 'info');
      if (!s.online) return done(false, m.reports.offline, 'warning');
      if (s.reportSending) return { ok: false, message: m.reports.sending };
      const at = s.vehicle.coordinate;
      set({ reportSending: true, reportDialogOpen: false });
      try {
        const res = await provider.report(kind, at);
        askedReports.add(res.id); // your own report: never "still there?"
        // Show it right away; the next refresh brings it back from the relay.
        const cur = get();
        if (cur.plan) {
          const now = Date.now();
          const [inc] = snapIncidentsToRoute(
            [reportToIncident({ id: res.id, kind, lat: at[1], lon: at[0], createdAt: now, expiresAt: res.expiresAt, confirms: 0, denies: 0 }, 0)],
            cur.plan.timed,
          );
          if (inc && !cur.incidents.some((i) => i.id === inc.id)) {
            set({ incidents: [...cur.incidents, inc].sort((a, b) => a.distanceAlongM - b.distanceAlongM) });
            get().rederive();
          }
        }
        return done(true, m.reports.sent(m.reports.kinds[kind]), 'success');
      } catch (e) {
        const f = reportFailure(e);
        return done(false, f === 'offline' ? m.reports.offline : f === 'busy' ? m.reports.busy : m.reports.unavailable, 'warning');
      } finally {
        set({ reportSending: false });
      }
    },

    answerReportPrompt(vote) {
      const p = get().reportPrompt;
      set({ reportPrompt: null });
      const provider = getProviders().incidents;
      if (!p || !vote || !provider.vote) return;
      if (vote === 'gone') {
        set({ incidents: get().incidents.filter((i) => i.id !== p.incidentId) });
        get().rederive();
      }
      get().showNotice('success', currentMessages().reports.thanks);
      // Best effort: already voted, taken down meanwhile or offline all need nothing more.
      provider.vote(p.reportId, vote).catch(() => undefined);
    },

    // ---------------- Voice ----------------
    setAssistant: (patch) => set((s) => ({ assistant: { ...s.assistant, ...patch } })),
    say(text, priority = 3) {
      const speed = get().mode === 'simulating' ? get().sim.speed : 1;
      getVoiceQueue().enqueue({
        id: `say:${text}:${Math.floor(Date.now() / 1000)}`,
        text,
        priority,
        expiresAt: Date.now() + Math.max(5000, 60_000 / speed),
        interruptible: priority > 1,
      });
    },
  })),
);

/** Replace the plan object everywhere it is referenced (plan + its option slot). */
function replacePlan(next: PlannedRoute) {
  const s = useAppStore.getState();
  const options = s.routeOptions.map((o) => (o.timed === next.timed ? next : o));
  useAppStore.setState({ plan: next, routeOptions: options.length ? options : [next] });
}

/** Background work for a route: late place names, incidents (and, on drive start, OSM speed limits). */
function startPlanTasks(plan: PlannedRoute, keepSignal = false) {
  const signal = keepSignal && planTasks && !planTasks.signal.aborted ? planTasks.signal : newPlanTasks();
  useAppStore.setState({ incidents: [], reportPrompt: null });
  incidentsLoading = false;
  loadIncidents(plan.timed, signal);
  watchLatePlaces(plan, signal);
}

/** Name the route's samples with settlements that arrive after planning. */
function watchLatePlaces(plan: PlannedRoute, signal: AbortSignal) {
  if (!plan.latePlaces) return;
  void plan.latePlaces.then((places) => {
    const cur = useAppStore.getState().plan;
    if (signal.aborted || !cur || cur.timed !== plan.timed) return;
    replacePlan(applyLatePlaces(cur, places));
    useAppStore.getState().rederive();
  });
}

/**
 * Incidents on the route (driver reports by default). Optional: the route
 * works without them, and a failure only marks the source unavailable.
 */
function loadIncidents(timed: PlannedRoute['timed'], signal: AbortSignal) {
  const provider = getProviders().incidents;
  if (provider.name === 'none' || incidentsLoading) return;
  if (provider.name === 'reports' && !useSettings.getState().driverReports) return;
  incidentsLoading = true;
  incidentsLoadedAt = Date.now();
  const load = ++incidentsLoad;
  provider
    .getIncidents(timed.route, signal)
    .then((list) => {
      if (signal.aborted || useAppStore.getState().plan?.timed !== timed) return;
      // Dev-tools test incidents stay until the route changes.
      const simulated = useAppStore.getState().incidents.filter((i) => i.source === 'Simulation');
      const snapped = snapIncidentsToRoute(list, timed);
      useAppStore.setState({
        incidents: [...snapped, ...simulated].sort((a, b) => a.distanceAlongM - b.distanceAlongM),
        reportsStatus: 'ready',
      });
      useAppStore.getState().rederive();
    })
    .catch((e) => {
      if (!isAbortError(e)) useAppStore.setState({ reportsStatus: 'unavailable' });
    })
    .finally(() => {
      if (load === incidentsLoad) incidentsLoading = false;
    });
}

let speedLimitsFor: PlannedRoute['timed'] | null = null;
let camerasFor: PlannedRoute['timed'] | null = null;

/**
 * What a drive needs from OpenStreetMap beyond the route: speed limits,
 * cameras (if enabled) and road hazards — once per route, when a drive
 * starts or when one of them is switched on mid-drive.
 */
export function loadDriveExtras() {
  if (useAppStore.getState().mode === 'planning') return;
  loadSpeedLimits();
  loadSpeedCameras();
  loadRoadHazards();
}

/** Mapped speed cameras (only when enabled — not legal everywhere). */
function loadSpeedCameras() {
  const provider = getProviders().speedLimits;
  const timed = useAppStore.getState().plan?.timed;
  if (!provider?.getSpeedCameras || !timed || !useSettings.getState().speedCameras || camerasFor === timed) return;
  camerasFor = timed;
  const signal = planTasks?.signal ?? newPlanTasks();
  provider
    .getSpeedCameras(timed.route.geometry, signal)
    .then((cams) => {
      if (signal.aborted || useAppStore.getState().plan?.timed !== timed) return;
      useAppStore.setState({ speedCameras: snapCamerasToRoute(cams, timed) });
      useAppStore.getState().rederive();
    })
    .catch(() => {
      if (camerasFor === timed) camerasFor = null;
    });
}

/**
 * OSM speed limits, fetched once per route and only when a drive starts
 * (planning doesn't need them; the public Overpass servers are shared).
 */
function loadSpeedLimits() {
  const s = useAppStore.getState();
  const provider = getProviders().speedLimits;
  const timed = s.plan?.timed;
  if (!provider || !timed || !useSettings.getState().speedWarnings || speedLimitsFor === timed) return;
  speedLimitsFor = timed;
  const signal = planTasks?.signal ?? newPlanTasks();
  provider
    .getSpeedLimits(timed.route.geometry, signal)
    .then((ways) => {
      if (signal.aborted || useAppStore.getState().plan?.timed !== timed) return;
      useAppStore.setState({ speedLimits: matchSpeedLimits(timed, ways) });
      useAppStore.getState().rederive();
    })
    .catch(() => {
      if (speedLimitsFor === timed) speedLimitsFor = null; // allow a retry on the next drive
    });
}

let driveSavedAt = 0;

/** Real navigation only: destination + stops ahead, for "Continue to …" after an accidental reload. */
function rememberDrive() {
  const s = useAppStore.getState();
  if (s.mode !== 'navigating' || !s.plan) return;
  saveDriveSession(s.plan.timed.route.destination, stopsAhead(s));
  driveSavedAt = Date.now();
}

/** Stops of the active route the vehicle hasn't reached yet. */
function stopsAhead(s: AppState): Place[] {
  const progressM = s.progress?.distanceAlongM ?? 0;
  return (
    s.plan?.timed.route.waypoints?.filter((_, i) => {
      const arrive = s.derived.maneuvers.find((mv) => mv.kind === 'arrive' && mv.legIndex === i);
      return !arrive || arrive.distanceAlongM > progressM;
    }) ?? []
  );
}

let hazardsFor: PlannedRoute['timed'] | null = null;

/**
 * Sharp curves (from the route geometry — instant) and railway crossings
 * (OpenStreetMap), once per route when a drive starts.
 */
function loadRoadHazards() {
  const timed = useAppStore.getState().plan?.timed;
  if (!timed || !useSettings.getState().roadHazards || hazardsFor === timed) return;
  hazardsFor = timed;
  const curves = findSharpCurves(timed);
  useAppStore.setState({ roadHazards: curves });
  const provider = getProviders().speedLimits;
  if (!provider?.getLevelCrossings) return;
  const signal = planTasks?.signal ?? newPlanTasks();
  provider
    .getLevelCrossings(timed.route.geometry, signal)
    .then((points) => {
      if (signal.aborted || useAppStore.getState().plan?.timed !== timed) return;
      useAppStore.setState({ roadHazards: mergeHazards(curves, snapLevelCrossings(points, timed)) });
    })
    .catch(() => undefined);
}

/**
 * THE REAL-TIME LOOP (GPS fix or simulation step):
 * position → map-matched progress → guidance → maneuver voice → speed →
 * (throttled) weather/events → alert prioritisation → voice + visual.
 */
function onProgress(vehicle: VehicleState, progress: RouteProgress, speedMps: number | undefined, live: boolean) {
  const store = useAppStore;
  const s = store.getState();
  if (!s.plan) return;
  const settings = settingsSnapshot();
  const m = currentMessages();
  const simSpeed = s.mode === 'simulating' ? s.sim.speed : 1;

  // 1. Position + progress (every update; the map reads these imperatively).
  const maneuvers = s.derived.maneuvers.length ? s.derived.maneuvers : [];
  const guidance = computeGuidance(maneuvers, s.plan.timed, progress.distanceAlongM);
  const prevG = s.guidance;
  const guidanceChanged =
    !prevG || prevG.next?.id !== guidance.next?.id || Math.round(prevG.distanceToNextM / 10) !== Math.round(guidance.distanceToNextM / 10);

  // 2. Speed limit + speeding (hysteresis).
  const speedKmh = speedMps !== undefined && Number.isFinite(speedMps) ? speedMps * 3.6 : null;
  const limit = speedLimitAt(s.speedLimits, progress.distanceAlongM);
  const speeding = settings.speedWarnings ? updateSpeeding(s.speeding, live ? speedKmh : null, limit, progress.nowMs) : s.speeding;

  trackTrip(vehicle.coordinate, progress.nowMs, s.derived.currentPoint?.weather);
  store.setState({
    vehicle,
    progress,
    ...(guidanceChanged ? { guidance } : {}),
    ...(speeding !== s.speeding ? { speeding } : {}),
  });

  // 3. Maneuver voice — immediate, top priority. At fast simulation speeds the
  //    prompts would be meaningless, so only real-time-ish playback speaks them.
  const queue = getVoiceQueue();
  const next = guidance.next;
  if (next && simSpeed <= 10) {
    const v = speedMps ?? edgeSpeedMps(s.plan.timed, progress.segmentIndex) ?? 14;
    const stage = dueManeuverPrompt(next, guidance.distanceToNextM, v, spokenManeuvers);
    if (stage) {
      markSpoken(next, stage, spokenManeuvers);
      queue.enqueue({
        id: `mv:${next.id}:${stage}`,
        text: spokenPrompt(next, stage, guidance.distanceToNextM, m, settings.units.distance, guidance.then),
        priority: 1,
        expiresAt: Date.now() + Math.max(3000, 15_000 / simSpeed),
        interruptible: false,
      });
    }
    // Weather waits while a maneuver is seconds away.
    queue.holdBelowPriority(guidance.timeToNextS < 12 ? 1 : null);
  } else {
    queue.holdBelowPriority(null);
  }

  // 3b. Speed cameras (if enabled): once, ~600 m / 25 s before.
  if (settings.speedCameras && s.speedCameras.length && simSpeed <= 10) {
    const cam = dueCamera(s.speedCameras, progress.distanceAlongM, speedMps ?? 14, spokenCameras);
    if (cam) {
      spokenCameras.add(cam.id);
      const limit = cam.kmh ? `${speedValue(cam.kmh, settings.units.distance)} ${settings.units.distance === 'imperial' ? m.units.mph : m.units.kmh}` : undefined;
      queue.enqueue({ id: `cam:${cam.id}`, text: m.alert.voice.speedCamera(limit), priority: 2, expiresAt: Date.now() + 20_000 / simSpeed, interruptible: true });
    }
  }

  // 3c. Road hazards: sharp curves (with the forecast road surface) and level crossings, ~300 m / 15 s before.
  if (settings.roadHazards && s.roadHazards.length && simSpeed <= 10) {
    const hz = dueHazard(s.roadHazards, progress.distanceAlongM, speedMps ?? 14, spokenHazards);
    if (hz) {
      spokenHazards.add(hz.id);
      const text =
        hz.kind === 'level_crossing'
          ? m.hazard.voiceLevelCrossing
          : m.hazard.voiceCurve(hz.side ?? 'right', hazardLabelKind(hz), roadSurface(weatherAtDistance(s.derived.points, hz.distanceAlongM)));
      queue.enqueue({ id: `hz:${hz.id}`, text, priority: 2, expiresAt: Date.now() + 15_000 / simSpeed, interruptible: true });
    }
  }

  // 3c'. Keep "continue after reload" fresh (once a minute).
  if (live && Date.now() - driveSavedAt > 60_000) rememberDrive();

  // 3d. An offered weather re-route goes stale once the car has driven on.
  if (s.weatherReroute && progress.distanceAlongM - s.weatherReroute.atProgressM > 1500) store.setState({ weatherReroute: null });

  // 3e. Driver reports: fresh ones every few minutes; "still there?" just after
  //     passing someone else's report (real drives only — a simulation saw nothing).
  if (s.online && Date.now() - incidentsLoadedAt > INCIDENT_REFRESH_MS) s.refreshIncidents();
  if (live && settings.driverReports && !s.reportPrompt && s.incidents.length) {
    const passed = s.incidents.find((inc) => {
      if (!inc.reportId || askedReports.has(inc.reportId)) return false;
      const behind = progress.distanceAlongM - inc.distanceAlongM;
      return behind >= 30 && behind <= 400;
    });
    if (passed?.reportId) {
      askedReports.add(passed.reportId);
      store.setState({ reportPrompt: { incidentId: passed.id, reportId: passed.reportId, kind: passed.kind } });
    }
  }

  // 4. Weather + route events: throttled (≤1/s real time, or every 30 s of simulated time).
  const due = performance.now() - lastDeriveAt > 1000 || progress.nowMs - lastDeriveSimMs >= 30_000;
  if (!due) return;
  store.setState({ derived: derive(store.getState()) });
  const st = store.getState();
  const decision = evaluateDriverAlerts(st.derived.intelligence.events, st.alertState, {
    nowMs: progress.nowMs,
    prefs: { output: settings.alertOutput, timing: settings.alertTiming },
    m,
  });
  store.setState({ alertState: decision.state, ...(decision.visual ? { activeAlert: decision.visual } : {}) });
  void maybeOfferWeatherReroute();
  for (const v of decision.voice) {
    queue.enqueue({
      id: v.id,
      text: v.text,
      priority: v.priority,
      // Alert time runs on the (possibly simulated) route clock; the queue on real time.
      expiresAt: Date.now() + Math.max(5000, (v.expiresAt - progress.nowMs) / simSpeed),
      interruptible: true,
    });
  }
}

/**
 * Every ~10 min while driving: if severe weather (or fog) lies ahead at the
 * times you'd get there, ask for the routes from here and offer one that is
 * clearly better for a reasonable extra time. `force`: dev tools.
 */
export async function maybeOfferWeatherReroute(force = false): Promise<void> {
  const store = useAppStore;
  const s = store.getState();
  if (s.mode === 'planning' || !s.plan || !s.progress || !s.vehicle || s.recalculating || s.weatherReroute || s.arrival || !s.online) return;
  const realNow = Date.now();
  if (!force && (realNow - rerouteCheckedAt < 10 * 60_000 || realNow < rerouteQuietUntil)) return;
  if (rerouteCheck) return;
  const timed = s.plan.timed;
  // The public router offers alternatives only between two points.
  if (timed.route.waypoints?.length) return;
  const progressM = s.progress.distanceAlongM;
  const tNow = timeAtDistance(timed, progressM);
  const remainingS = timed.totalTimeS - tNow;
  if (timed.totalDistM - progressM < 20_000 || remainingS < 20 * 60) return;
  rerouteCheckedAt = realNow;
  const now = clockNow(s);
  const current = exposureOf(remainingSamples(s.plan.samples, progressM, tNow), lookupFor(s.forecasts), now);
  const fmt = (e: Exposure | null) => (e ? `${e.score} (severe ${e.severeMinutes}, wet ${e.wetMinutes}, fog ${e.fogMinutes})` : 'no data');
  rerouteDiag = `current ${fmt(current)} · checking…`;
  if (!current || !worthChecking(current)) return;

  const ctrl = new AbortController();
  rerouteCheck = ctrl;
  const m = currentMessages();
  const from = s.vehicle.coordinate;
  const headingDeg = s.vehicle.headingDeg;
  const routeFor = s.plan.timed; // the plan object is replaced as names arrive; the route isn't
  try {
    const providers = getProviders();
    const origin: Place = { id: `here:${from.join(',')}`, name: m.ui.currentLocation, label: m.ui.currentLocation, coordinate: from };
    const { primary, alternatives } = await planRouteOptions(providers, origin, timed.route.destination, {
      signal: ctrl.signal,
      alternatives: true,
      startBearingDeg: headingDeg,
      language: m.locale,
      placesDeadlineMs: 1500,
    });
    const candidates = [primary, ...alternatives];
    const longest = Math.max(...candidates.map((c) => c.timed.totalTimeS));
    const lookup = await fetchSampleForecasts(
      providers,
      candidates.flatMap((c) => c.samples),
      now + longest * 1000,
      { signal: ctrl.signal },
    );
    const st = store.getState();
    if (ctrl.signal.aborted || st.plan?.timed !== routeFor || st.mode === 'planning' || st.weatherReroute) {
      rerouteDiag += ' · dropped (route changed)';
      return;
    }
    // Shared road is scored with the forecast the drive already shows; only the parts that differ count.
    const merged = new Map(lookup.forecasts);
    for (const [k, f] of st.forecasts) merged.set(k, f);
    const forecastFor = sharedForecastFor(routeFor, st.plan.samples, lookupFor(st.forecasts), forecastLookupFn(providers, merged));
    const scored = candidates.map((c) => ({ exposure: exposureOf(c.samples, forecastFor, now), durationS: c.timed.totalTimeS }));
    const choice = pickWeatherReroute(current, remainingS, scored);
    rerouteDiag = `current ${fmt(current)} · ${scored.map((c) => `${fmt(c.exposure)} ${Math.round((c.durationS - remainingS) / 60)}min`).join(' | ')} → ${choice ? `offer #${choice.index}` : 'no offer'}`;
    if (!choice) return;
    const worst = st.derived.upcoming.map((p) => p.weather?.condition);
    const condition: WeatherRerouteOffer['condition'] = worst.includes('THUNDERSTORM')
      ? 'storm'
      : worst.includes('SNOW') || worst.includes('SLEET')
        ? 'snow'
        : current.severeMinutes >= 5
          ? 'heavy'
          : 'fog';
    const offer: WeatherRerouteOffer = {
      plan: candidates[choice.index],
      extraS: choice.extraS,
      current: choice.current,
      alternative: choice.alternative,
      condition,
      atProgressM: st.progress?.distanceAlongM ?? progressM,
      from,
      headingDeg,
    };
    store.setState({ weatherReroute: offer });
    st.say(m.reroute.voice(m.reroute.condition[condition], Math.round(Math.max(0, choice.extraS) / 60)), 2);
  } catch (e) {
    if (!isAbortError(e)) rerouteDiag = `check failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (rerouteCheck === ctrl) rerouteCheck = null;
  }
}

/** Other known roads within reach of the car (the one being driven excluded). */
function reachableRoads(s: AppState): PlannedRoute[] {
  const current = s.plan;
  if (!current || !s.vehicle || s.routeOptions.length < 2) return [];
  return roadsNearCar(s.routeOptions.map((o) => o.timed), s.vehicle.coordinate)
    .map((r) => s.routeOptions[r.index])
    .filter((o) => o.timed !== current.timed);
}

/**
 * Continue the drive on `routeOptions[index]`, another road the app already
 * knows: the driver took it, or picked it from "other roads". Needs no
 * network — its forecast is already loaded — and takes the car's place on it
 * from the car's position, so ETA, guidance and weather follow at once.
 */
function switchDriveTo(index: number): void {
  const store = useAppStore;
  const cur = store.getState();
  const road = cur.routeOptions[index];
  const car = cur.vehicle;
  if (!road || !car || cur.mode === 'planning' || !cur.plan || road.timed === cur.plan.timed) return;
  const m = currentMessages();
  const simulating = cur.mode === 'simulating';
  const now = simulating ? cur.sim.nowMs : Date.now();
  let progress: RouteProgress;
  if (simulating) {
    const along = projectorFor(road.timed)(car.coordinate).distanceAlongM;
    progress = simProgress(road.timed, {
      nowMs: now,
      modelTimeS: timeAtDistance(road.timed, along),
      distanceM: along,
      coordinate: car.coordinate,
      headingDeg: car.headingDeg ?? 0,
      arrived: false,
    });
  } else {
    tracker = createProgressTracker(road.timed);
    progress = tracker(car.coordinate, now, { headingDeg: car.headingDeg, accuracyM: car.accuracyM });
  }
  spokenManeuvers.clear();
  spokenCameras.clear();
  spokenHazards.clear();
  store.setState({
    plan: road,
    selectedOption: index,
    // Positions on the old road mean nothing on this one (they are reloaded below).
    speedLimits: null,
    speedCameras: [],
    roadHazards: [],
    reportPrompt: null,
    // This road's own clock: it started `modelTimeS` before the car got on it.
    navStartedMs: now - progress.modelTimeS * 1000,
    progress,
    ...(simulating ? { sim: { ...cur.sim, modelTimeS: progress.modelTimeS } } : {}),
    deviation: initialDeviationState,
    recalculating: false,
    weatherReroute: null,
    navPrompt: null,
    followVehicle: true,
    selectedPointId: null,
    poi: null,
  });
  store.setState({ derived: derive(store.getState()) });
  store.setState({ guidance: computeGuidance(store.getState().derived.maneuvers, road.timed, progress.distanceAlongM) });
  startPlanTasks(road);
  rememberDrive();
  loadDriveExtras();
  store.getState().showNotice('success', m.ui.routeUpdated);
  store.getState().say(m.voice.rerouted, 3);
  if (road.warnings.includes('not-enriched')) void enrichKnownRoad(road);
  else void store.getState().loadWeather({ reason: 'auto' });
}

/**
 * Roads offered at the start were only timed + sampled. Once the drive is on
 * one, add its place names and elevation (best effort) and refresh its weather.
 * The road keeps its `timed` object, so work already started for it stays valid.
 */
async function enrichKnownRoad(road: PlannedRoute): Promise<void> {
  const store = useAppStore;
  const signal = planTasks?.signal ?? newPlanTasks();
  try {
    const enriched = await enrichRoute(getProviders(), road.timed.route, { signal, language: currentMessages().locale, timed: road.timed });
    if (signal.aborted || store.getState().plan?.timed !== road.timed) return;
    replacePlan(enriched);
    watchLatePlaces(enriched, signal);
  } catch (e) {
    if (isAbortError(e)) return;
  }
  if (!signal.aborted && store.getState().plan?.timed === road.timed) await store.getState().loadWeather({ reason: 'auto' });
}

/**
 * After a re-route, best effort: the other roads from where the driver
 * turned, with their forecast, kept as "other roads" for as long as the car
 * could still take them. Never delays the new directions.
 */
async function loadOtherRoads(plan: PlannedRoute, origin: Place, headingDeg: number | undefined, signal: AbortSignal | undefined): Promise<void> {
  const store = useAppStore;
  try {
    const roads = await planOtherRoads(getProviders(), origin, plan.timed.route.destination, {
      reference: plan.timed.route,
      startBearingDeg: headingDeg,
      language: currentMessages().locale,
      signal,
    });
    const cur = store.getState();
    if (signal?.aborted || cur.mode === 'planning' || !cur.plan || cur.plan.timed !== plan.timed || roads.length === 0) return;
    store.setState({ routeOptions: [cur.plan, ...roads], selectedOption: 0 });
    await store.getState().loadWeather({ reason: 'auto' });
  } catch {
    /* other roads are a nicety: the drive goes on without them */
  }
}

/** Switch the drive to `plan`, a route computed from the vehicle position. */
async function adoptRoute(plan: PlannedRoute, coordinate: LngLat, headingDeg: number | undefined): Promise<void> {
  const store = useAppStore;
  const cur = store.getState();
  const m = currentMessages();
  tracker = createProgressTracker(plan.timed);
  spokenManeuvers.clear();
  spokenCameras.clear();
  spokenHazards.clear();
  // A simulated drive restarts on the new route (its clock keeps running).
  const simulating = cur.mode === 'simulating';
  const now = simulating ? cur.sim.nowMs : Date.now();
  const start = plan.timed.route.geometry[0];
  const progress = simulating
    ? simProgress(plan.timed, { nowMs: now, modelTimeS: 0, distanceM: 0, coordinate: start, headingDeg: headingDeg ?? 0, arrived: false })
    : tracker(coordinate, now, { headingDeg });
  store.setState({
    plan,
    routeOptions: [plan],
    selectedOption: 0,
    speedLimits: null,
    // Positions on the old route mean nothing on the new one (they are reloaded below).
    speedCameras: [],
    roadHazards: [],
    reportPrompt: null,
    navStartedMs: now,
    progress,
    ...(simulating ? { sim: { ...cur.sim, modelTimeS: 0, startMs: now, arrived: false }, vehicle: { coordinate: start, headingDeg, timestampMs: now } } : {}),
    deviation: initialDeviationState,
    recalculating: false,
    weatherReroute: null,
    mode: cur.mode === 'simulating' ? 'simulating' : 'navigating',
    navPrompt: null,
    followVehicle: true,
    selectedPointId: null,
    poi: null,
  });
  store.setState({ derived: derive(store.getState()) });
  startPlanTasks(plan);
  rememberDrive();
  loadDriveExtras();
  store.getState().showNotice('success', m.ui.routeUpdated);
  store.getState().say(m.voice.rerouted, 3);
  await store.getState().loadWeather({ reason: 'recalculation' });
}

/** Off-route (or far-from-route start): re-plan from the vehicle to the destination. */
async function recalculateFrom(coordinate: LngLat, headingDeg?: number, extraStops: Place[] = []): Promise<void> {
  const store = useAppStore;
  const s = store.getState();
  if (!s.plan) return;
  const m = currentMessages();
  lastRecalcAt = Date.now();
  routeAbort?.abort();
  const ctrl = new AbortController();
  routeAbort = ctrl;
  if (trip) trip.reroutes++;
  store.setState({ recalculating: true });
  s.showNotice('info', m.ui.recalculating, true);
  const origin: Place = { id: `here:${coordinate.join(',')}`, name: m.ui.currentLocation, label: m.ui.currentLocation, coordinate };
  // Keep only stops still ahead of the vehicle.
  const route = s.plan.timed.route;
  const aheadStops = stopsAhead(s);
  try {
    const plan = await planRoute(getProviders(), origin, route.destination, {
      signal: ctrl.signal,
      startBearingDeg: headingDeg,
      waypoints: [...extraStops, ...aheadStops],
      language: m.locale,
    });
    // Navigation ended while we were re-routing → drop the result (audit race).
    if (ctrl.signal.aborted || store.getState().mode === 'planning') return;
    const adopting = adoptRoute(plan, coordinate, headingDeg);
    // The public router offers alternatives only between two points (no stops).
    if (extraStops.length + aheadStops.length === 0) void loadOtherRoads(plan, origin, headingDeg, planTasks?.signal);
    await adopting;
  } catch (e) {
    if (isAbortError(e)) return;
    store.setState({ recalculating: false });
    const offline = !store.getState().online;
    store.getState().showNotice('error', offline ? m.ui.offlineDetail : describeError(e, m.ui.unableRoute, m));
  } finally {
    if (routeAbort === ctrl) routeAbort = null;
  }
}

/** "Your location" couldn't be used for a trip: what's wrong, and to type a start instead. */
export function tripLocationErrorText(kind: LocationError['kind']): string {
  const m = currentMessages();
  return kind === 'timeout' ? m.location.notFound : `${locationErrorText(kind)} ${m.location.typeStart}`;
}

/** Same wording as the explore layer (platform-specific help for "denied"). */
function locationErrorText(kind: LocationError['kind']): string {
  const m = currentMessages();
  const ios = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  return kind === 'denied' && ios ? m.location.deniedIos : m.location.errors[kind];
}

/** Dev tools: re-route as if the vehicle had left the route at `coordinate`. */
export function __devRerouteFrom(coordinate: LngLat, headingDeg?: number) {
  return recalculateFrom(coordinate, headingDeg);
}

/** Test helper: reset module-level runtime state. */
export function __resetStoreRuntime() {
  routeAbort?.abort();
  weatherAbort?.abort();
  planTasks?.abort();
  routeAbort = null;
  weatherAbort = null;
  planTasks = null;
  tracker = null;
  namingAttempted.clear();
  spokenManeuvers.clear();
  spokenCameras.clear();
  spokenHazards.clear();
  askedReports.clear();
  incidentsLoadedAt = 0;
  incidentsLoading = false;
  voiceQueue = null;
  voiceHintShown = false;
  trip = null;
  speedLimitsFor = null;
  camerasFor = null;
  hazardsFor = null;
  lastDeriveAt = 0;
  lastDeriveSimMs = 0;
  lastRecalcAt = 0;
  rerouteCheckedAt = 0;
  rerouteQuietUntil = 0;
  rerouteCheck?.abort();
}

