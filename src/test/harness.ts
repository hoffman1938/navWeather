import { normalizeOsrmRoute } from '../services/routing/OSRMProvider';
import { StyleUrlMapProvider } from '../services/map/MapProvider';
import type { Poi, PoiProvider } from '../services/places/PoiProvider';
import { setProviders, type Providers } from '../services/providers';
import type { RouteRequest, RoutingProvider } from '../services/routing/RoutingProvider';
import { NoIncidentProvider } from '../services/traffic/IncidentProvider';
import { NoTrafficProvider } from '../services/traffic/TrafficProvider';
import { WeatherService } from '../services/weather/WeatherService';
import type { Route } from '../types/route';
import { haversineM } from '../utils/distance';
import {
  BATUMI,
  FakeRecognition,
  FakeTTS,
  FakeWeatherProvider,
  rawTbilisiBatumi,
  TBILISI,
  tbilisiBatumiPlaces,
  tbilisiBatumiRoute,
} from './helpers';

export interface Harness {
  weather: FakeWeatherProvider;
  routingCalls: RouteRequest[];
  /**
   * Other roads the fake router returns after the best one, for requests
   * that start in Tbilisi and ask for alternatives (empty by default).
   */
  alternativeRoads: Route[];
  /** Other roads the fake router offers from a re-route origin (when alternatives are asked for). */
  rerouteAlternatives: ((req: RouteRequest) => Route[]) | null;
  tts: FakeTTS;
  recognition: FakeRecognition;
  poi: { calls: number; results: Poi[] };
  providers: Providers;
}

/** Deterministic providers for store-level (end-to-end) tests. */
export function installFakeProviders(baseMs: number): Harness {
  const weather = new FakeWeatherProvider(baseMs);
  const routingCalls: RouteRequest[] = [];
  const alternativeRoads: Route[] = [];
  const tts = new FakeTTS();
  const recognition = new FakeRecognition();
  const poiState = { calls: 0, results: [] as Poi[] };

  const routing: RoutingProvider = {
    name: 'fake-osrm',
    capabilities: { alternatives: false, avoid: [], laneGuidance: true, matrix: true, multiStop: true },
    async calculateRoutes(req) {
      routingCalls.push(req);
      if (req.origin.id === TBILISI.id) return [tbilisiBatumiRoute(), ...(req.alternatives ? alternativeRoads : [])];
      // Re-route: remainder of the fixture from the vertex closest to the origin.
      const raw = rawTbilisiBatumi();
      const coords = raw.geometry.coordinates;
      let k = 0;
      coords.forEach((c, i) => {
        if (haversineM(c, req.origin.coordinate) < haversineM(coords[k], req.origin.coordinate)) k = i;
      });
      const leg = raw.legs[0];
      const ann = leg.annotation!;
      const durs = ann.duration!.slice(k);
      const dists = ann.distance!.slice(k);
      const sliced = {
        distance: dists.reduce((a, b) => a + b, 0),
        duration: durs.reduce((a, b) => a + b, 0),
        geometry: { coordinates: [req.origin.coordinate, ...coords.slice(k + 1)] },
        legs: [
          {
            ...leg,
            distance: dists.reduce((a, b) => a + b, 0),
            duration: durs.reduce((a, b) => a + b, 0),
            steps: [],
            annotation: { duration: durs, distance: dists },
          },
        ],
      };
      return [normalizeOsrmRoute(sliced, req), ...(req.alternatives && harness.rerouteAlternatives ? harness.rerouteAlternatives(req) : [])];
    },
    // Detour: straight-line distance at 15 m/s (deterministic).
    async travelMatrix(sources, destinations) {
      const d = sources.map((a) => destinations.map((b) => haversineM(a, b)));
      return { durations: d.map((r) => r.map((x) => x / 15)), distances: d };
    },
  };

  const poi: PoiProvider = {
    name: 'fake-poi',
    async search() {
      poiState.calls++;
      return poiState.results;
    },
    async searchNear() {
      poiState.calls++;
      return poiState.results;
    },
  };

  const providers: Providers = {
    routing,
    geocoding: {
      name: 'fake-geo',
      async geocode(q) {
        if (/batumi/i.test(q)) return BATUMI;
        if (/tbilisi/i.test(q)) return TBILISI;
        if (/kutaisi/i.test(q)) return { id: 'kut', name: 'Kutaisi', label: 'Kutaisi', coordinate: [42.7054, 42.2716] };
        return null;
      },
      async reverse() {
        return null;
      },
    },
    autocomplete: { name: 'fake-ac', suggest: async () => [] },
    reverseGeocoding: { name: 'fake-rev', geocode: async () => null, reverse: async () => null },
    places: { name: 'fake-places', getPlacesNearRoute: async () => tbilisiBatumiPlaces() },
    poi,
    speedLimits: null,
    elevation: null,
    traffic: new NoTrafficProvider(),
    incidents: new NoIncidentProvider(),
    air: null,
    map: new StyleUrlMapProvider('test', 'light', 'dark'),
    weather: new WeatherService(weather, {
      ttlMs: 20 * 60000,
      batchSize: 50,
      resolutionDeg: 0.02,
      maxEntries: 500,
      minForecastHours: 48,
    }),
    tts,
    speechRecognition: recognition,
  };
  setProviders(providers);
  const harness: Harness = { weather, routingCalls, alternativeRoads, rerouteAlternatives: null, tts, recognition, poi: poiState, providers };
  return harness;
}
