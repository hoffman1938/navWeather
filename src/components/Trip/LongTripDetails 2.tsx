import { useState } from 'react';
import { conditionText, formatDistance, formatDuration, formatTemp } from '../../i18n/format';
import type { EventIcon as EventIconKey } from '../../intelligence/types';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { longTripActive, useTripStore } from '../../state/trip';
import { plannedTimeAt } from '../../trip/replanning/progress';
import type { RecommendedPlace, StopPlaces, TimelineEntry, TripStop } from '../../trip/types';
import { formatLocalTime } from '../../utils/timezone';
import { EventIcon } from '../Common/EventIcon';
import { ChevronIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import { name, reasonText, when, type M } from './LongTrip';

/**
 * Long Trip Mode — the detail sections (overnight stay, day-by-day timeline,
 * recommended stops, weather along the journey). Loaded on demand: only a
 * long trip needs them (docs/features/LONG_TRIP_MODE.md §UI).
 */

const TIMELINE_ICON: Record<TimelineEntry['kind'], EventIconKey> = {
  border: 'flag',
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

/** The whole trip at a glance, day by day (each day expands). */
export function TripDays() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const plan = useTripStore((s) => (longTripActive(s) ? s.plan : null));
  const crossings = useTripStore((s) => s.borders.crossings);
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  if (!plan) return null;
  // Border crossings join the timeline at their planned time (approximate place, so the time is too).
  const borderEntries: (TimelineEntry & { border: string })[] = crossings.map((c) => {
    const night = [...plan.recommendedStops].reverse().find((s) => s.kinds.includes('overnight') && s.alongM <= c.alongM);
    return {
      atMs: plannedTimeAt(plan, c.alongM),
      tz: plan.recommendedStops.find((s) => s.alongM >= c.alongM)?.tz ?? plan.timeline.at(-1)?.tz ?? 'UTC',
      kind: 'border' as TimelineEntry['kind'],
      day: night ? night.day + 1 : 0,
      alongM: c.alongM,
      border: m.trip.borderLine(name(c.from.name, m), name(c.to.name, m), ''),
    };
  });
  return (
    <section className="ltrip-days">
      {plan.days.map((d) => {
        const isOpen = open[d.index] ?? plan.days.length === 1;
        const entries: (TimelineEntry & { border?: string })[] = [...plan.timeline.filter((e) => e.day === d.index), ...borderEntries.filter((e) => e.day === d.index)].sort((a, b) => a.atMs - b.atMs);
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
                      <strong>{e.kind === 'weather' && e.hazard ? m.trip.hazard[e.hazard] : e.kind === 'border' ? e.border : m.trip.timeline[e.kind]}</strong>
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

/** All detail sections, in the order the plan sheet shows them. */
export default function LongTripDetails() {
  return (
    <>
      <OvernightStay />
      <TripDays />
      <TripRecommendations />
      <JourneyWeather />
    </>
  );
}
