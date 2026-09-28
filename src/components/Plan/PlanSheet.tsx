import { conditionText, formatAgo, formatDistance, formatDuration, formatSpeed, formatTemp } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { deviceTimeZone, formatLocalDate, formatLocalTime, formatUtcOffset } from '../../utils/timezone';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { EventIcon } from '../Common/EventIcon';
import { NavigateIcon, PlayIcon, RefreshIcon } from '../Icons/Icons';
import { PlacesPanel } from '../Places/PlacesPanel';
import { TimeScrubber } from '../TimeScrubber/TimeScrubber';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import { WeatherStrip } from '../WeatherStrip/WeatherStrip';
import { DataSources } from './DataSources';
import { DepartureChart, DepartureTip } from './DeparturePlanner';
import { DepartureSelector } from './DepartureSelector';
import { RouteOptions } from './RouteOptions';
import './Plan.css';

const LOADING: Record<string, keyof ReturnType<typeof useMessages>['ui']['stage']> = {
  geocoding: 'geocoding',
  routing: 'routing',
  places: 'places',
};

/** Planning: route overview → weather along the way → start. */
export function PlanSheet() {
  const hasPlan = useAppStore((s) => s.plan !== null);
  const routeStatus = useAppStore((s) => s.routeStatus);
  const sheet = useAppStore((s) => s.sheet);
  const m = useMessages();

  if (!hasPlan) {
    const stage = LOADING[routeStatus];
    return (
      <BottomSheet
        state="default"
        onChange={() => undefined}
        label={m.ui.weatherAlongRoute}
        grabber={false}
        header={
          stage ? (
            <p className="plan-status" role="status">
              <span className="spinner" aria-hidden="true" />
              {m.ui.stage[stage]}
            </p>
          ) : (
            <Intro />
          )
        }
      />
    );
  }

  return (
    <BottomSheet
      state={sheet}
      onChange={(v) => useAppStore.getState().setSheet(v)}
      label={m.ui.weatherAlongRoute}
      header={<RouteHeader />}
      body={
        <>
          <RouteOptions />
          <WeatherHeadline />
          <DepartureTip />
          <WeatherStrip />
        </>
      }
      extra={
        <div className="plan-extra">
          <DepartureChart />
          <HeadsUp />
          <PointDetails />
          <TimeScrubber />
          <AlongTheWay />
          <PlacesPanel />
          <DataSources />
          <p className="attribution">{m.ui.attribution}</p>
        </div>
      }
    />
  );
}

function coarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

function Intro() {
  const m = useMessages();
  const tryDemo = () => {
    const s = useAppStore.getState();
    s.setOriginText('Tbilisi, Georgia');
    s.setDestinationText('Batumi, Georgia');
    void s.calculateRoute();
  };
  return (
    <div className="plan-intro">
      <p>{m.ui.tagline}</p>
      <p className="plan-intro__hint">{coarsePointer() ? m.explore.pinHintTouch : m.explore.pinHintMouse}</p>
      <button className="btn btn-quiet" onClick={tryDemo}>
        {m.ui.tryDemo}
      </button>
    </div>
  );
}

function RouteHeader() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const plan = useAppStore((s) => s.plan)!;
  const arrivalMs = useAppStore((s) => s.derived.arrivalMs);
  const destTz = useAppStore((s) => s.derived.points.at(-1)?.timezone ?? deviceTimeZone());
  const { route } = plan.timed;
  return (
    <div className="rhead">
      <div className="rhead__text">
        <h2 className="rhead__title">{route.destination.name}</h2>
        <p className="rhead__meta tabular">
          {formatDistance(plan.timed.totalDistM, units, m)} · ~{formatDuration(plan.timed.totalTimeS, m)}
          {arrivalMs ? ` · ${m.ui.arrive(formatLocalTime(arrivalMs, destTz))}` : ''}
        </p>
        <DepartureSelector />
      </div>
      <div className="rhead__actions">
        <button className="btn btn-primary" onClick={() => void useAppStore.getState().requestNavigation()}>
          <NavigateIcon size={16} />
          {m.ui.start}
        </button>
        <button className="btn btn-quiet" onClick={() => useAppStore.getState().startSimulation()}>
          <PlayIcon size={14} />
          {m.ui.simulate}
        </button>
      </div>
    </div>
  );
}

function WeatherHeadline() {
  const m = useMessages();
  const summary = useAppStore((s) => s.derived.summary);
  const status = useAppStore((s) => s.weatherStatus);
  const error = useAppStore((s) => s.weatherError);
  const updatedAt = useAppStore((s) => s.weatherUpdatedAt);
  const stale = useAppStore((s) => s.weatherStale);
  const online = useAppStore((s) => s.online);
  const simulatedData = useAppStore((s) => s.simulatedData);
  const loading = status === 'loading';
  const noData = !summary || summary.tone === 'unknown';
  const old = updatedAt !== null && Date.now() - updatedAt > 20 * 60000;
  const updated = updatedAt
    ? old || stale
      ? m.ui.updatedAgo(formatAgo(updatedAt, Date.now(), m))
      : m.ui.updated(formatLocalTime(updatedAt, deviceTimeZone()))
    : '';
  const lead = summary?.highlights[0];
  return (
    <section className="whead">
      <div className="whead__row">
        {lead && !noData ? <WeatherIcon condition={summary!.headlineCondition ?? lead.condition} isDay={lead.isDay} size={32} /> : null}
        <div className="whead__text">
          <h3 className="whead__headline">
            {noData ? (loading ? m.ui.stage.weather : (error ?? m.weather.summary.unavailable)) : summary!.headline}
          </h3>
          {!noData && summary?.detail ? (
            <p className="whead__detail">
              {summary.detail}
              {updated ? ` · ${updated}` : ''}
              {!online ? ` · ${m.ui.offline}` : ''}
              {simulatedData ? ` · ${m.ui.simulatedData}` : ''}
            </p>
          ) : null}
        </div>
        <button
          className="icon-btn"
          onClick={() => void useAppStore.getState().loadWeather({ force: true, reason: 'manual' })}
          disabled={loading || !online}
          aria-label={`${m.ui.update}. ${updated}`}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : <RefreshIcon size={18} />}
        </button>
      </div>
      {error && !noData ? <p className="whead__warn">{error}</p> : null}
    </section>
  );
}

