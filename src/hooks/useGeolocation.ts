import { useEffect } from 'react';
import { useAppStore } from '../state/store';

function describe(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return 'Location unavailable (permission denied)';
  if (err.code === err.TIMEOUT) return 'Location unavailable (timed out)';
  return 'Location unavailable';
}

/**
 * Live GPS while navigating. Positions stay in memory only — no location
 * history is stored or sent anywhere except the routing request on re-route.
 */
export function useGeolocation() {
  const navigating = useAppStore((s) => s.mode === 'navigating');

  useEffect(() => {
    if (!navigating) return;
    if (!('geolocation' in navigator)) {
      useAppStore.getState().handleGeolocationError('Location unavailable on this device');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { longitude, latitude, accuracy, heading, speed } = pos.coords;
        useAppStore.getState().handlePosition({
          coordinate: [longitude, latitude],
          accuracyM: accuracy,
          headingDeg: heading ?? undefined,
          speedMps: speed ?? undefined,
          timestampMs: pos.timestamp,
        });
      },
      (err) => useAppStore.getState().handleGeolocationError(describe(err)),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [navigating]);
}

/** One-shot position (for "Use current location" as the start). */
export function getCurrentPosition(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location unavailable on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(describe(e))),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
