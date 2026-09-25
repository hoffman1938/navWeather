import { lazy, Suspense, useEffect, useRef } from 'react';
import { AlertBanner } from './components/Drive/AlertBanner';
import { DriveSheet } from './components/Drive/DriveSheet';
import { ManeuverBanner } from './components/Drive/ManeuverBanner';
import { SpeedSign } from './components/Drive/SpeedSign';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { LocationPrimer, NavPrompt, Notice } from './components/Notice/Notice';
import { PlanSheet } from './components/Plan/PlanSheet';
import { SearchPanel } from './components/Search/SearchPanel';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { VoiceControls } from './components/Voice/VoiceControls';
import { useAppTimers } from './hooks/useAppTimers';
import { useApplyTheme } from './hooks/useEffectiveTheme';
import { useElementSize } from './hooks/useElementSize';
import { useGeolocation } from './hooks/useGeolocation';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useSimulationLoop } from './hooks/useSimulationLoop';
import { useLayoutStore } from './state/layout';
import { useMessages } from './state/settings';
import { useAppStore } from './state/store';
import './components/Drive/Drive.css';
import './App.css';

// MapLibre is the heaviest dependency — load it after the shell paints.
const RouteMap = lazy(() => import('./components/Map/RouteMap'));

export default function App() {
  useAppTimers();
  useGeolocation();
  useSimulationLoop();
  useNetworkStatus();
  useApplyTheme();
  useDisplayPointNaming();
  useInsetVars();
  const driving = useAppStore((s) => s.mode !== 'planning');
  const m = useMessages();

  return (
    <div className="app">
      <ErrorBoundary fallback={<div className="map-placeholder map-placeholder--error">{m.ui.mapUnavailable}</div>}>
        <Suspense fallback={<div className="map-placeholder" aria-hidden="true" />}>
          <RouteMap />
        </Suspense>
      </ErrorBoundary>
      {driving ? <DriveTop /> : <SearchPanel />}
      {driving ? <SpeedSign /> : null}
      <VoiceControls />
      <Notice />
      {driving ? <DriveSheet /> : <PlanSheet />}
      <SettingsDialog />
      <LocationPrimer />
      <NavPrompt />
    </div>
  );
}

function DriveTop() {
  const ref = useRef<HTMLDivElement>(null);
  const setInsets = useLayoutStore((s) => s.setInsets);
  useElementSize(ref, (r) => setInsets({ top: Math.round(r.bottom) }));
  return (
    <div className="drive-top" ref={ref}>
      <ManeuverBanner />
      <AlertBanner />
    </div>
  );
}

/** Expose overlay insets to CSS (floating controls sit just above the sheet). */
function useInsetVars() {
  const insets = useLayoutStore((s) => s.insets);
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty('--inset-bottom', `${insets.bottom}px`);
    st.setProperty('--inset-top', `${insets.top}px`);
  }, [insets.bottom, insets.top]);
}

/** Name the few visible points that have no settlement nearby (lazy reverse geocoding). */
function useDisplayPointNaming() {
  // Keyed by ids so fast re-derives (simulation) don't starve the debounce.
  const key = useAppStore((s) => s.derived.displayPoints.filter((p) => !p.placeName).map((p) => p.id).join('|'));
  useEffect(() => {
    if (!key) return;
    const t = window.setTimeout(() => void useAppStore.getState().nameDisplayPoints(), 400);
    return () => window.clearTimeout(t);
  }, [key]);
}
