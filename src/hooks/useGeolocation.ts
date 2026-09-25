import { useEffect } from 'react';
import { currentMessages } from '../state/settings';
import { useAppStore } from '../state/store';

function describe(_err: GeolocationPositionError): string {
  return currentMessages().ui.locationUnavailable;
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
      useAppStore.getState().handleGeolocationError(currentMessages().ui.locationUnavailable);
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
      reject(new Error(currentMessages().ui.locationUnavailable));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(describe(e))),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
