import { create } from 'zustand';
import { detectLocale, getMessages, isLocaleLoaded, loadLocale, LOCALES, type Locale, type Messages } from '../i18n';
import { defaultUnits, type UnitPrefs } from '../i18n/format';
import type { AlertOutput, AlertTiming } from '../intelligence/driverAlerts';
import type { WeatherAlertPrefs } from '../intelligence/weatherAlerts';

export interface Settings {
  language: Locale;
  units: UnitPrefs;
  theme: 'auto' | 'light' | 'dark';
  /** Spoken turn-by-turn and alerts. */
  voice: boolean;
  /** Which Google voice speaks each language: 'auto' (the best one) or 'device:<voiceURI>'. */
  voiceByLang: Partial<Record<Locale, string>>;
  alertOutput: AlertOutput;
  alertTiming: AlertTiming;
  weatherAlerts: WeatherAlertPrefs;
  speedWarnings: boolean;
  breakReminders: boolean;
  /** Mapped speed cameras (off by default: not legal everywhere). */
  speedCameras: boolean;
  /** Voice + sign before sharp curves (route geometry) and railway crossings (OSM). */
  roadHazards: boolean;
  /** Other drivers' (unconfirmed) reports on the route, "still there?" prompts, and the Report button. */
  driverReports: boolean;
  batterySaver: boolean;
  /** Declared by the user; decides fuel vs charging stop advice. */
  vehicle: 'fuel' | 'ev';
  /** User-entered remaining range (km). Nothing is ever estimated for them. */
  fuelRangeKm: number | null;
}

const KEY = 'navweather.settings.v1';

export function defaultSettings(): Settings {
  return {
    language: detectLocale(),
    units: defaultUnits(),
    theme: 'auto',
    voice: true,
    voiceByLang: {},
    alertOutput: 'both',
    alertTiming: 'auto',
    weatherAlerts: { level: 'all', types: { rain: true, snow: true, fog: true, wind: true, temperature: true } },
    speedWarnings: true,
    breakReminders: true,
    speedCameras: false,
    roadHazards: true,
    driverReports: true,
    batterySaver: false,
    vehicle: 'fuel',
    fuelRangeKm: null,
  };
}

/** A stored value if it is one of `allowed`, else the default (old or hand-edited storage). */
function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function voiceChoices(value: unknown): Partial<Record<Locale, string>> {
  const out: Partial<Record<Locale, string>> = {};
  if (!value || typeof value !== 'object') return out;
  for (const l of LOCALES) {
    const v = (value as Record<string, unknown>)[l.id];
    if (typeof v === 'string' && (v === 'auto' || /^device:.{1,300}$/.test(v))) out[l.id] = v;
  }
  return out;
}

/** Preferences only — no routes, places or positions are ever persisted. */
export function parseSettings(raw: string | null, base = defaultSettings()): Settings {
  if (!raw) return base;
  try {
    const s = JSON.parse(raw) as Record<string, unknown> | null;
    if (!s || typeof s !== 'object') return base;
    const units = (s.units ?? {}) as Partial<UnitPrefs>;
    const wa = (s.weatherAlerts ?? {}) as Partial<WeatherAlertPrefs>;
    const types = (wa.types ?? {}) as Partial<WeatherAlertPrefs['types']>;
    const range = s.fuelRangeKm;
    return {
      language: oneOf(s.language, LOCALES.map((l) => l.id), base.language),
      units: {
        distance: oneOf(units.distance, ['metric', 'imperial'] as const, base.units.distance),
        temperature: oneOf(units.temperature, ['c', 'f'] as const, base.units.temperature),
        wind: oneOf(units.wind, ['kmh', 'mph', 'ms'] as const, base.units.wind),
      },
      theme: oneOf(s.theme, ['auto', 'light', 'dark'] as const, base.theme),
      voice: bool(s.voice, base.voice),
      voiceByLang: voiceChoices(s.voiceByLang),
      alertOutput: oneOf(s.alertOutput, ['both', 'visual', 'voice', 'off'] as const, base.alertOutput),
      alertTiming: oneOf(s.alertTiming, ['auto', 'early', 'standard', 'minimal'] as const, base.alertTiming),
      weatherAlerts: {
        level: oneOf(wa.level, ['all', 'severe'] as const, base.weatherAlerts.level),
        types: {
          rain: bool(types.rain, true),
          snow: bool(types.snow, true),
          fog: bool(types.fog, true),
          wind: bool(types.wind, true),
          temperature: bool(types.temperature, true),
        },
      },
      speedWarnings: bool(s.speedWarnings, base.speedWarnings),
      breakReminders: bool(s.breakReminders, base.breakReminders),
      speedCameras: bool(s.speedCameras, base.speedCameras),
      roadHazards: bool(s.roadHazards, base.roadHazards),
      driverReports: bool(s.driverReports, base.driverReports),
      batterySaver: bool(s.batterySaver, base.batterySaver),
      vehicle: s.vehicle === 'ev' ? 'ev' : 'fuel',
      fuelRangeKm: typeof range === 'number' && Number.isFinite(range) && range > 0 && range <= 5000 ? range : null,
    };
  } catch {
    return base;
  }
}

function load(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return defaultSettings(); // storage blocked
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode / blocked storage: settings just won't persist */
  }
}

interface SettingsStore extends Settings {
  update(patch: Partial<Settings>): void;
  reset(): void;
}

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...load(),
  update(patch) {
    // Switch language only once its text has loaded (it arrives as a separate file).
    if (patch.language && !isLocaleLoaded(patch.language)) {
      const { language, ...rest } = patch;
      if (Object.keys(rest).length) get().update(rest);
      loadLocale(language).then(
        () => get().update({ language }),
        () => undefined, // offline and not cached: keep the current language
      );
      return;
    }
    set(patch);
    const { update: _u, reset: _r, ...rest } = get();
    save(rest);
  },
  reset() {
    const d = defaultSettings();
    set(d);
    save(d);
  },
}));

export function settingsSnapshot(): Settings {
  const { update: _u, reset: _r, ...rest } = useSettings.getState();
  return rest;
}

export function useMessages(): Messages {
  return getMessages(useSettings((s) => s.language));
}

/** Load the saved language's text before first render (English is built in). */
export function loadInitialLocale(): Promise<void> {
  return loadLocale(useSettings.getState().language).catch(() => undefined);
}

export function currentMessages(): Messages {
  return getMessages(useSettings.getState().language);
}
