import { useState } from 'react';
import { formatDistance, formatDuration, formatTemp, conditionText } from '../../i18n/format';
import { localizeScript } from '../../i18n/script';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { longTripActive, useTripStore } from '../../state/trip';
import type { ReasonCode, RecommendedPlace, StopPlaces, TimelineEntry, TripPlan, TripStop } from '../../trip/types';
import { formatLocalTime, formatWeekday, localDateKey } from '../../utils/timezone';
import type { EventIcon as EventIconKey } from '../../intelligence/types';
import { EventIcon } from '../Common/EventIcon';
import { ChevronIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './Trip.css';

/**
 * Long Trip Mode UI (docs/features/LONG_TRIP_MODE.md §UI). Reads the plan
 * from the trip store; never computes trip logic itself.
 */

type M = ReturnType<typeof useMessages>;

/** "18:40", or "Sat 18:40" when it isn't today where it happens. */
function when(ms: number, tz: string, m: M): string {
  const time = formatLocalTime(ms, tz);
  return localDateKey(ms, tz) === localDateKey(Date.now(), tz) ? time : `${formatWeekday(ms, tz, m.locale)} ${time}`;
}

function name(s: string | undefined, m: M): string {
  return s ? localizeScript(s, m.locale) : '';
}

function reasonText(r: ReasonCode, m: M, units: 'metric' | 'imperial'): string {
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
  if (c.longTripMode || c.category === 'EXTENDED' || c.category === 'LONG') {
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
  const tiles: [string, string][] = [
    [T.driving, formatDuration(plan.estimatedDrivingTimeMinutes * 60, m)],
    [T.overnights, String(S.overnights)],
    [T.fuel, String(S.fuelStops)],
    [T.rest, String(S.restStops)],
    [T.meals, String(S.mealStops)],
    [T.weather, String(S.weatherRisks)],
    [T.border, S.borderCrossings === null ? m.trip.notChecked : String(S.borderCrossings)],
  ];
  return (
    <section className="ltrip" aria-label={m.trip.longTrip}>
      <h3 className="ltrip__label">{m.trip.longTrip}</h3>
      <div className="ltrip__eta">
        <span className="ltrip__eta-label">{m.trip.arrival}</span>
        <span className="ltrip__eta-time tabular">{when(plan.arriveAtMs, tz, m)}</span>
        <span className="ltrip__eta-note">{m.trip.totalTime(formatDuration(plan.estimatedTotalTimeMinutes * 60, m))}</span>
      </div>
      <ul className="ltrip__tiles">
        {tiles.map(([k, v]) => (
          <li key={k}>
            <span className="ltrip__tile-value tabular">{v}</span>
            <span className="ltrip__tile-label">{k}</span>
          </li>
        ))}
      </ul>
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

function PlacesList({ places, m, units }: { places: StopPlaces[]; m: M; units: 'metric' | 'imperial' }) {
  return (
    <div className="ltrip-places">
      {places.map((cat) => (
        <div key={cat.category}>
          <h5 className="ltrip-places__cat">{m.trip.category[cat.category]}</h5>
          {cat.status === 'unavailable' ? (
            <p className="ltrip__note">{m.trip.placesUnavailable}</p>
          ) : cat.places.length === 0 ? (
            <p className="ltrip__note">{cat.category === 'hotel' ? m.trip.noHotels : m.trip.noneHere}</p>
          ) : (
            <ul className="ltrip-places__list">
              {cat.places.map((p) => (
                <PlaceRow key={p.id} place={p} m={m} units={units} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function PlaceRow({ place, m, units }: { place: RecommendedPlace; m: M; units: 'metric' | 'imperial' }) {
  const label = name(place.name, m) || name(place.brand, m) || m.trip.category[place.category];
  return (
    <li className="ltrip-place">
      <span className="ltrip-place__name">{label}</span>
      <span className="ltrip-place__why">{place.reasons.map((r) => reasonText(r, m, units)).join(' · ')}</span>
    </li>
  );
}

/** Places for one stop, loaded when asked (or prefetched for the first night). */
function StopPlacesView({ stop }: { stop: TripStop }) {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const st = useTripStore((s) => s.stopPlaces[stop.id]);
  if (!st) {
    return (
      <button className="linkbtn" onClick={() => useTripStore.getState().loadStopPlaces(stop.id)}>
        {m.trip.showPlaces}
      </button>
    );
  }
  if (st.status === 'loading') {
    return (
      <p className="plan-status" role="status">
        <span className="spinner" aria-hidden="true" />
        {m.trip.loadingPlaces}
      </p>
    );
  }
  if (st.status === 'error' || !st.places) {
    return (
      <p className="ltrip__note">
        {m.trip.placesUnavailable}{' '}
        <button
          className="linkbtn"
          onClick={() => {
            useTripStore.setState((t) => {
              const next = { ...t.stopPlaces };
              delete next[stop.id];
              return { stopPlaces: next };
            });
            useTripStore.getState().loadStopPlaces(stop.id);
          }}
        >
          {m.trip.retry}
        </button>
      </p>
    );
  }
  return <PlacesList places={st.places} m={m} units={units} />;
}

/** 🛏 Overnight stay: where, when, which hotels nearby, and other towns that would work. */
export function OvernightStay() {
  const m = useMessages();
  const plan = useTripStore((s) => (longTripActive(s) ? s.plan : null));
  if (!plan || plan.accommodation.length === 0) return null;
  return (
    <section className="ltrip-night">
      <h3 className="label">{m.trip.overnightTitle}</h3>
      <p className="ltrip__note">{m.trip.overnightIntro}</p>
      {plan.accommodation.map((a) => {
        const stop = plan.recommendedStops.find((s) => s.id === a.stopId)!;
        return (
          <div key={a.stopId} className="ltrip-night__card">
            <div className="ltrip-night__head">
              <span className="ltrip-night__area">
                <small>{m.trip.area}</small>
                {name(a.areaName, m) || m.trip.areaUnnamed(`${Math.round(stop.alongM / 1000)} km`)}
              </span>
              <span className="ltrip-night__eta tabular">
                {when(a.arriveMs, a.tz, m)}
                <small>{m.trip.stayNights(a.nights)}</small>
              </span>
            </div>
            <p className="ltrip__note">{m.trip.hotelsNote}</p>
            <StopPlacesView stop={stop} />
            {a.alternatives.length ? (
              <div className="ltrip-night__alts">
                <h5 className="ltrip-places__cat">{m.trip.alternatives}</h5>
                {a.alternatives.map((alt) => (
                  <button key={alt.alongM} className="btn btn-quiet ltrip-night__alt" onClick={() => useTripStore.getState().chooseOvernight(a.stopId, alt.alongM)}>
                    {m.trip.stayInstead(name(alt.name, m), when(alt.arriveMs, a.tz, m))}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

const TIMELINE_ICON: Record<TimelineEntry['kind'], EventIconKey> = {
  depart: 'stop',
  continue: 'clock',
  fuel: 'fuel',
  charge: 'charging',
  rest: 'rest',
  meal: 'poi',
  weather: 'rain',
  overnight: 'rest',
  arrive: 'flag',
};

const HAZARD_ICON: Record<string, EventIconKey> = { rain: 'rain', 'heavy-rain': 'heavy-rain', snow: 'snow', storm: 'storm', fog: 'fog', wind: 'wind', freezing: 'ice' };

function TimelineIcon({ kind, hazard }: { kind: TimelineEntry['kind']; hazard?: string }) {
  return (
    <span className="ltrip-tl__icon" aria-hidden="true">
      <EventIcon icon={kind === 'weather' && hazard ? (HAZARD_ICON[hazard] ?? 'rain') : TIMELINE_ICON[kind]} size={20} />
    </span>
  );
}

/** The whole trip at a glance, day by day (each day expands). */
export function TripDays() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const plan = useTripStore((s) => (longTripActive(s) ? s.plan : null));
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  if (!plan) return null;
  return (
    <section className="ltrip-days">
      {plan.days.map((d) => {
        const isOpen = open[d.index] ?? plan.days.length === 1;
        const entries = plan.timeline.filter((e) => e.day === d.index);
        return (
          <div key={d.index} className="ltrip-day">
            <button className="ltrip-day__head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [d.index]: !isOpen })}>
              <span>
                <strong>{m.trip.dayN(d.index + 1)}</strong> {m.trip.dayRoute(name(d.fromName, m), name(d.toName, m))}
              </span>
              <span className="ltrip-day__meta tabular">
                {formatDistance(d.distanceKm * 1000, units, m)} · {formatDuration(d.drivingMinutes * 60, m)}
                <ChevronIcon size={14} className={isOpen ? 'ltrip-day__chev is-open' : 'ltrip-day__chev'} />
              </span>
            </button>
            {isOpen ? (
              <ol className="ltrip-timeline">
                {entries.map((e, i) => (
                  <li key={`${e.kind}-${e.atMs}-${i}`} className={`ltrip-tl ltrip-tl--${e.kind}`}>
                    <span className="ltrip-tl__time tabular">{formatLocalTime(e.atMs, e.tz)}</span>
                    <TimelineIcon kind={e.kind} hazard={e.hazard} />
                    <span className="ltrip-tl__text">
                      <strong>{e.kind === 'weather' && e.hazard ? m.trip.hazard[e.hazard] : m.trip.timeline[e.kind]}</strong>
                      {e.placeName ? ` · ${name(e.placeName, m)}` : ''}
                      {e.dwellMinutes && e.kind !== 'overnight' ? ` · ${formatDuration(e.dwellMinutes * 60, m)}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** "Recommended for your trip": the few stops that matter, each with its places on request. */
export function TripRecommendations() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const plan = useTripStore((s) => (longTripActive(s) ? s.plan : null));
  const [open, setOpen] = useState<string | null>(null);
  if (!plan) return null;
  const stops = plan.recommendedStops.filter((s) => !s.kinds.includes('overnight'));
  if (!stops.length) return null;
  return (
    <section className="ltrip-recs">
      <h3 className="label">{m.trip.recommended}</h3>
      <ul className="rows">
        {stops.map((s) => {
          const kind = s.kinds.includes('meal') ? 'meal' : s.kinds.includes('charge') ? 'charge' : s.kinds.includes('fuel') ? 'fuel' : 'rest';
          const label = s.kinds.map((k) => m.trip.stopKind[k]).join(' + ');
          return (
            <li key={s.id} className="ltrip-rec">
              <button className="ltrip-rec__head" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <TimelineIcon kind={kind} />
                <span className="ltrip-rec__text">
                  <strong>{label}</strong>
                  <span className="ltrip-rec__meta tabular">
                    {formatLocalTime(s.arriveMs, s.tz)} · {formatDistance(s.alongM, units, m)}
                    {s.placeName ? ` · ${m.ui.near(name(s.placeName, m))}` : ''} · {formatDuration(s.dwellMinutes * 60, m)}
                  </span>
                </span>
              </button>
              {open === s.id ? <StopPlacesView stop={s} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Weather along the journey at the planned (stop-aware) times. */
export function JourneyWeather() {
  const m = useMessages();
  const units = useSettings((s) => s.units);
  const active = useTripStore((s) => longTripActive(s) && !!s.plan);
  const points = useAppStore((s) => s.derived.displayPoints);
  if (!active || points.length === 0) return null;
  return (
    <section className="ltrip-wx">
      <h3 className="label">{m.trip.journeyWeather}</h3>
      <ul className="rows">
        {points.map((p) => (
          <li key={p.id} className="ltrip-wx__row">
            <span className="ltrip-wx__km tabular">+{formatDistance(p.distanceFromStartKm * 1000, units.distance, m)}</span>
            <span className="ltrip-wx__when tabular">{when(p.arrivalMs, p.timezone, m)}</span>
            {p.weather ? <WeatherIcon condition={p.weather.condition} isDay={p.weather.isDay} size={22} /> : null}
            <span className="ltrip-wx__text">
              {p.weather ? `${conditionText(p.weather, m)} · ${formatTemp(p.weather.temperature, units.temperature)}` : m.ui.noForecast}
              {p.placeName ? ` · ${name(p.placeName, m)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
