import { useEffect } from 'react';
import { useAppStore } from '../state/store';

/**
 * Low-frequency timers: the planning clock ("leave now" drifts forward) and
 * forecast staleness checks. Never polls the weather API directly — a
 * request only happens when data is older than the refresh interval.
 */
export function useAppTimers() {
  const hasRoute = useAppStore((s) => s.plan !== null);

  useEffect(() => {
    if (!hasRoute) return;
    const clock = window.setInterval(() => useAppStore.getState().tickClock(), 30_000);
    const stale = window.setInterval(() => useAppStore.getState().refreshIfStale(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        useAppStore.getState().tickClock();
        useAppStore.getState().refreshIfStale();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(stale);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasRoute]);
}
