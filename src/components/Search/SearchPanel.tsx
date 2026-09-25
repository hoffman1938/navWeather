import { useEffect, useRef, useState } from 'react';
import { getProviders } from '../../services/providers';
import { useAppStore, type RouteStatus } from '../../state/store';
import { useLayoutStore } from '../../state/layout';
import { useElementSize } from '../../hooks/useElementSize';
import { getCurrentPosition } from '../../hooks/useGeolocation';
import { EditIcon, SwapIcon } from '../Icons/Icons';
import { PlaceInput } from './PlaceInput';
import './Search.css';

const STAGE_TEXT: Partial<Record<RouteStatus, string>> = {
  geocoding: 'Finding places…',
  routing: 'Calculating route…',
  places: 'Finding towns along your route…',
};

export function SearchPanel() {
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);
  const routeStatus = useAppStore((s) => s.routeStatus);
  const routeError = useAppStore((s) => s.routeError);
  const hasRoute = useAppStore((s) => s.plan !== null);
  const routeTitle = useAppStore((s) =>
    s.plan ? `${s.plan.timed.route.origin.name} → ${s.plan.timed.route.destination.name}` : '',
  );
  const mode = useAppStore((s) => s.mode);
  const [editing, setEditing] = useState(!hasRoute);
  const [locating, setLocating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const setInsets = useLayoutStore((s) => s.setInsets);

  useElementSize(ref, (r) => setInsets({ top: Math.round(r.bottom) }));

  const busy = routeStatus === 'geocoding' || routeStatus === 'routing' || routeStatus === 'places';

  // Collapse into a compact route pill once a route is ready.
  useEffect(() => {
    if (routeStatus === 'ready') setEditing(false);
    if (routeStatus === 'error') setEditing(true);
  }, [routeStatus]);

  const submit = () => {
    const s = useAppStore.getState();
    if (!s.origin.text.trim() && !s.origin.place) return;
    if (!s.destination.text.trim() && !s.destination.place) return;
    void s.calculateRoute();
  };

  const useCurrent = async () => {
    setLocating(true);
    try {
      const coordinate = await getCurrentPosition();
      let name = 'Current location';
      try {
        name = (await getProviders().geocoding.reverse(coordinate))?.name ?? name;
      } catch {
        /* keep generic name */
      }
      useAppStore.getState().setOriginPlace({
        id: `here:${coordinate.join(',')}`,
        name,
        label: 'Current location',
        coordinate,
      });
    } catch (e) {
      useAppStore.getState().showNotice('warning', (e as Error).message);
    } finally {
      setLocating(false);
    }
  };

  if (mode !== 'planning') return <div ref={ref} className="search-panel search-panel--hidden" />;

  if (!editing && hasRoute) {
    return (
      <div ref={ref} className="search-panel search-panel--collapsed">
        <button className="route-pill" onClick={() => setEditing(true)} aria-label={`Edit route ${routeTitle}`}>
          <span className="route-pill__title">{routeTitle}</span>
          <EditIcon size={18} className="route-pill__edit" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="search-panel" role="search">
      <form
        className="search-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="search-card__fields">
          <PlaceInput
            label="From"
            icon="origin"
            placeholder={locating ? 'Locating…' : 'From — city, address or place'}
            value={origin.text}
            place={origin.place}
            onChangeText={(t) => useAppStore.getState().setOriginText(t)}
            onSelect={(p) => useAppStore.getState().setOriginPlace(p)}
            onSubmit={submit}
            onUseCurrentLocation={useCurrent}
            autoFocus={!hasRoute && typeof window !== 'undefined' && window.innerWidth >= 900}
          />
          <div className="search-card__divider" aria-hidden="true" />
          <PlaceInput
            label="To"
            icon="destination"
            placeholder="To — where are you driving?"
            value={destination.text}
            place={destination.place}
            near={origin.place?.coordinate}
            onChangeText={(t) => useAppStore.getState().setDestinationText(t)}
            onSelect={(p) => useAppStore.getState().setDestinationPlace(p)}
            onSubmit={submit}
          />
          <button
            type="button"
            className="icon-btn search-card__swap"
            onClick={() => useAppStore.getState().swapPlaces()}
            aria-label="Swap start and destination"
          >
            <SwapIcon size={18} />
          </button>
        </div>
        {routeError ? (
          <p className="search-card__error" role="alert">
            {routeError}
          </p>
        ) : null}
        <div className="search-card__actions">
          {hasRoute ? (
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary search-card__go" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span aria-live="polite">{STAGE_TEXT[routeStatus] ?? 'Working…'}</span>
              </>
            ) : (
              'Calculate route'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
