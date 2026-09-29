import { useMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { EventIcon } from '../Common/EventIcon';

/**
 * "Thunderstorms ahead on your route — another route avoids ~25 min of it,
 * +8 min." Offered, never taken automatically; the grey line on the map is
 * the route on offer.
 */
export function RerouteOffer() {
  const m = useMessages();
  const offer = useAppStore((s) => s.weatherReroute);
  if (!offer) return null;
  const avoided = offer.condition === 'fog' ? offer.current.fogMinutes - offer.alternative.fogMinutes : offer.current.severeMinutes - offer.alternative.severeMinutes;
  const extraMin = Math.round(offer.extraS / 60);
  const icon = offer.condition === 'storm' ? 'storm' : offer.condition === 'snow' ? 'snow' : offer.condition === 'fog' ? 'fog' : 'heavy-rain';
  return (
    <section className="reroute" role="alert" aria-label={m.reroute.title(m.reroute.condition[offer.condition])}>
      <div className="reroute__head">
        <EventIcon icon={icon} size={30} />
        <p className="reroute__text">
          <strong>{m.reroute.title(m.reroute.condition[offer.condition])}</strong>
          <span className="tabular">
            {m.reroute.avoids(Math.max(0, Math.round(avoided)))} · {m.reroute.extra(extraMin)}
          </span>
          <small>{m.reroute.basis}</small>
        </p>
      </div>
      <div className="reroute__actions">
        <button className="btn btn-primary" onClick={() => void useAppStore.getState().acceptWeatherReroute()}>
          {m.reroute.take}
        </button>
        <button className="btn btn-quiet" onClick={() => useAppStore.getState().dismissWeatherReroute()}>
          {m.reroute.keep}
        </button>
      </div>
    </section>
  );
}
