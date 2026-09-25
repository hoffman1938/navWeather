import { useLayoutEffect } from 'react';
import { useAppStore, type AppState } from '../state/store';
import { isDaylight } from '../utils/sun';
import { useDarkMode } from './useMediaQuery';

export type Theme = 'light' | 'dark';

/**
 * Planning follows the system theme. While driving (or simulating), the UI
 * switches to day/night by the sun at the vehicle's position and time — like
 * a car navigation system.
 */
export function useEffectiveTheme(): { theme: Theme; auto: boolean } {
  const systemDark = useDarkMode();
  const auto = useAppStore(autoThemeFor);
  if (auto === null) return { theme: systemDark ? 'dark' : 'light', auto: false };
  return { theme: auto, auto: true };
}

/** Day/night at the vehicle's position and (real or simulated) time; null while planning. */
export function autoThemeFor(
  s: Pick<AppState, 'mode' | 'vehicle' | 'sim'>,
  now: () => number = Date.now,
): Theme | null {
  if (s.mode === 'planning' || !s.vehicle) return null;
  const t = s.mode === 'simulating' ? s.sim.nowMs : now();
  return isDaylight(s.vehicle.coordinate[1], s.vehicle.coordinate[0], t) ? 'light' : 'dark';
}

/** Apply the automatic theme to the document (removed again when planning). */
export function useApplyTheme() {
  const { theme, auto } = useEffectiveTheme();
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (auto) root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme, auto]);
}
