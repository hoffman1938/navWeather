/**
 * Long Trip Mode — domain types (docs/features/LONG_TRIP_MODE.md).
 *
 * Shared by the client and the Worker (POST /api/v1/trips/plan). Pure data:
 * no DOM, no Workers-only APIs. All times are UTC epoch ms; along-route
 * positions are metres from the route start; drive times are seconds of
 * driving (without stops).
 */

export type TripCategory = 'SHORT' | 'MEDIUM' | 'EXTENDED' | 'LONG';

/** Why Long Trip Mode switched itself on. */
export type LongTripReason = 'distance' | 'driving-time' | 'overnight' | 'rest-stops';

export interface TripClassification {
  category: TripCategory;
  distanceKm: number;
  drivingTimeMinutes: number;
  /** Driving + planned rests, meals, fuel and overnight stays. */
  estimatedTotalTimeMinutes: number;
  requiresOvernight: boolean;
  /** null = not determined (border data is not available yet). */
  requiresBorderCrossing: boolean | null;
  recommendedRestStops: number;
  /** Time-zone changes along the route (from the forecast points). */
  timeZoneChanges: number;
  /** Long Trip Mode on by itself (the user can still override). */
  longTripMode: boolean;
  reasons: LongTripReason[];
}

export type VehicleKind = 'car' | 'van' | 'truck' | 'motorcycle';
export type Powertrain = 'fuel' | 'ev';

/** What the user declared — nothing is estimated for them. */
export interface VehicleProfile {
  kind: VehicleKind;
  powertrain: Powertrain;
  /** Remaining range now (km), if entered. */
  rangeKm?: number;
  /** Range on a full tank / battery (km), if entered (or computed from tank and consumption). */
  fullRangeKm?: number;
}

export type TripPace = 'relaxed' | 'balanced' | 'fast';
export type FoodPreference = 'any' | 'restaurant' | 'fast_food' | 'cafe';

export interface TripPreferences {
  pace: TripPace;
  /** 0 = any accommodation; 3/4 = at least that star class where OSM lists stars. */
  hotelMinStars: 0 | 3 | 4;
  /** Straight-line distance from the route a hotel may be (km). */
  hotelMaxDetourKm: number;
  food: FoodPreference;
  /** Preferred fuel brand (free text, matched case-insensitively), or null. */
  fuelBrand: string | null;
}

export type StopKind = 'rest' | 'meal' | 'fuel' | 'charge' | 'overnight';

/** A settlement along the route (from the client's OpenStreetMap places). */
export interface TripPlaceRef {
  name: string;
  kind: 'city' | 'town' | 'village';
  population?: number;
  alongM: number;
  lat: number;
  lon: number;
}

/**
 * Hourly hazard codes at one route sample, from the client's forecasts:
 * 0 none · 1 rain · 2 heavy rain · 3 snow · 4 thunderstorm · 5 fog · 6 strong wind · 7 freezing with precipitation
 * −1 = no forecast for that hour.
 */
export interface TripWeatherSample {
  alongM: number;
  /** IANA time zone at the sample. */
  tz: string;
  /** First hour (UTC ms, on the hour). */
  t0: number;
  h: number[];
}

/** Where the trip stands now (for replanning while driving). */
export interface TripProgressState {
  /** Along-route position of the car (m) and the time it was there. */
  alongM: number;
  nowMs: number;
  /** Driving since the last overnight stay / since the last break (s). */
  drivenTodayS: number;
  sinceRestS: number;
  /** Remaining range now (km), if known. */
  rangeKm?: number;
}

export interface TripPlanRequest {
  version: 1;
  route: {
    id: string;
    /** Encoded polyline (precision 5): a point every `stepM` metres along the road, and the end. */
    polyline: string;
    stepM: number;
    /** Cumulative driving time (s) at each polyline point. */
    timesS: number[];
    distanceM: number;
    /** IANA time zone at the start (fallback when there are no forecast points). */
    tz?: string;
    origin: { name: string; lat: number; lon: number };
    destination: { name: string; lat: number; lon: number };
  };
  departAtMs: number;
  vehicle: VehicleProfile;
  preferences: TripPreferences;
  places?: TripPlaceRef[];
  weather?: TripWeatherSample[];
  progress?: TripProgressState;
  /** Look up places (hotels, fuel, food, rest areas) around the stops (default true where a source exists). */
  includePlaces?: boolean;
  /** Overnight stays the user chose ("Stay in X instead"), along-route positions. */
  overnightsM?: number[];
  /** UI language for place names (en | ru). */
  locale?: string;
}

/** Why a place was recommended (rendered by the client in its language). */
export type ReasonCode =
  | { code: 'near-route'; km: number }
  | { code: 'stars'; n: number }
  | { code: 'parking' }
  | { code: 'truck-parking' }
  | { code: 'open-at'; time: string }
  | { code: 'open-24-7' }
  | { code: 'hours-unknown' }
  | { code: 'brand'; brand: string }
  | { code: 'fast-charger'; kw: number }
  | { code: 'toilets' }
  | { code: 'motorway-services' };

export type PlaceCategory = 'hotel' | 'fuel' | 'charging' | 'food' | 'rest';

