import type { TripCategory, TripPace, TripPreferences } from './types';

export interface TripThresholds {
  MEDIUM_TRIP_DISTANCE_KM: number;
  EXTENDED_TRIP_DISTANCE_KM: number;
  LONG_TRIP_DISTANCE_KM: number;
  LONG_TRIP_TIME_MINUTES: number;
  EXTENDED_TRIP_TIME_MINUTES: number;
  LONG_TRIP_MIN_REST_STOPS: number;
  PLAN_FROM_CATEGORY: TripCategory;
  AUTO_ON_FROM_CATEGORY: TripCategory;
}

/**
 * Long Trip Mode thresholds and presets — the ONLY place they are defined
 * (docs/features/LONG_TRIP_MODE.md §3). Product starting values, not
 * universal rules; change them here, never in components.
 */
export const TRIP_THRESHOLDS: TripThresholds = {
  /** Category bands by distance (km). */
  MEDIUM_TRIP_DISTANCE_KM: 150,
  EXTENDED_TRIP_DISTANCE_KM: 400,
  LONG_TRIP_DISTANCE_KM: 800,
  /** Driving time that makes a trip LONG regardless of distance (min). */
  LONG_TRIP_TIME_MINUTES: 10 * 60,
  /** Driving time that makes a trip at least EXTENDED (min). */
  EXTENDED_TRIP_TIME_MINUTES: 5 * 60,
  /** Long Trip Mode also switches on with this many planned breaks (rest + meal). */
  LONG_TRIP_MIN_REST_STOPS: 3,
  /** Ask the planner for EXTENDED trips too (stops without an overnight). */
  PLAN_FROM_CATEGORY: 'EXTENDED',
  /**
   * Long Trip Mode switches itself on only from this category. A shorter trip (e.g. Tbilisi → Batumi in the
   * evening, past the pace's latest arrival) is offered the mode instead: switching on by itself would move
   * every ETA of a 5-hour drive to the next morning (B-24).
   */
  AUTO_ON_FROM_CATEGORY: 'EXTENDED',
};

/**
 * How the user likes to drive. Preferences, not medical or legal rules:
 * where legal driving/rest limits apply (e.g. commercial drivers), the user
 * must set limits that meet them — jurisdiction rules are not built in yet.
 */
export interface PacePreset {
  /** Drive this long between breaks (s). */
  restEveryS: number;
  /** Length of a break (s). */
  restS: number;
  /** Driving per day before an overnight stay (s). */
  dailyDriveS: number;
  /** Prefer to be at the overnight stop by this local hour. */
  latestArrivalHour: number;
  /** Next day's start, local hour. */
  morningStartHour: number;
  /** Shortest overnight stay (s). */
  minOvernightS: number;
}

export const PACE_PRESETS: Record<TripPace, PacePreset> = {
  relaxed: { restEveryS: 105 * 60, restS: 20 * 60, dailyDriveS: 7 * 3600, latestArrivalHour: 21, morningStartHour: 9, minOvernightS: 10 * 3600 },
  balanced: { restEveryS: 2 * 3600, restS: 15 * 60, dailyDriveS: 9 * 3600, latestArrivalHour: 22, morningStartHour: 8, minOvernightS: 9 * 3600 },
  fast: { restEveryS: 3 * 3600, restS: 10 * 60, dailyDriveS: 11 * 3600, latestArrivalHour: 23, morningStartHour: 7, minOvernightS: 8 * 3600 },
};

/** Stop lengths and windows (local time) used by the schedule. */
export const STOP_DEFAULTS = {
  mealS: 45 * 60,
  fuelS: 10 * 60,
  /** EV charging stop — an estimate; real charging time depends on the car and charger. */
  chargeS: 35 * 60,
  /** Meal windows, local hours [start, end). */
  lunch: [12, 14.5] as [number, number],
  dinner: [18.5, 21] as [number, number],
  /** Don't plan a meal in the first hour of a driving day. */
  minDriveBeforeMealS: 3600,
  /** Plan a refuel when this share of the known range is used. */
  rangeUse: 0.75,
  /** Merge stops that fall within this much driving of each other (s). */
  mergeWindowS: 25 * 60,
  /** Finish the trip today if no more than this much driving is left past the daily limit (s). */
  finishToleranceS: 75 * 60,
  /** Look this much driving before the daily target for a better overnight area (s). */
  overnightSearchBeforeS: 90 * 60,
  overnightSearchAfterS: 20 * 60,
  /** Most overnight stays planned (longer trips: the rest is planned on the way). */
  maxOvernights: 6,
} as const;

/** Search radii around a stop (km) per place category. */
export const PLACE_RADIUS_KM = { fuel: 2, charging: 4, food: 3, rest: 3 } as const;

export const DEFAULT_TRIP_PREFERENCES: TripPreferences = {
  pace: 'balanced',
  hotelMinStars: 0,
  hotelMaxDetourKm: 10,
  food: 'any',
  fuelBrand: null,
};

/** Replanning while driving (client side). */
export const REPLAN = {
  /** Replan when the car is this far behind or ahead of the plan (s). */
  delayThresholdS: 20 * 60,
  /** …but not more often than this (ms). */
  cooldownMs: 10 * 60_000,
  /** Tell the user when the arrival moves by at least this much (s). */
  notifyChangeS: 15 * 60,
} as const;
