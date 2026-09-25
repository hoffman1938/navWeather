import { useAppStore } from '../../state/store';
import { formatDuration } from '../../utils/time';
import { conditionLabel, formatTemp, placeLabel } from '../../ui/weatherText';
import { InfoIcon } from '../Icons/Icons';
import { NavigationStatus } from '../NavigationControls/NavigationStatus';
import { JourneyOverview } from '../RouteSummary/JourneyOverview';
import { RouteSummary } from '../RouteSummary/RouteSummary';
import { TimeScrubber } from '../TimeScrubber/TimeScrubber';
import { WeatherSummary } from '../RouteSummary/WeatherSummary';
import { WeatherDetails } from '../WeatherDetails/WeatherDetails';
import { WeatherTimeline } from '../WeatherTimeline/WeatherTimeline';
import { BottomSheet } from './BottomSheet';
import './RouteSheet.css';

/** Composes the sheet for each app state: intro, loading, planning, driving. */
export function RouteSheet() {
  const hasPlan = useAppStore((s) => s.plan !== null);
  const routeStatus = useAppStore((s) => s.routeStatus);
  const mode = useAppStore((s) => s.mode);
  const sheet = useAppStore((s) => s.sheet);
  const setSheet = (v: typeof sheet) => useAppStore.getState().setSheet(v);

  if (!hasPlan) {
    const busy = routeStatus === 'geocoding' || routeStatus === 'routing' || routeStatus === 'places';
    return (
      <BottomSheet
        state="default"
        onChange={() => undefined}
        label="Route weather"
        header={busy ? <LoadingHeader status={routeStatus} /> : <Intro />}
        body={busy ? <TimelineSkeleton /> : null}
      />
    );
  }

  return (
    <BottomSheet
      state={sheet}
      onChange={setSheet}
      label="Weather along your route"
      header={mode === 'planning' ? <RouteSummary /> : <NavigationStatus />}
      body={<SheetBody />}
      extra={<SheetExtra />}
    />
  );
}

function SheetBody() {
  const hasCards = useAppStore((s) => s.derived.timelineItems.length > 0);
  const hasWeather = useAppStore((s) => s.derived.points.some((p) => p.weather));
  const loading = useAppStore((s) => s.weatherStatus === 'loading');
  return (
    <>
      <WeatherSummary />
      {loading && !hasWeather ? <TimelineSkeleton /> : hasCards ? <WeatherTimeline /> : null}
      <SelectedStrip />
      <p className="eta-note">
        <InfoIcon size={14} />
        <span className="eta-note__long">
          Each card shows the forecast for your estimated arrival time there — not current conditions.
        </span>
        <span className="eta-note__short">Forecast for your estimated arrival — not current weather.</span>
      </p>
    </>
  );
}

/** Compact detail line for the tapped card (full details when expanded). */
function SelectedStrip() {
  const sheet = useAppStore((s) => s.sheet);
  const navigating = useAppStore((s) => s.mode !== 'planning');
  const point = useAppStore((s) =>
    s.selectedPointId === 'current'
      ? s.derived.currentPoint
      : (s.derived.points.find((p) => p.id === s.selectedPointId) ?? null),
  );
  if (!point || sheet === 'expanded') return null;
  const w = point.weather;
  const when =
    point.status === 'current'
      ? 'Now'
      : navigating
        ? `in ${formatDuration(point.estimatedTravelMinutes * 60)} (${point.localTime})`
        : `ETA ${point.localTime}`;
  return (
    <div className="selstrip">
      <p className="selstrip__text">
        <strong>{placeLabel(point)}</strong> · {when}
        {w ? (
          <>
            {' '}
            — {w.description ?? conditionLabel(w)}, {formatTemp(w.temperature)}
            {w.feelsLike !== undefined ? ` (feels ${formatTemp(w.feelsLike)})` : ''}
            {w.windSpeed !== undefined ? `, wind ${w.windSpeed} km/h` : ''}
          </>
        ) : null}
      </p>
      <button className="btn btn-ghost" onClick={() => useAppStore.getState().setSheet('expanded')}>
        Details
      </button>
    </div>
  );
}

function SheetExtra() {
  const navigating = useAppStore((s) => s.mode !== 'planning');
  const point = useAppStore((s) =>
    s.selectedPointId === 'current'
      ? s.derived.currentPoint
      : (s.derived.points.find((p) => p.id === s.selectedPointId) ?? null),
  );
  return (
    <div className="sheet-extra">
      <TimeScrubber />
      {point ? (
        <WeatherDetails
          point={point}
          navigating={navigating}
          onClose={() => useAppStore.getState().select(null, 'timeline')}
        />
      ) : null}
      <JourneyOverview />
      <p className="attribution">
        Forecast based on estimated arrival times — conditions can change. Weather data by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{' '}
        (CC BY 4.0) · Routing by{' '}
        <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">
          OSRM
        </a>{' '}
        · Map data ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>
        . No account, no stored location history.
      </p>
    </div>
  );
}

function Intro() {
  const tryDemo = () => {
    const s = useAppStore.getState();
    s.setOriginText('Tbilisi, Georgia');
    s.setDestinationText('Batumi, Georgia');
    void s.calculateRoute();
  };
  return (
    <div className="intro">
      <h1 className="intro__title">Know the weather before you reach it</h1>
      <p className="intro__text">
        Enter where you're driving. We'll forecast the weather at each point along the road — for the time you'll
        actually be there.
      </p>
      <button className="btn btn-secondary" onClick={tryDemo}>
        Try Tbilisi → Batumi
      </button>
    </div>
  );
}

const LOADING_TEXT: Record<string, string> = {
  geocoding: 'Finding places…',
  routing: 'Calculating route…',
  places: 'Finding towns along your route…',
};

function LoadingHeader({ status }: { status: string }) {
  return (
    <div className="loading-head" role="status">
      <span className="spinner" aria-hidden="true" />
      {LOADING_TEXT[status] ?? 'Loading…'}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
    </div>
  );
}
