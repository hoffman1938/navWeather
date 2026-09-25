import { useEffect } from 'react';
import { useAppStore } from '../state/store';

/** Online/offline → store (navigation keeps working offline with cached data). */
export function useNetworkStatus() {
  useEffect(() => {
    const update = () => useAppStore.getState().setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
}