function HeadsUp() {
  const m = useMessages();
  const events = useAppStore((s) => s.derived.intelligence.events);
  const notable = events.filter((e) => (e.category === 'weather' && e.severity !== 'low') || e.type === 'TIMEZONE_CHANGE').slice(0, 6);
  if (!notable.length) return null;
  return (
    <section>
      <h3 className="label">{m.ui.headsUp}</h3>
      <ul className="rows">
        {notable.map((e) => (
          <li key={e.id} className={`evrow sev-${e.severity}`}>
            <EventIcon icon={e.icon} isDay={e.isDay} size={26} />
            <span className="evrow__text">
              <span className="evrow__title">{e.title}</span>
              {e.shortMessage ? <span className="evrow__detail">{e.shortMessage}</span> : null}
            </span>
            <span className="evrow__when tabular">+{formatDuration(e.estimatedMinutesFromCurrent * 60, m)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlongTheWay() {
  const m = useMessages();
  const units = useSettings((s) => s.units.temperature);
  const groups = useAppStore((s) => s.derived.groups);
  if (groups.length === 0) return null;
  return (
    <section>
      <h3 className="label">{m.ui.alongTheWay}</h3>
      <ol className="rows">
        {groups.map((g) => (
          <li key={g.id} className="evrow">
            <WeatherIcon condition={g.condition} size={26} />
            <span className="evrow__text">
              <span className="evrow__title">{g.label}</span>
              <span className="evrow__detail">
                {g.fromName ?? m.ui.km(String(Math.round(g.startDistanceM / 1000)))}
                {g.toName && g.toName !== g.fromName ? ` → ${g.toName}` : ''}
              </span>
            </span>
            <span className="evrow__when tabular">
              {Math.round(g.minTemperature ?? 0) === Math.round(g.maxTemperature ?? 0)
                ? formatTemp(g.maxTemperature, units)
                : `${formatTemp(g.minTemperature, units)}–${formatTemp(g.maxTemperature, units)}`}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The selected point, as rows — no stat tiles. */
function PointDetails() {
  const m = useMessages();
  const units = useSettings((s) => s.units);
  const point = useAppStore((s) =>
    s.selectedPointId === 'current' ? s.derived.currentPoint : (s.derived.points.find((p) => p.id === s.selectedPointId) ?? null),
  );
  if (!point) return null;
  const w = point.weather;
  const D = m.detail;
  const rows: [string, string][] = [];
  if (w) {
    rows.push([conditionText(w, m), `${formatTemp(w.temperature, units.temperature)}${w.feelsLike !== undefined ? ` · ${D.feelsLike(formatTemp(w.feelsLike, units.temperature))}` : ''}`]);
    if (w.precipitationProbability !== undefined) {
      rows.push([D.precipitation, `${Math.round(w.precipitationProbability / 5) * 5}%${w.precipitation ? ` · ${w.precipitation} mm` : ''}`]);
    }
    if (w.windSpeed !== undefined) {
      rows.push([D.wind, `${formatSpeed(w.windSpeed, units.wind, m)}${w.windGusts ? ` · ${D.gusts(formatSpeed(w.windGusts, units.wind, m))}` : ''}`]);
    }
    if (w.visibility !== undefined && w.visibility < 10_000) rows.push([D.visibility, formatDistance(w.visibility, units.distance, m)]);
  }
  if (point.elevationM !== undefined) rows.push([D.elevation, `${point.elevationM} ${m.units.m}`]);
  const place = point.placeName ?? m.ui.km(String(Math.round(point.distanceFromStartKm)));
  return (
    <section className="pdetail" aria-label={place}>
      <div className="pdetail__head">
        {w ? <WeatherIcon condition={w.condition} isDay={w.isDay} size={40} /> : null}
        <div>
          <h3 className="pdetail__title">{point.placeRelation === 'near' ? m.ui.near(place) : place}</h3>
          <p className="pdetail__when tabular">
            {D.forecastFor(point.localTime)} · {formatLocalDate(point.arrivalMs, point.timezone)} · {formatUtcOffset(point.arrivalMs, point.timezone)}
          </p>
        </div>
      </div>
      {rows.length ? (
        <ul className="rows pdetail__rows">
          {rows.map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <span className="tabular">{v}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pdetail__na">{m.ui.noForecast}</p>
      )}
      {point.confidence !== 'high' ? <p className="pdetail__note">{m.ui.lessCertain}</p> : null}
    </section>
  );
}
