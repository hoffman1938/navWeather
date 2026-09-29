import { lazy, Suspense, useEffect, useRef } from 'react';
import { AlertBanner } from './components/Drive/AlertBanner';
import { RerouteOffer } from './components/Drive/RerouteOffer';
import { ReportDialog, ReportPrompt } from './components/Drive/Reports';
import { ArrivalSheet } from './components/Drive/ArrivalSheet';
import { DriveSheet } from './components/Drive/DriveSheet';
import { ManeuverBanner } from './components/Drive/ManeuverBanner';
import { HazardSign } from './components/Drive/HazardSign';
import { SpeedSign } from './components/Drive/SpeedSign';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { MapWeatherChip } from './components/Explore/MapWeatherChip';
import { NearbySheet } from './components/Explore/Nearby';
import { PlaceSheet } from './components/Explore/PlaceSheet';
import { LiveView } from './components/Live/LiveView';
import { LocateButton } from './components/Map/LocateButton';
import { LayerTimeline } from './components/Map/WeatherLayerControls';
import { LiveShareDialog, SharePlaceDialog, ShareStatus } from './components/Share/Share';
import { LocationPrimer, NavPrompt, Notice } from './components/Notice/Notice';
import { PlanSheet } from './components/Plan/PlanSheet';
import { SearchPanel } from './components/Search/SearchPanel';
import { SettingsDialog } from './components/Settings/SettingsDialog';
import { VoiceControls } from './components/Voice/VoiceControls';
import { useAppTimers } from './hooks/useAppTimers';
import { useApplyTheme } from './hooks/useEffectiveTheme';
import { useElementSize } from './hooks/useElementSize';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useSimulationLoop } from './hooks/useSimulationLoop';
import { useWakeLock } from './hooks/useWakeLock';
import { parseLiveUrl, parsePlaceUrl } from './share/links';
import { resumeLiveShare, useLiveShare } from './share/liveShare';
import { useViewer } from './share/viewer';
import { locationWatcher, useExplore } from './state/explore';
import { useLayoutStore } from './state/layout';
import { useMessages } from './state/settings';
import { useAppStore } from './state/store';
import './components/Drive/Drive.css';
import './App.css';

// MapLibre is the heaviest dependency — load it after the shell paints.
const RouteMap = lazy(() => import('./components/Map/RouteMap'));
// Development diagnostics; the import is dropped from production builds.
const DevPanel = import.meta.env.DEV ? lazy(() => import('./dev/DevPanel')) : null;

/** Opened from a live-location link? (/live/:id) */
const liveId = typeof location !== 'undefined' ? parseLiveUrl(location.pathname) : null;

export default function App() {
  // Last line of defence: an unexpected error shows a way back instead of a blank page.
  return <ErrorBoundary fallback={<CrashScreen />}>{liveId ? <LiveApp id={liveId} /> : <MainApp />}</ErrorBoundary>;
}

function CrashScreen() {
  const m = useMessages();
  return (
    <div className="crash" role="alert">
      <h1>{m.ui.crashTitle}</h1>
      <p>{m.ui.crashBody}</p>
      <button className="btn btn-primary" onClick={() => location.reload()}>
        {m.ui.reload}
      </button>
    </div>
  );
}

