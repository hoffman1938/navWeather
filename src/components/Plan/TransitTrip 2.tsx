import { Fragment, type CSSProperties } from 'react';
import { formatDistance, formatDuration } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { TransitLeg, TransitTrip, TransitVehicle } from '../../types/route';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { BusIcon, FerryIcon, FlightIcon, SubwayIcon, TramIcon, TransitIcon, WalkIcon } from '../Icons/Icons';
import { RoadForecast } from './RoadForecast';
import { exposureLine } from './RouteOptions';
import './Transit.css';

/** Who publishes the timetables (Transitous asks for this link in a visible place). */
export const TRANSIT_SOURCES_URL = 'https://transitous.org/sources/';

const VEHICLE_ICONS: Record<TransitVehicle, typeof BusIcon> = {
  walk: WalkIcon,
  bus: BusIcon,
  tram: TramIcon,
  subway: SubwayIcon,
  rail: TransitIcon,
  ferry: FerryIcon,
  cable: TransitIcon,
  plane: FlightIcon,
  other: TransitIcon,
};

/** The trip's start time zone (times are read at the stop, not on the device). */
function useTripTimeZone(): string {
  return useAppStore((s) => s.derived.points[0]?.timezone ?? deviceTimeZone());
}

/** A line as signed on the vehicle: its number on the line's own colours. */
function LineBadge({ leg }: { leg: TransitLeg }) {
  const m = useMessages();
  const style = leg.color ? { background: leg.color, color: leg.textColor ?? '#fff' } : undefined;
  return (
    <span className={`tline${style ? '' : ' tline--plain'}`} style={style}>
      {leg.line ?? m.transit.vehicle[leg.vehicle]}
    </span>
  );
}

/** "🚶 › 🚌 476 › 🚌 539 › 🚶" — how the trip is made, at a glance. Short walks between stops are left out. */
export function TransitChips({ trip }: { trip: TransitTrip }) {
  const m = useMessages();
  const legs = trip.legs.filter((l, i) => l.vehicle !== 'walk' || i === 0 || i === trip.legs.length - 1);
  return (
    <span className="tchips" aria-label={legs.map((l) => (l.vehicle === 'walk' ? m.transit.walk : `${m.transit.vehicle[l.vehicle]} ${l.line ?? ''}`)).join(', ')}>
      {legs.map((l, i) => {
        const Icon = VEHICLE_ICONS[l.vehicle];
        return (
          <Fragment key={i}>
            {i > 0 ? <span className="tchips__sep" aria-hidden="true">›</span> : null}
            <span className="tchip" aria-hidden="true">
              <Icon size={16} />
              {l.vehicle !== 'walk' ? <LineBadge leg={l} /> : null}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/**
 * Public transport: the trips found, by arrival — times, the lines to take
 * and each trip's own weather. Picking one shows it on the map and below.
 */
export function TransitOptions() {
  const m = useMessages();
  const routeOptions = useAppStore((s) => s.routeOptions);
  const selected = useAppStore((s) => s.selectedOption);
  const summaries = useAppStore((s) => s.derived.options);
  const tz = useTripTimeZone();
  const trips = routeOptions.map((o) => o.timed.route.transit).filter((t): t is TransitTrip => !!t);
  if (trips.length === 0) return null;
  return (
    <section className="ropts" aria-label={m.ui.routes}>
      <ul className="rows" role="radiogroup" aria-label={m.ui.routes}>
        {routeOptions.map((o, i) => {
          const trip = o.timed.route.transit;
          if (!trip) return null;
          const summary = summaries.find((x) => x.index === i);
          const firstRide = trip.legs.find((l) => l.vehicle !== 'walk');
          return (
            <li key={o.timed.route.id}>
              <button
                role="radio"
                aria-checked={i === selected}
                className={`ropt${i === selected ? ' is-selected' : ''}`}
                onClick={() => void useAppStore.getState().selectRouteOption(i)}
              >
                <span className="ropt__mark" aria-hidden="true" />
                <span className="ropt__main">
                  <span className="topt__head tabular">
                    <span className="ropt__name">{m.transit.times(formatLocalTime(trip.departMs, tz), formatLocalTime(trip.arriveMs, tz))}</span>
                    <span className="topt__dur">{formatDuration((trip.arriveMs - trip.departMs) / 1000, m)}</span>
                  </span>
                  <TransitChips trip={trip} />
                  <span className="ropt__meta tabular">
                    {firstRide ? m.transit.leaveFrom(formatLocalTime(firstRide.departMs, tz), firstRide.fromName) : ''}
                    {firstRide ? ' · ' : ''}
                    {m.transit.transfers(trip.transfers)}
                  </span>
                  {summary?.forecast ? <RoadForecast forecast={summary.forecast} label={m.ui.roadForecast} /> : null}
                  {summary?.hasWeather ? <span className="ropt__wx">{exposureLine(summary, m)}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The chosen trip, step by step: where to walk, which line to board where, and where to get off. */
export function TransitSteps() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const trip = useAppStore((s) => s.plan?.timed.route.transit ?? null);
  const destination = useAppStore((s) => s.plan?.timed.route.destination.name ?? '');
  const tz = useTripTimeZone();
  if (!trip) return null;
  return (
    <section className="tsteps">
      <h3 className="label">{m.transit.steps}</h3>
      <ol className="tsteps__list">
        {trip.legs.map((l, i) => {
          const Icon = VEHICLE_ICONS[l.vehicle];
          const minutes = formatDuration((l.arriveMs - l.departMs) / 1000, m);
          if (l.vehicle === 'walk') {
            const next = trip.legs[i + 1];
            // Getting off and on at the same stop: a change, not a walk anywhere.
            const change = l.distanceM < 15 && i > 0 && !!next;
            return (
              <li key={i} className="tstep tstep--walk">
                <span className="tstep__time tabular">{formatLocalTime(l.departMs, tz)}</span>
                <span className="tstep__rail" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="tstep__body">
                  <span className="tstep__title">
                    {change ? `${m.transit.change} · ${minutes}` : `${m.transit.walk} ${minutes} · ${formatDistance(l.distanceM, units, m)}`}
                  </span>
                  {!change ? (
                    <span className="tstep__detail">{m.transit.walkTo(next ? next.fromName || l.toName : l.toName || destination)}</span>
                  ) : null}
                </span>
              </li>
            );
          }
          return (
            <li key={i} className="tstep" style={l.color ? ({ '--line': l.color } as CSSProperties) : undefined}>
              <span className="tstep__time tabular">{formatLocalTime(l.departMs, tz)}</span>
              <span className="tstep__rail" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="tstep__body">
                <span className="tstep__title">{l.fromName}</span>
                <span className="tstep__line">
                  <LineBadge leg={l} />
                  {l.headsign ? <span className="tstep__detail">{m.transit.toward(l.headsign)}</span> : null}
                </span>
                <span className="tstep__detail tabular">
                  {m.transit.stops(l.stops)} · {minutes}
                  {l.realTime ? ` · ${m.transit.live}` : ''}
                </span>
                <span className="tstep__title tstep__off">
                  <span className="tabular">{formatLocalTime(l.arriveMs, tz)}</span> {l.toName}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
