import { config, type AppConfig } from '../config';
import type { ElevationProvider } from './elevation/ElevationProvider';
import { OpenMeteoElevationProvider } from './elevation/OpenMeteoElevationProvider';
import type { AutocompleteProvider, GeocodingProvider } from './geocoding/GeocodingProvider';
import { NominatimProvider } from './geocoding/NominatimProvider';
import { PhotonProvider } from './geocoding/PhotonProvider';
import { StyleUrlMapProvider, type MapProvider } from './map/MapProvider';
import { OverpassPlacesProvider } from './places/OverpassPlacesProvider';
import type { PlacesProvider } from './places/PlacesProvider';
import { OverpassPoiProvider } from './places/OverpassPoiProvider';
import type { PoiProvider } from './places/PoiProvider';
import { OverpassSpeedLimitProvider } from './speed/OverpassSpeedLimitProvider';
import type { SpeedLimitProvider } from './speed/SpeedLimitProvider';
import {
  BrowserSpeechRecognition,
  BrowserSpeechSynthesis,
  type SpeechRecognitionProvider,
  type TextToSpeechProvider,
} from '../voice/providers';
import type { Locale } from '../i18n';
import { useSettings } from '../state/settings';
import type { TravelMode } from '../types/travel';
import { FlightEstimateProvider } from './routing/FlightEstimateProvider';
import { OSRMProvider } from './routing/OSRMProvider';
import type { RoutingProvider } from './routing/RoutingProvider';
import { OpenMeteoAirQualityProvider, type AirQualityProvider } from './air/AirQualityProvider';
import { NoIncidentProvider, type IncidentProvider } from './traffic/IncidentProvider';
import { ReportsIncidentProvider } from './traffic/ReportsIncidentProvider';
import { NoTrafficProvider, type TrafficProvider } from './traffic/TrafficProvider';
import { OpenMeteoProvider } from './weather/OpenMeteoProvider';
import type { WeatherProvider } from './weather/WeatherProvider';
import { WeatherService } from './weather/WeatherService';

export interface Providers {
  /** The car router. Other modes: `routingByMode` (see `providersForMode`). */
  routing: RoutingProvider;
  /** Routers for the other ways to travel. A mode without one (public transport) is not available. */
  routingByMode?: Partial<Record<Exclude<TravelMode, 'drive'>, RoutingProvider>>;
  geocoding: GeocodingProvider;
  autocomplete: AutocompleteProvider;
  /** Lightweight reverse geocoder for naming route points. */
  reverseGeocoding: GeocodingProvider;
  places: PlacesProvider | null;
  /** Places along the route (fuel, food, hotels…). */
  poi: PoiProvider | null;
  speedLimits: SpeedLimitProvider | null;
  elevation: ElevationProvider | null;
  traffic: TrafficProvider;
  incidents: IncidentProvider;
  /** Air quality (AQI) — optional. */
  air: AirQualityProvider | null;
  map: MapProvider;
  weather: WeatherService;
  tts: TextToSpeechProvider;
  speechRecognition: SpeechRecognitionProvider;
}

function unknown(kind: string, name: string): never {
  throw new Error(`Unknown ${kind} provider "${name}". Check your VITE_* environment variables.`);
}

