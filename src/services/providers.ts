import { config, type AppConfig } from '../config';
import type { ElevationProvider } from './elevation/ElevationProvider';
import { OpenMeteoElevationProvider } from './elevation/OpenMeteoElevationProvider';
import type { AutocompleteProvider, GeocodingProvider } from './geocoding/GeocodingProvider';
import { NominatimProvider } from './geocoding/NominatimProvider';
import { PhotonProvider } from './geocoding/PhotonProvider';
import { StyleUrlMapProvider, type MapProvider } from './map/MapProvider';
import { OverpassPlacesProvider } from './places/OverpassPlacesProvider';
import type { PlacesProvider } from './places/PlacesProvider';
import { OSRMProvider } from './routing/OSRMProvider';
import type { RoutingProvider } from './routing/RoutingProvider';
import { NoTrafficProvider, type TrafficProvider } from './traffic/TrafficProvider';
import { OpenMeteoProvider } from './weather/OpenMeteoProvider';
import type { WeatherProvider } from './weather/WeatherProvider';
import { WeatherService } from './weather/WeatherService';

export interface Providers {
  routing: RoutingProvider;
  geocoding: GeocodingProvider;
  autocomplete: AutocompleteProvider;
  /** Lightweight reverse geocoder for naming route points. */
  reverseGeocoding: GeocodingProvider;
  places: PlacesProvider | null;
  elevation: ElevationProvider | null;
  traffic: TrafficProvider;
  map: MapProvider;
  weather: WeatherService;
}

function unknown(kind: string, name: string): never {
  throw new Error(`Unknown ${kind} provider "${name}". Check your VITE_* environment variables.`);
}

/** Build providers from configuration. The only place provider classes are named. */
export function createProviders(cfg: AppConfig = config): Providers {
  const { providers: p, endpoints: e } = cfg;

  const photon = new PhotonProvider(e.photon, cfg.geocoding.language);

  const routing: RoutingProvider =
    p.routing === 'osrm' ? new OSRMProvider(e.osrm) : unknown('routing', p.routing);

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

  return {
    routing,
    geocoding,
    autocomplete,
    reverseGeocoding: photon,
    places,
    elevation,
    traffic: new NoTrafficProvider(),
    map,
    weather: new WeatherService(weatherProvider, {
      ttlMs: cfg.weather.cacheTtlMinutes * 60000,
      batchSize: cfg.weather.batchSize,
      resolutionDeg: cfg.weather.spatialResolutionDeg,
      maxEntries: cfg.weather.maxCacheEntries,
      minForecastHours: cfg.weather.minForecastHours,
      updateCheckMs: cfg.weather.updateCheckMinutes * 60000,
    }),
  };
}

let singleton: Providers | null = null;

/** App-wide providers (lazily created; tests can inject via setProviders). */
export function getProviders(): Providers {
  if (!singleton) singleton = createProviders();
  return singleton;
}

export function setProviders(p: Providers | null): void {
  singleton = p;
}
