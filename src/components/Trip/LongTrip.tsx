import { formatDistance, formatDuration, formatDurationCompact } from '../../i18n/format';
import { localizeScript } from '../../i18n/script';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { longTripActive, useTripStore } from '../../state/trip';
import type { ReasonCode, TripPlan } from '../../trip/types';
import { formatLocalTime, formatWeekday, localDateKey } from '../../utils/timezone';
import './Trip.css';

/**
 * Long Trip Mode UI (docs/features/LONG_TRIP_MODE.md §UI). Reads the plan
 * from the trip store; never computes trip logic itself.
 */

export type M = ReturnType<typeof useMessages>;

/** "18:40", or "Sat 18:40" when it isn't today where it happens. */
export function when(ms: number, tz: string, m: M): string {
  const time = formatLocalTime(ms, tz);
  return localDateKey(ms, tz) === localDateKey(Date.now(), tz) ? time : `${formatWeekday(ms, tz, m.locale)} ${time}`;
}

export function name(s: string | undefined, m: M): string {
  return s ? localizeScript(s, m.locale) : '';
}

export function reasonText(r: ReasonCode, m: M, units: 'metric' | 'imperial'): string {
  const R = m.trip.reason;
  switch (r.code) {
    case 'near-route':
      return R.nearRoute(formatDistance(r.km * 1000, units, m));
    case 'stars':
      return R.stars(r.n);
    case 'parking':
      return R.parking;
    case 'truck-parking':
      return R.truckParking;
    case 'open-at':
      return R.openAt(r.time);
    case 'open-24-7':
      return R.open247;
    case 'hours-unknown':
      return R.hoursUnknown;
    case 'brand':
      return r.brand;
    case 'fast-charger':
      return R.fastCharger(r.kw);
    case 'toilets':
      return R.toilets;
    case 'motorway-services':
      return R.services;
  }
}

/** Non-blocking: says when Long Trip Mode switched itself on, and lets the user change it. */
export function LongTripBanner() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const c = useTripStore((s) => s.classification);
  const override = useTripStore((s) => s.override);
  const travelMode = useAppStore((s) => s.travelMode);
  if (!c || travelMode !== 'drive') return null;
  const active = longTripActive({ override, classification: c });
  const set = useTripStore.getState().setOverride;
  if (active) {
    return (
      <div className="ltrip-banner" role="status">
        <span className="ltrip-banner__text">
          <strong>{override === 'on' ? m.trip.manualOn : m.trip.autoOn}</strong>
          {' · '}
          {m.trip.summaryLine(formatDistance(c.distanceKm * 1000, units, m), formatDuration(c.drivingTimeMinutes * 60, m))}
        </span>
        <button className="linkbtn" onClick={() => set('off')}>
          {m.trip.keepStandard}
        </button>
      </div>
    );
  }
  if (c.longTripMode || c.category !== 'SHORT') {
    return (
      <div className="ltrip-banner ltrip-banner--quiet">
        <button className="linkbtn" onClick={() => set('on')}>
          {c.longTripMode ? m.trip.useLongTrip : m.trip.planStops}
        </button>
      </div>
    );
  }
  return null;
}