function MainApp() {
  useAppTimers();
  useLocationSync();
  useOnLoad();
  useSimulationLoop();
  useNetworkStatus();
  useApplyTheme();
  useDisplayPointNaming();
  useInsetVars();
  const driving = useAppStore((s) => s.mode !== 'planning');
  const sharing = useLiveShare((s) => s.status === 'active');
  useWakeLock(driving || sharing);
  const hasCard = useExplore((s) => s.card !== null);
  const hasNearby = useExplore((s) => s.nearby !== null);
  const arrived = useAppStore((s) => s.arrival !== null);
  const hasPlan = useAppStore((s) => s.plan !== null);
  const m = useMessages();

  return (
    <div className="app">
      <ErrorBoundary fallback={<div className="map-placeholder map-placeholder--error">{m.ui.mapUnavailable}</div>}>
        <Suspense fallback={<div className="map-placeholder" aria-hidden="true" />}>
          <RouteMap />
        </Suspense>
      </ErrorBoundary>
      {driving && !arrived ? <DriveTop /> : arrived ? null : <SearchPanel />}
      {driving && !arrived ? (
        <div className="drive-signs">
          <HazardSign />
          <SpeedSign />
        </div>
      ) : null}
      <VoiceControls />
      {!driving ? <MapWeatherChip /> : null}
      {!driving && !arrived ? <LayerTimeline /> : null}
      <ShareStatus />
      <Notice />
      {arrived ? <ArrivalSheet /> : driving ? <DriveSheet /> : hasCard ? <PlaceSheet /> : hasNearby && !hasPlan ? <NearbySheet /> : <PlanSheet />}
      <SettingsDialog />
      <LocationPrimer />
      <NavPrompt />
      <SharePlaceDialog />
      <LiveShareDialog />
      <ReportDialog />
      {DevPanel ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </div>
  );
}

/** Someone else's live location (read-only). */
function LiveApp({ id }: { id: string }) {
  useAppTimers();
  useNetworkStatus();
  useApplyTheme();
  useInsetVars();
  useLocationSync();
  const m = useMessages();
  useEffect(() => {
    useViewer.getState().start(id);
    return () => useViewer.getState().stop();
  }, [id]);
  return (
    <div className="app">
      <ErrorBoundary fallback={<div className="map-placeholder map-placeholder--error">{m.ui.mapUnavailable}</div>}>
        <Suspense fallback={<div className="map-placeholder" aria-hidden="true" />}>
          <RouteMap viewer />
        </Suspense>
      </ErrorBoundary>
      <div className="voice">
        <LocateButton />
      </div>
      <Notice />
      <LiveView />
    </div>
  );
}

/**
 * One device-location watcher, shared: "show my location", GPS navigation,
 * and live sharing each hold it while they need it.
 */
function useLocationSync() {
  useEffect(() => {
    const unsubs = [
      useAppStore.subscribe(
        (s) => s.mode === 'navigating',
        (on) => (on ? locationWatcher.acquire('navigate') : locationWatcher.release('navigate')),
        { fireImmediately: true },
      ),
      useExplore.subscribe(
        (s) => s.locate !== 'off',
        (on) => (on ? locationWatcher.acquire('locate') : locationWatcher.release('locate')),
        { fireImmediately: true },
      ),
    ];
    // Sharing needs real GPS unless a simulated drive is what's being shared.
    const syncShare = () => {
      const want = useLiveShare.getState().status === 'active' && useAppStore.getState().mode !== 'simulating';
      if (want) locationWatcher.acquire('share');
      else locationWatcher.release('share');
    };
    syncShare();
    unsubs.push(useLiveShare.subscribe(syncShare), useAppStore.subscribe((s) => s.mode, syncShare));
    return () => unsubs.forEach((u) => u());
  }, []);
}

/** Shared place links (?p=lat,lon&n=Name) and a live share left running before a reload. */
function useOnLoad() {
  useEffect(() => {
    const place = parsePlaceUrl(location.search);
    if (place) useExplore.getState().selectPlace(place, 'link');
    resumeLiveShare();
  }, []);
}

function DriveTop() {
  const ref = useRef<HTMLDivElement>(null);
  const setInsets = useLayoutStore((s) => s.setInsets);
  useElementSize(ref, (r) => setInsets({ top: Math.round(r.bottom) }));
  return (
    <div className="drive-top" ref={ref}>
      <ManeuverBanner />
      <AlertBanner />
      <RerouteOffer />
      <ReportPrompt />
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
    st.setProperty('--inset-left', `${insets.left}px`);
  }, [insets.bottom, insets.top, insets.left]);
  // Floating map buttons step aside while a sheet covers the map.
  const covers = useLayoutStore((s) => s.sheetCovers);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-sheet-covers', covers);
  }, [covers]);
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
