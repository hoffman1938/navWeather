import { create } from 'zustand';
import { detectLocale, getMessages, isLocaleLoaded, loadLocale, type Locale, type Messages } from '../i18n';
import { defaultUnits, type UnitPrefs } from '../i18n/format';
import type { AlertOutput, AlertTiming } from '../intelligence/driverAlerts';
import type { WeatherAlertPrefs } from '../intelligence/weatherAlerts';

export interface Settings {
  language: Locale;
  units: UnitPrefs;
  theme: 'auto' | 'light' | 'dark';
  /** Spoken turn-by-turn and alerts. */
  voice: boolean;
  alertOutput: AlertOutput;
  alertTiming: AlertTiming;
  weatherAlerts: WeatherAlertPrefs;
  speedWarnings: boolean;
  breakReminders: boolean;
  /** Mapped speed cameras (off by default: not legal everywhere). */
  speedCameras: boolean;
  /** Voice + sign before sharp curves (route geometry) and railway crossings (OSM). */
  roadHazards: boolean;
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
    alertOutput: 'both',
    alertTiming: 'auto',
    weatherAlerts: { level: 'all', types: { rain: true, snow: true, fog: true, wind: true, temperature: true } },
    speedWarnings: true,
    breakReminders: true,
    speedCameras: false,
    roadHazards: true,
    batterySaver: false,
    vehicle: 'fuel',
    fuelRangeKm: null,
  };
}

/** Preferences only — no routes, places or positions are ever persisted. */
function load(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...s,
      vehicle: s.vehicle === 'ev' ? 'ev' : 'fuel',
      units: { ...base.units, ...s.units },
      weatherAlerts: {
        ...base.weatherAlerts,
        ...s.weatherAlerts,
        types: { ...base.weatherAlerts.types, ...s.weatherAlerts?.types },
      },
    };
  } catch {
    return base;
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
