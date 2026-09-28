import { useEffect, useMemo, useState } from 'react';
import { dailySummary, nextHours } from '../../algorithms/placeForecast';
import { matchForecastToTime } from '../../algorithms/weatherMatching';
import { conditionText, formatDistance, formatDuration, formatSpeed, formatTemp } from '../../i18n/format';
import { useLiveShare } from '../../share/liveShare';
import { useExplore } from '../../state/explore';
import { useSavedPlaces, type SavedSlot } from '../../state/savedPlaces';
import type { Place } from '../../types/geo';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { LocationForecast, WeatherAtTime } from '../../types/weather';
import { formatLocalTime, formatWeekday } from '../../utils/timezone';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { CloseIcon, DirectionsIcon, HomeIcon, LiveIcon, ShareIcon, StarIcon, WorkIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './Explore.css';

/** A place (search result, dropped pin, shared link, or "you"): where it is, how far, and its weather. */
export function PlaceSheet() {
  const sheet = useExplore((s) => s.cardSheet);
  const name = useExplore((s) => s.card?.place.name ?? '');
  const m = useMessages();
  return (
    <BottomSheet
      state={sheet}
      onChange={(v) => useExplore.getState().setCardSheet(v)}
      label={name}
      header={<PlaceHeader />}
      body={<PlaceWeather />}
      extra={
        <div className="plan-extra">
          <PlaceDays />
          <p className="attribution">{m.ui.attribution}</p>
        </div>
      }
    />
  );
}

function PlaceHeader() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const card = useExplore((s) => s.card)!;
  const hasPlan = useAppStore((s) => s.plan !== null);
  const sharing = useLiveShare((s) => s.status === 'active');
  const { place, drive } = card;
  const me = card.place.kind === 'me';
  const ex = useExplore.getState();
  return (
    <div className="phead">
      <div className="phead__text">
        <h2 className="phead__title">
          {card.naming ? (
            <span className="phead__naming">
              <span className="spinner" aria-hidden="true" />
              {m.explore.lookingUp}
            </span>
          ) : (
            place.name
          )}
        </h2>
        {place.label && place.label !== place.name ? <p className="phead__meta">{place.label}</p> : null}
        {drive?.status === 'ready' && drive.durationS !== undefined && drive.distanceM !== undefined ? (
          <p className="phead__drive tabular">{m.explore.drive(formatDuration(drive.durationS, m), formatDistance(drive.distanceM, units, m))}</p>
        ) : drive?.status === 'loading' ? (
          <p className="phead__drive phead__drive--loading" aria-hidden="true">
            <span className="spinner" />
          </p>
        ) : null}
      </div>
      <button className="icon-btn phead__close" onClick={() => ex.closeCard()} aria-label={m.ui.close}>
        <CloseIcon size={20} />
      </button>
      <div className="phead__actions">
        {me ? (
          <button className="btn btn-primary" onClick={() => useLiveShare.getState().openDialog()}>
            <LiveIcon size={18} />
            {sharing ? m.share.active : m.share.button}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void ex.directionsTo(place)}>
            <DirectionsIcon size={18} />
            {m.explore.directions}
          </button>
        )}
        {hasPlan && !me ? (
          <button className="btn btn-quiet" onClick={() => void ex.addAsStop(place)}>
            {m.explore.addStop}
          </button>
        ) : null}
        <button className="btn btn-quiet" onClick={() => ex.openSharePlace(place)}>
          <ShareIcon size={18} />
          {m.explore.share}
        </button>
        {!me && !card.naming ? <SaveMenu place={place} /> : null}
      </div>
    </div>
  );
}

