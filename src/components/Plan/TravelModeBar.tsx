import { formatDuration } from '../../i18n/format';
import { useMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { TRAVEL_MODES, type TravelMode } from '../../types/travel';
import { BikeIcon, CarIcon, FlightIcon, TransitIcon, WalkIcon } from '../Icons/Icons';
import './TravelModeBar.css';

const ICONS: Record<TravelMode, typeof CarIcon> = { drive: CarIcon, walk: WalkIcon, bike: BikeIcon, transit: TransitIcon, flight: FlightIcon };

/**
 * How are you getting there? Car, walking, bicycle, public transport, flight —
 * the chosen way shows how long the trip takes. Changing it shows the trip that
 * way at once, with the weather you would meet on it.
 */
export function TravelModeBar() {
  const m = useMessages();
  const travelMode = useAppStore((s) => s.travelMode);
  const durationS = useAppStore((s) => (s.plan ? s.plan.timed.totalTimeS : null));
  return (
    <div className="tmodes" role="radiogroup" aria-label={m.travel.label}>
      {TRAVEL_MODES.map((k) => {
        const Icon = ICONS[k];
        const on = k === travelMode;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={m.travel[k]}
            title={m.travel[k]}
            className={`tmode${on ? ' is-on' : ''}`}
            onClick={() => useAppStore.getState().setTravelMode(k)}
          >
            <Icon size={20} />
            {on && durationS !== null ? <span className="tmode__time tabular">{formatDuration(durationS, m)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
