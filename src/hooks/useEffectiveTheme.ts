import { useLayoutEffect } from 'react';
import { useSettings } from '../state/settings';
import { useAppStore, type AppState } from '../state/store';
import { isDaylight } from '../utils/sun';
import { useDarkMode } from './useMediaQuery';

export type Theme = 'light' | 'dark';

/**
 * Theme: light or dark as chosen; "auto" is the device's own (always — a dark
 * phone gets a dark map in the car too); "sun" is the device's while planning
 * and day/night at the vehicle while driving, like a car navigation system.
 */
export function resolveTheme(choice: 'auto' | 'light' | 'dark' | 'sun', systemDark: boolean, sun: Theme | null): { theme: Theme; forced: boolean } {
  if (choice === 'light' || choice === 'dark') return { theme: choice, forced: true };
  if (choice === 'sun' && sun !== null) return { theme: sun, forced: true };
  return { theme: systemDark ? 'dark' : 'light', forced: false };
}

export function useEffectiveTheme(): { theme: Theme; forced: boolean } {
  const systemDark = useDarkMode();
  const choice = useSettings((s) => s.theme);
  const sun = useAppStore(autoThemeFor);
  return resolveTheme(choice, systemDark, sun);
}

/** Day/night at the vehicle's position and (real or simulated) time; null while planning. */
export function autoThemeFor(s: Pick<AppState, 'mode' | 'vehicle' | 'sim'>, now: () => number = Date.now): Theme | null {
  if (s.mode === 'planning' || !s.vehicle) return null;
  const t = s.mode === 'simulating' ? s.sim.nowMs : now();
  return isDaylight(s.vehicle.coordinate[1], s.vehicle.coordinate[0], t) ? 'light' : 'dark';
}

/** Apply the theme to the document (and the browser bar colour). */
export function useApplyTheme() {
  const { theme, forced } = useEffectiveTheme();
  const lang = useSettings((s) => s.language);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (forced) root.dataset.theme = theme;
    else delete root.dataset.theme;
    root.lang = lang;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    // light-dark() isn't resolved in custom properties — pick the concrete colour.
    meta.content = theme === 'dark' ? '#0e1013' : '#eceef1';
    void bg;
  }, [theme, forced, lang]);
}