/** Save as Home / Work / favourite (toggles), stored on this device. */
function SaveMenu({ place }: { place: Place }) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  useSavedPlaces((s) => s.saved); // re-render on change
  const slots = useSavedPlaces.getState().slotsOf(place);
  const toggle = (slot: SavedSlot) => {
    const st = useSavedPlaces.getState();
    const existing = st.saved.find((x) => x.slot === slot && st.slotsOf(place).includes(slot));
    if (existing) st.remove(existing.id, slot);
    else st.save(place, slot);
  };
  const rows: [SavedSlot, string, React.ReactNode][] = [
    ['favorite', m.explore.favorites, <StarIcon key="f" size={18} filled={slots.includes('favorite')} />],
    ['home', m.explore.home, <HomeIcon key="h" size={18} />],
    ['work', m.explore.work, <WorkIcon key="w" size={18} />],
  ];
  return (
    <span className="savemenu">
      <button className="btn btn-quiet" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <StarIcon size={18} filled={slots.length > 0} />
        {m.explore.save}
      </button>
      {open ? (
        <div className="popover savemenu__pop" role="menu" aria-label={m.explore.saveAs}>
          {rows.map(([slot, label, icon]) => (
            <button key={slot} className="popover__row" role="menuitemcheckbox" aria-checked={slots.includes(slot)} onClick={() => toggle(slot)}>
              {icon}
              <span>{label}</span>
              {slots.includes(slot) ? <span className="savemenu__check" aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** Minute-granular "now" so memoized views refresh as time passes, not on every render. */
function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const t = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 15_000);
    return () => clearInterval(t);
  }, []);
  return minute * 60_000;
}

function PlaceWeather() {
  const m = useMessages();
  const card = useExplore((s) => s.card)!;
  const units = useSettings((s) => s.units);
  const minute = useMinute();
  const f = card.weather.forecast;
  const now = useMemo(() => (f ? matchForecastToTime(f, Date.now()) : null), [f, minute]);
  const hours = useMemo(() => (f ? nextHours(f, Date.now(), 24) : []), [f, minute]);
  const arrivalMs = card.drive?.status === 'ready' ? card.drive.arrivalMs : undefined;
  const arrival = useMemo(() => (f && arrivalMs ? matchForecastToTime(f, arrivalMs) : null), [f, arrivalMs]);

  if (card.weather.status === 'loading') {
    return (
      <p className="pw-status" role="status">
        <span className="spinner" aria-hidden="true" />
        {m.explore.loading}
      </p>
    );
  }
  if (!f || !now) return <p className="pw-status">{m.explore.unavailable}</p>;

  return (
    <div className="pw">
      <section className="pw-now" aria-label={m.explore.now}>
        <WeatherIcon condition={now.condition} isDay={now.isDay} size={48} />
        <span className="pw-now__temp tabular">{formatTemp(now.temperature, units.temperature)}</span>
        <span className="pw-now__text">
          <span className="pw-now__cond">{conditionText(now, m)}</span>
          <span className="pw-now__detail">{detailLine(now, m, units)}</span>
        </span>
      </section>
      {arrivalMs ? (
        arrival ? (
          <section className="pw-arrive">
            <h3 className="label">{m.explore.onArrival(formatLocalTime(arrivalMs, f.timezone))}</h3>
            <div className="pw-arrive__row">
              <WeatherIcon condition={arrival.condition} isDay={arrival.isDay} size={32} />
              <span className="pw-arrive__temp tabular">{formatTemp(arrival.temperature, units.temperature)}</span>
              <span className="pw-arrive__text">
                {conditionText(arrival, m)}
                {arrival.precipitationProbability !== undefined && arrival.precipitationProbability >= 20
                  ? ` · ${m.explore.rainChance(`${Math.round(arrival.precipitationProbability / 5) * 5}%`)}`
                  : ''}
              </span>
            </div>
          </section>
        ) : (
          <p className="pw-note">{m.explore.arrivalBeyond}</p>
        )
      ) : null}
      <section className="pw-hours" aria-label={m.explore.hourly}>
        <h3 className="label">{m.explore.hourly}</h3>
        <ol className="pw-hours__row">
          {hours.map((h) => (
            <li key={h.timeMs} className="pw-hour">
              <span className="pw-hour__time tabular">{formatLocalTime(h.timeMs, f.timezone)}</span>
              <WeatherIcon condition={h.weather.condition} isDay={h.weather.isDay} size={28} />
              <span className="pw-hour__temp tabular">{formatTemp(h.weather.temperature, units.temperature)}</span>
              <span className="pw-hour__precip tabular">
                {h.weather.precipitationProbability !== undefined && h.weather.precipitationProbability >= 20
                  ? `${Math.round(h.weather.precipitationProbability / 5) * 5}%`
                  : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function detailLine(w: WeatherAtTime, m: ReturnType<typeof useMessages>, units: ReturnType<typeof useSettings.getState>['units']): string {
  const parts: string[] = [];
  if (w.feelsLike !== undefined && Math.round(w.feelsLike) !== Math.round(w.temperature)) parts.push(m.explore.feels(formatTemp(w.feelsLike, units.temperature)));
  if (w.windSpeed !== undefined) parts.push(`${m.detail.wind} ${formatSpeed(w.windSpeed, units.wind, m)}`);
  if (w.precipitationProbability !== undefined && w.precipitationProbability >= 10) {
    parts.push(m.explore.rainChance(`${Math.round(w.precipitationProbability / 5) * 5}%`));
  }
  return parts.join(' · ');
}

function PlaceDays() {
  const m = useMessages();
  const f = useExplore((s) => s.card?.weather.forecast ?? null);
  const temp = useSettings((s) => s.units.temperature);
  const minute = useMinute();
  const days = useMemo(() => (f ? dailySummary(f, Date.now(), 7) : []), [f, Math.floor(minute / 3_600_000)]);
  if (!f || days.length === 0) return null;
  return <DayRows days={days} f={f} temp={temp} m={m} />;
}

function DayRows({ days, f, temp, m }: { days: ReturnType<typeof dailySummary>; f: LocationForecast; temp: 'c' | 'f'; m: ReturnType<typeof useMessages> }) {
  return (
    <section>
      <h3 className="label">{m.explore.daily}</h3>
      <ol className="rows pw-days">
        {days.map((d, i) => (
          <li key={d.dateKey} className="pw-day">
            <span className="pw-day__name">{i === 0 ? m.explore.today : formatWeekday(d.noonMs, f.timezone, m.locale)}</span>
            <WeatherIcon condition={d.condition} size={26} />
            <span className="pw-day__precip tabular">
              {d.precipitationProbability !== undefined && d.precipitationProbability >= 20 ? `${Math.round(d.precipitationProbability / 5) * 5}%` : ''}
            </span>
            <span className="pw-day__range tabular">
              {formatTemp(d.min, temp)}
              <span className="pw-day__sep"> – </span>
              {formatTemp(d.max, temp)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