export interface RecommendedPlace {
  id: string;
  category: PlaceCategory;
  name: string;
  /** OSM type detail: hotel/motel/guest_house/hostel, restaurant/fast_food/cafe, rest_area/services… */
  type: string;
  lat: number;
  lon: number;
  /** Straight-line distance from the route (km). Not a driving detour. */
  distanceFromRouteKm: number;
  stars?: number;
  brand?: string;
  /** At the planned arrival time, from OSM opening_hours. */
  openStatus?: 'open' | 'closed' | 'unknown';
  maxKw?: number;
  reasons: ReasonCode[];
}

export interface StopPlaces {
  category: PlaceCategory;
  status: 'ok' | 'none-found' | 'unavailable' | 'skipped';
  places: RecommendedPlace[];
}

export interface TripStop {
  id: string;
  kinds: StopKind[];
  alongM: number;
  lat: number;
  lon: number;
  /** Nearest settlement name (if any within a few km). */
  placeName?: string;
  /** Driving time from the trip start to here (s). */
  driveTimeS: number;
  arriveMs: number;
  departMs: number;
  dwellMinutes: number;
  /** IANA time zone at the stop (for local times). */
  tz: string;
  /** 0-based travel day. */
  day: number;
  /** Why the stop is here (configured interval, meal window, range, daily driving, latest arrival, weather). */
  why: ('interval' | 'meal-window' | 'range' | 'daily-limit' | 'latest-arrival' | 'weather')[];
  places: StopPlaces[];
}

export interface TripSegment {
  day: number;
  fromM: number;
  toM: number;
  departMs: number;
  arriveMs: number;
  distanceKm: number;
  drivingMinutes: number;
}

export interface TripDay {
  index: number;
  fromName: string;
  toName: string;
  startMs: number;
  endMs: number;
  distanceKm: number;
  drivingMinutes: number;
  stopIds: string[];
}

export type HazardKind = 'rain' | 'heavy-rain' | 'snow' | 'storm' | 'fog' | 'wind' | 'freezing';

export interface WeatherRisk {
  kind: HazardKind;
  severity: 'medium' | 'high';
  fromM: number;
  toM: number;
  /** Planned (stop-aware) times when the stretch is driven. */
  startMs: number;
  endMs: number;
  placeName?: string;
  tz: string;
}

export interface AccommodationRecommendation {
  stopId: string;
  areaName?: string;
  arriveMs: number;
  departMs: number;
  nights: number;
  tz: string;
  hotels: RecommendedPlace[];
  /** Always 'not-checked': OSM has no live availability. Never claim "available tonight". */
  availability: 'not-checked';
  status: StopPlaces['status'];
  /** Other towns that would work for this night (the user can choose one). */
  alternatives: { alongM: number; name: string; kind?: TripPlaceRef['kind']; arriveMs: number }[];
}

/** POST /api/v1/trips/places — places around one stop, loaded when the user opens it. */
export interface StopPlacesRequest {
  version: 1;
  stop: { lat: number; lon: number; kinds: StopKind[]; arriveMs: number; tz: string };
  /** The road around the stop (encoded polyline, precision 5, ≤ ~60 km). */
  route: string;
  vehicle: VehicleProfile;
  preferences: TripPreferences;
  locale?: string;
}

export interface StopPlacesResponse {
  places: StopPlaces[];
}

export type TripAdvice =
  | {
      kind: 'stop-earlier';
      /** The weather that motivates it. */
      risk: WeatherRisk;
      /** The suggested earlier overnight area. */
      alongM: number;
      areaName?: string;
      arriveMs: number;
      tz: string;
    }
  | { kind: 'enter-range' }
  | { kind: 'no-places'; category: PlaceCategory; stopId: string };

export type TimelineKind = 'depart' | 'fuel' | 'charge' | 'rest' | 'meal' | 'weather' | 'overnight' | 'continue' | 'arrive';

export interface TimelineEntry {
  atMs: number;
  tz: string;
  kind: TimelineKind;
  day: number;
  alongM: number;
  stopId?: string;
  placeName?: string;
  dwellMinutes?: number;
  hazard?: HazardKind;
}

export interface TripPlan {
  version: 1;
  routeId: string;
  createdAtMs: number;
  classification: TripClassification;
  origin: { name: string; lat: number; lon: number };
  destination: { name: string; lat: number; lon: number };
  departAtMs: number;
  arriveAtMs: number;
  totalDistanceKm: number;
  estimatedDrivingTimeMinutes: number;
  estimatedTotalTimeMinutes: number;
  segments: TripSegment[];
  days: TripDay[];
  recommendedStops: TripStop[];
  accommodation: AccommodationRecommendation[];
  weatherRisks: WeatherRisk[];
  advice: TripAdvice[];
  timeline: TimelineEntry[];
  summary: {
    overnights: number;
    fuelStops: number;
    restStops: number;
    mealStops: number;
    weatherRisks: number;
    /** null = not determined. */
    borderCrossings: number | null;
  };
  dataStatus: {
    places: 'ok' | 'partial' | 'unavailable' | 'skipped';
    weather: 'ok' | 'missing';
  };
  /** Echo of the replanning state, when the plan was made from the car's position. */
  progress?: TripProgressState;
}