/** Build providers from configuration. The only place provider classes are named. */
export function createProviders(cfg: AppConfig = config): Providers {
  const { providers: p, endpoints: e } = cfg;

  const photon = new PhotonProvider(e.photon, cfg.geocoding.language);

  const routing: RoutingProvider =
    // Ask for as many alternatives as roads we show: the distinct-road filter then has spares to drop.
    p.routing === 'osrm' ? new OSRMProvider(e.osrm, 'driving', 20000, undefined, cfg.routing.maxRoutes) : unknown('routing', p.routing);

  // Walking and cycling: OSM community instances of the same router (no per-edge lane data, no table service assumed).
  const onFoot = (base: string): RoutingProvider =>
    new OSRMProvider(base, 'driving', 20000, { alternatives: true, avoid: [], laneGuidance: false, matrix: false, multiStop: true, via: true }, cfg.routing.maxRoutes);
  const routingByMode: Providers['routingByMode'] =
    p.routing === 'osrm' ? { walk: onFoot(e.osrmFoot), bike: onFoot(e.osrmBike), flight: new FlightEstimateProvider() } : { flight: new FlightEstimateProvider() };

  const geocoding: GeocodingProvider =
    p.geocoding === 'nominatim'
      ? new NominatimProvider(e.nominatim, cfg.geocoding.language, cfg.geocoding.nominatimMinIntervalMs)
      : p.geocoding === 'photon'
        ? photon
        : unknown('geocoding', p.geocoding);

  const autocomplete: AutocompleteProvider =
    p.autocomplete === 'photon' ? photon : unknown('autocomplete', p.autocomplete);

  const weatherProvider: WeatherProvider =
    p.weather === 'open-meteo'
      ? new OpenMeteoProvider(
          e.openMeteo,
          cfg.weather.batchSize,
          cfg.weather.requestTimeoutMs,
          cfg.weather.openMeteoUpdateModels,
        )
      : unknown('weather', p.weather);

  const places: PlacesProvider | null =
    p.places === 'overpass'
      ? new OverpassPlacesProvider(e.overpass, cfg.geocoding.language)
      : p.places === 'none'
        ? null
        : unknown('places', p.places);

  const elevation: ElevationProvider | null =
    p.elevation === 'open-meteo'
      ? new OpenMeteoElevationProvider(e.openMeteo)
      : p.elevation === 'none'
        ? null
        : unknown('elevation', p.elevation);

  const map: MapProvider =
    p.map === 'openfreemap' || p.map === 'style-url'
      ? new StyleUrlMapProvider(p.map, e.mapStyleLight, e.mapStyleDark)
      : unknown('map', p.map);

  const poi: PoiProvider | null =
    p.poi === 'overpass' ? new OverpassPoiProvider(e.overpass, cfg.geocoding.language) : p.poi === 'none' ? null : unknown('poi', p.poi);
  const speedLimits: SpeedLimitProvider | null =
    p.speedLimits === 'overpass'
      ? new OverpassSpeedLimitProvider(e.overpass)
      : p.speedLimits === 'none'
        ? null
        : unknown('speed limit', p.speedLimits);
  // No free live-traffic source exists; the interface is ready for one.
  const traffic: TrafficProvider = p.traffic === 'none' ? new NoTrafficProvider() : unknown('traffic', p.traffic);
  // Driver reports go through the app's own relay (worker/reports.ts); official feeds can plug in here.
  const incidents: IncidentProvider =
    p.incidents === 'reports'
      ? new ReportsIncidentProvider(e.reports)
      : p.incidents === 'none'
        ? new NoIncidentProvider()
        : unknown('incident', p.incidents);
  const air: AirQualityProvider | null =
    p.airQuality === 'open-meteo' ? new OpenMeteoAirQualityProvider(e.openMeteoAir) : p.airQuality === 'none' ? null : unknown('air quality', p.airQuality);
  if (p.speech !== 'browser') unknown('speech', p.speech);

  return {
    routing,
    routingByMode,
    geocoding,
    autocomplete,
    reverseGeocoding: photon,
    places,
    poi,
    speedLimits,
    elevation,
    traffic,
    incidents,
    air,
    map,
    weather: new WeatherService(weatherProvider, {
      ttlMs: cfg.weather.cacheTtlMinutes * 60000,
      batchSize: cfg.weather.batchSize,
      resolutionDeg: cfg.weather.spatialResolutionDeg,
      maxEntries: cfg.weather.maxCacheEntries,
      minForecastHours: cfg.weather.minForecastHours,
      updateCheckMs: cfg.weather.updateCheckMinutes * 60000,
    }),
    tts: googleVoice(),
    speechRecognition: new BrowserSpeechRecognition(),
  };
}

/** Google voices; the one picked in Settings (per language) when there is one. */
function googleVoice(): BrowserSpeechSynthesis {
  const tts = new BrowserSpeechSynthesis();
  tts.preferredVoice = (lang) => {
    const choice = useSettings.getState().voiceByLang[lang.slice(0, 2).toLowerCase() as Locale];
    return choice?.startsWith('device:') ? choice.slice(7) : null;
  };
  return tts;
}

let singleton: Providers | null = null;

/** App-wide providers (lazily created; tests can inject via setProviders). */
export function getProviders(): Providers {
  if (!singleton) singleton = createProviders();
  return singleton;
}

/**
 * The providers to plan and navigate a trip made `mode`: the same as the
 * app's, with that mode's router. A flight has no places or road data along
 * it. null when the mode has no router (public transport).
 */
export function providersForMode(base: Providers, mode: TravelMode): Providers | null {
  if (mode === 'drive') return base;
  const routing = base.routingByMode?.[mode];
  if (!routing) return null;
  return mode === 'flight' ? { ...base, routing, places: null, elevation: null, poi: null, speedLimits: null } : { ...base, routing };
}

export function setProviders(p: Providers | null): void {
  singleton = p;
}
