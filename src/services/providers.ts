import { config, type AppConfig } from '../config';
import type { ElevationProvider } from './elevation/ElevationProvider';
import { OpenMeteoElevationProvider } from './elevation/OpenMeteoElevationProvider';
import type { AutocompleteProvider, GeocodingProvider } from './geocoding/GeocodingProvider';
import { NominatimProvider } from './geocoding/NominatimProvider';
import { PhotonProvider } from './geocoding/PhotonProvider';
import { ApiGeocodingProvider, TileReverseGeocoder } from './geocoding/ApiGeocodingProvider';
import { StyleUrlMapProvider, type MapProvider } from './map/MapProvider';
import { OverpassPlacesProvider } from './places/OverpassPlacesProvider';
import type { PlacesProvider } from './places/PlacesProvider';
import { OverpassPoiProvider } from './places/OverpassPoiProvider';
import type { PoiProvider } from './places/PoiProvider';
import { PlacesTiles } from './places/tiles';
import { TilePlacesProvider, TilePoiProvider, TileSpeedLimitProvider } from './places/TileProviders';
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
import { ValhallaProvider } from './routing/ValhallaProvider';
import { TransitousProvider } from './routing/TransitousProvider';
import type { RoutingProvider } from './routing/RoutingProvider';
import { OpenMeteoAirQualityProvider, type AirQualityProvider } from './air/AirQualityProvider';
import { NoIncidentProvider, type IncidentProvider } from './traffic/IncidentProvider';
import { ReportsIncidentProvider } from './traffic/ReportsIncidentProvider';
import { NoTrafficProvider, type TrafficProvider } from './traffic/TrafficProvider';
import { ApiWeatherProvider } from './weather/ApiWeatherProvider';
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

  // The public OSRM servers (car: the demo server; walking and cycling: OSM community instances, no lane data,
  // no table service assumed). Ask for as many alternatives as roads we show: the distinct-road filter drops spares.
  const osrmCar = () => new OSRMProvider(e.osrm, 'driving', 20000, undefined, cfg.routing.maxRoutes, cfg.routing.osrmMinIntervalMs);
  const onFoot = (base: string): RoutingProvider =>
    new OSRMProvider(
      base,
      'driving',
      20000,
      { alternatives: true, avoid: [], laneGuidance: false, matrix: false, multiStop: true, via: true },
      cfg.routing.maxRoutes,
      cfg.routing.osrmMinIntervalMs,
    );
  // Our Valhalla first (DP-6.2, DP-6.3); the public servers only where it can't answer, while VITE_ROUTING_FALLBACK allows.
  const osrmFallback = p.routingFallback === 'osrm' ? true : p.routingFallback === 'none' ? false : unknown('routing fallback', p.routingFallback);
  const alternates = Math.min(2, cfg.routing.maxRoutes - 1);
  const routing: RoutingProvider =
    p.routing === 'valhalla'
      ? new ValhallaProvider(e.route, 'drive', osrmFallback ? osrmCar() : null, alternates)
      : p.routing === 'osrm'
        ? osrmCar()
        : unknown('routing', p.routing);
  const routingByMode: NonNullable<Providers['routingByMode']> =
    p.routing === 'valhalla'
      ? {
          walk: new ValhallaProvider(e.route, 'walk', osrmFallback ? onFoot(e.osrmFoot) : null, alternates),
          bike: new ValhallaProvider(e.route, 'bike', osrmFallback ? onFoot(e.osrmBike) : null, alternates),
          flight: new FlightEstimateProvider(),
        }
      : { walk: onFoot(e.osrmFoot), bike: onFoot(e.osrmBike), flight: new FlightEstimateProvider() };
  // Public transport: timetables operators publish, through Transitous (no key). Off when the URL is set empty.
  if (e.transit) routingByMode.transit = new TransitousProvider(e.transit, cfg.geocoding.language);

  // Our tiles (places, settlements) and our geocoder first; public servers only where our data has nothing.
  const tiles = new PlacesTiles(e.placesTiles);
  const lang = cfg.geocoding.language;
  const geoFallback = p.geocodingFallback === 'photon' ? photon : p.geocodingFallback === 'none' ? null : unknown('geocoding fallback', p.geocodingFallback);
  const reverser = new TileReverseGeocoder(tiles, lang, geoFallback);
  const ours = new ApiGeocodingProvider(e.geocode, lang, geoFallback, reverser);

  const geocoding: GeocodingProvider =
    p.geocoding === 'api'
      ? ours
      : p.geocoding === 'nominatim'
        ? new NominatimProvider(e.nominatim, lang, cfg.geocoding.nominatimMinIntervalMs)
        : p.geocoding === 'photon'
          ? photon
          : unknown('geocoding', p.geocoding);

  const autocomplete: AutocompleteProvider = p.autocomplete === 'api' ? ours : p.autocomplete === 'photon' ? photon : unknown('autocomplete', p.autocomplete);

  const openMeteo = () => new OpenMeteoProvider(e.openMeteo, cfg.weather.batchSize, cfg.weather.requestTimeoutMs, cfg.weather.openMeteoUpdateModels);
  // The public Open-Meteo API only where our forecast isn't there, while VITE_WEATHER_FALLBACK allows it (DP-6.6).
  const weatherFallback =
    p.weatherFallback === 'open-meteo' ? openMeteo() : p.weatherFallback === 'none' ? null : unknown('weather fallback', p.weatherFallback);
  const weatherProvider: WeatherProvider =
    p.weather === 'api'
      ? new ApiWeatherProvider(e.weather, weatherFallback, cfg.weather.batchSize, cfg.weather.requestTimeoutMs)
      : p.weather === 'open-meteo'
        ? openMeteo()
        : unknown('weather', p.weather);

  // Overpass only outside the region our tiles cover, while VITE_PLACES_FALLBACK allows it (DP-6.5).
  const fallback = p.placesFallback === 'overpass' ? true : p.placesFallback === 'none' ? false : unknown('places fallback', p.placesFallback);
  const places: PlacesProvider | null =
    p.places === 'tiles'
      ? new TilePlacesProvider(tiles, lang, fallback ? new OverpassPlacesProvider(e.overpass, lang) : null)
      : p.places === 'overpass'
        ? new OverpassPlacesProvider(e.overpass, lang)
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
    p.poi === 'tiles'
      ? new TilePoiProvider(tiles, lang, fallback ? new OverpassPoiProvider(e.overpass, lang) : null)
      : p.poi === 'overpass'
        ? new OverpassPoiProvider(e.overpass, lang)
        : p.poi === 'none'
          ? null
          : unknown('poi', p.poi);
  const speedLimits: SpeedLimitProvider | null =
    p.speedLimits === 'tiles'
      ? new TileSpeedLimitProvider(tiles, fallback ? new OverpassSpeedLimitProvider(e.overpass) : null)
      : p.speedLimits === 'overpass'
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
    reverseGeocoding: p.geocoding === 'api' ? reverser : photon,
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
 * it; a bus ride no speed limits or stops for fuel. null when the mode has no
 * router (public transport switched off).
 */
export function providersForMode(base: Providers, mode: TravelMode): Providers | null {
  if (mode === 'drive') return base;
  const routing = base.routingByMode?.[mode];
  if (!routing) return null;
  if (mode === 'flight') return { ...base, routing, places: null, elevation: null, poi: null, speedLimits: null };
  if (mode === 'transit') return { ...base, routing, poi: null, speedLimits: null };
  return { ...base, routing };
}

export function setProviders(p: Providers | null): void {
  singleton = p;
}
