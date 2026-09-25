import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

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
