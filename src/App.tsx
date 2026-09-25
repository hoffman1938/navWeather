import { lazy, Suspense, useEffect } from 'react';
import { RouteSheet } from './components/BottomSheet/RouteSheet';
import { NavPrompt, Notice } from './components/Notice/Notice';
import { SearchPanel } from './components/Search/SearchPanel';
import { useAppTimers } from './hooks/useAppTimers';
import { useApplyTheme } from './hooks/useEffectiveTheme';
import { useGeolocation } from './hooks/useGeolocation';
import { useSimulationLoop } from './hooks/useSimulationLoop';
import { useAppStore } from './state/store';
import './App.css';

// MapLibre is the heaviest dependency — load it after the shell paints.
const RouteMap = lazy(() => import('./components/Map/RouteMap'));

export default function App() {
  useAppTimers();
  useApplyTheme();
  useGeolocation();
  useSimulationLoop();
  useDisplayPointNaming();

  return (
    <div className="app">
      <Suspense fallback={<div className="map-placeholder" aria-hidden="true" />}>
        <RouteMap />
      </Suspense>
      <SearchPanel />
      <Notice />
      <RouteSheet />
      <NavPrompt />
    </div>
  );
}

/** Name the few visible points that have no settlement nearby (lazy reverse geocoding). */
function useDisplayPointNaming() {
  const displayPoints = useAppStore((s) => s.derived.displayPoints);
  useEffect(() => {
    if (!displayPoints.some((p) => !p.placeName)) return;
    const t = window.setTimeout(() => void useAppStore.getState().nameDisplayPoints(), 400);
    return () => window.clearTimeout(t);
  }, [displayPoints]);
}
