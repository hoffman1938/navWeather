import { useEffect } from 'react';

/**
 * Keep the screen on while it matters (navigating, sharing live location):
 * browsers stop location updates when the screen locks. Re-acquired when the
 * page becomes visible again (the system drops the lock when hidden).
 * Silently does nothing where the Screen Wake Lock API is unavailable.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) void l.release().catch(() => undefined);
        else lock = l;
      } catch {
        /* battery saver / not allowed: the screen may lock */
      }
    };
    const onVisible = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