/** The planning screen of a long trip: totals, arrival, status and advice. */
export function LongTripDashboard() {
  const m = useMessages();
  const plan = useTripStore((s) => s.plan);
  const status = useTripStore((s) => s.status);
  const error = useTripStore((s) => s.error);
  const active = useTripStore((s) => longTripActive(s));
  const classification = useTripStore((s) => s.classification);
  const borders = useTripStore((s) => s.borders);
  // The app's arrival (exact route timing + planned stops) — the same number as the header.
  const appArrival = useAppStore((s) => s.derived.arrivalMs);
  if (!active) return null;
  if (!plan) {
    return (
      <section className="ltrip">
        <h3 className="ltrip__label">{m.trip.longTrip}</h3>
        {status === 'error' ? (
          <p className="ltrip__note">
            {error === 'offline' ? m.trip.offline : m.trip.unavailable}{' '}
            <button className="linkbtn" onClick={() => useTripStore.getState().refresh('retry')}>
              {m.trip.retry}
            </button>
          </p>
        ) : (
          <p className="plan-status" role="status">
            <span className="spinner" aria-hidden="true" />
            {m.trip.planning}
          </p>
        )}
        {classification ? <p className="ltrip__note">{m.trip.summaryLine(`${classification.distanceKm} km`, formatDuration(classification.drivingTimeMinutes * 60, m))}</p> : null}
      </section>
    );
  }
  const S = plan.summary;
  const T = m.trip.tiles;
  const tz = plan.timeline.at(-1)?.tz ?? 'UTC';
  const borderValue = borders.status === 'ready' ? String(borders.crossings.length) : borders.status === 'loading' ? '…' : m.trip.notChecked;
  const tiles: [string, string][] = [
    [T.driving, formatDurationCompact(plan.estimatedDrivingTimeMinutes * 60, m)],
    [T.overnights, String(S.overnights)],
    [T.fuel, String(S.fuelStops)],
    [T.rest, String(S.restStops)],
    [T.meals, String(S.mealStops)],
    [T.weather, String(S.weatherRisks)],
    [T.border, borderValue],
  ];
  return (
    <section className="ltrip" aria-label={m.trip.longTrip}>
      <h3 className="ltrip__label">{m.trip.longTrip}</h3>
      <div className="ltrip__eta">
        <span className="ltrip__eta-label">{m.trip.arrival}</span>
        <span className="ltrip__eta-time tabular">{when(appArrival ?? plan.arriveAtMs, tz, m)}</span>
        <span className="ltrip__eta-note">{m.trip.totalTime(formatDuration(plan.estimatedTotalTimeMinutes * 60, m))}</span>
      </div>
      <ul className="ltrip__tiles">
        {tiles.map(([k, v]) => (
          <li key={k}>
            <span className={`ltrip__tile-value tabular${/\d/.test(v) ? '' : ' ltrip__tile-value--text'}`}>{v}</span>
            <span className="ltrip__tile-label">{k}</span>
          </li>
        ))}
      </ul>
      {borders.crossings.length ? (
        <p className="ltrip__note">
          {borders.crossings.map((c) => m.trip.borderLine(name(c.from.name, m), name(c.to.name, m), `${Math.round(c.alongM / 1000)} km`)).join(' · ')}
        </p>
      ) : null}
      {status === 'loading' ? (
        <p className="plan-status" role="status">
          <span className="spinner" aria-hidden="true" />
          {m.trip.planning}
        </p>
      ) : status === 'error' ? (
        <p className="ltrip__note">
          {m.trip.stale}{' '}
          <button className="linkbtn" onClick={() => useTripStore.getState().refresh('retry')}>
            {m.trip.retry}
          </button>
        </p>
      ) : null}
      <TripAdvice plan={plan} />
    </section>
  );
}

function TripAdvice({ plan }: { plan: TripPlan }) {
  const m = useMessages();
  return (
    <>
      {plan.advice.map((a, i) => {
        if (a.kind === 'stop-earlier') {
          return (
            <div key={i} className="ltrip-advice" role="note">
              <strong>{m.trip.stopEarlierTitle}</strong>
              <p>
                {m.trip.stopEarlierBody(m.trip.hazard[a.risk.kind], formatLocalTime(a.risk.startMs, a.risk.tz), formatLocalTime(a.risk.endMs, a.risk.tz), name(a.risk.placeName, m))}{' '}
                {m.trip.stopEarlierAction(name(a.areaName, m) || m.trip.areaUnnamed(`${Math.round(a.alongM / 1000)} km`), when(a.arriveMs, a.tz, m))}
              </p>
            </div>
          );
        }
        if (a.kind === 'enter-range') return <p key={i} className="ltrip__note">{m.trip.enterRange}</p>;
        return null;
      })}
    </>
  );
}
