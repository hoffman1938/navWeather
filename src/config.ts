/**
 * Single source of configuration. Every tunable reads from Vite env vars
 * (see .env.example) with a sensible default, so the app runs with no .env.
 */

type Env = Record<string, string | boolean | undefined>;

const env: Env = (import.meta as unknown as { env?: Env }).env ?? {};

function str(key: string, fallback: string): string {
  const v = env[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}

function num(key: string, fallback: number): number {
  const v = env[key];
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function list(key: string, fallback: string[]): string[] {
  const v = env[key];
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  providers: {
    routing: str('VITE_ROUTING_PROVIDER', 'osrm'),
    weather: str('VITE_WEATHER_PROVIDER', 'open-meteo'),
    geocoding: str('VITE_GEOCODING_PROVIDER', 'nominatim'),
    autocomplete: str('VITE_AUTOCOMPLETE_PROVIDER', 'photon'),
    places: str('VITE_PLACES_PROVIDER', 'overpass'),
    elevation: str('VITE_ELEVATION_PROVIDER', 'open-meteo'),
    map: str('VITE_MAP_PROVIDER', 'openfreemap'),
    poi: str('VITE_POI_PROVIDER', 'overpass'),
    speedLimits: str('VITE_SPEED_LIMIT_PROVIDER', 'overpass'),
    traffic: str('VITE_TRAFFIC_PROVIDER', 'none'),
    incidents: str('VITE_INCIDENT_PROVIDER', 'none'),
    speech: str('VITE_SPEECH_PROVIDER', 'browser'),
  },
  endpoints: {
    osrm: str('VITE_OSRM_BASE_URL', 'https://router.project-osrm.org'),
    openMeteo: str('VITE_OPEN_METEO_BASE_URL', 'https://api.open-meteo.com'),
    nominatim: str('VITE_NOMINATIM_BASE_URL', 'https://nominatim.openstreetmap.org'),
    photon: str('VITE_PHOTON_BASE_URL', 'https://photon.komoot.io'),
    overpass: list('VITE_OVERPASS_URLS', [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]),
    mapStyleLight: str('VITE_MAP_STYLE_LIGHT', 'https://tiles.openfreemap.org/styles/positron'),
    mapStyleDark: str('VITE_MAP_STYLE_DARK', 'https://tiles.openfreemap.org/styles/dark'),
  },
  geocoding: {
    language: str('VITE_GEOCODING_LANGUAGE', 'en'),
    /** Nominatim policy: max 1 request/second. */
    nominatimMinIntervalMs: num('VITE_NOMINATIM_MIN_INTERVAL_MS', 1100),
    autocompleteDebounceMs: num('VITE_AUTOCOMPLETE_DEBOUNCE_MS', 300),
  },
  weather: {
    cacheTtlMinutes: num('VITE_WEATHER_CACHE_TTL_MINUTES', 20),
    refreshMinutes: num('VITE_WEATHER_REFRESH_MINUTES', 20),
    /** Grid size for the spatial cache key. 0.02° ≈ 2.2 km — fine enough for mountains/coasts. */
    spatialResolutionDeg: num('VITE_WEATHER_SPATIAL_RESOLUTION_DEG', 0.02),
    batchSize: num('VITE_WEATHER_BATCH_SIZE', 50),
    maxCacheEntries: num('VITE_WEATHER_MAX_CACHE_ENTRIES', 500),
    requestTimeoutMs: num('VITE_WEATHER_TIMEOUT_MS', 15000),
    /** Hours of forecast always requested (rounded up to cover the whole trip). */
    minForecastHours: num('VITE_WEATHER_MIN_FORECAST_HOURS', 48),
    /** How often to ask the provider whether a newer model run exists. */
    updateCheckMinutes: num('VITE_WEATHER_UPDATE_CHECK_MINUTES', 10),
    openMeteoUpdateModels: list('VITE_OPEN_METEO_UPDATE_MODELS', ['ecmwf_ifs025', 'dwd_icon', 'ncep_gfs025']),
  },
  sampling: {
    maxIntervalMinutes: num('VITE_SAMPLE_MAX_INTERVAL_MINUTES', 45),
    /** Extra points added between samples whose weather differs a lot. */
    maxRefinementPoints: num('VITE_SAMPLE_MAX_REFINEMENT_POINTS', 10),
  },
  navigation: {
    offRouteMinThresholdM: num('VITE_OFF_ROUTE_MIN_THRESHOLD_M', 30),
    offRouteMaxThresholdM: num('VITE_OFF_ROUTE_MAX_THRESHOLD_M', 100),
    offRoutePersistSeconds: num('VITE_OFF_ROUTE_PERSIST_SECONDS', 8),
    offRoutePersistReadings: num('VITE_OFF_ROUTE_PERSIST_READINGS', 3),
    /** GPS fixes worse than this are ignored for deviation decisions. */
    maxUsableAccuracyM: num('VITE_MAX_USABLE_GPS_ACCURACY_M', 100),
    minRecalculationIntervalS: num('VITE_MIN_RECALC_INTERVAL_S', 20),
    /** Starting navigation farther than this from the route asks the user first. */
    farFromRouteM: num('VITE_FAR_FROM_ROUTE_M', 3000),
  },
  simulation: {
    /** 1–10× are real-ish playback; 60×/300× let a long drive be demoed in minutes. */
    speeds: [1, 2, 5, 10, 60, 300] as number[],
    defaultSpeed: num('VITE_SIMULATION_DEFAULT_SPEED', 60),
  },
} as const;

export type AppConfig = typeof config;
