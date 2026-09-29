import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { loadInitialLocale } from './state/settings';
import './styles/tokens.css';
import './styles/base.css';

// The saved language's text (if not English) loads first, so the UI never flashes English.
void loadInitialLocale().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// Offline app shell (production only; dev uses Vite's module server).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// A stale tab after a redeploy may request chunks that no longer exist.
window.addEventListener('vite:preloadError', () => {
  try {
    if (!sessionStorage.getItem('navweather.reloaded')) {
      sessionStorage.setItem('navweather.reloaded', '1');
      location.reload();
    }
  } catch {
    /* ignore */
  }
});

// Dev only: expose stores for debugging in the console / automated checks.
if (import.meta.env.DEV) {
  void Promise.all([import('./state/explore'), import('./state/store'), import('./share/liveShare'), import('./share/viewer'), import('./state/savedPlaces')]).then(
    ([e, s, l, v, p]) => {
      Object.assign(window, { __navweather: { explore: e.useExplore, app: s.useAppStore, liveShare: l.useLiveShare, viewer: v.useViewer, places: p.useSavedPlaces } });
    },
  );
}
