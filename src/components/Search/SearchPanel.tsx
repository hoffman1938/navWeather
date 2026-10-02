import { useEffect, useRef, useState } from 'react';
import { useExplore } from '../../state/explore';
import { useLayoutStore } from '../../state/layout';
import { useMessages } from '../../state/settings';
import { useAppStore, type PlaceField } from '../../state/store';
import { useElementSize } from '../../hooks/useElementSize';
import { BackIcon, CloseIcon, DirectionsIcon, EditIcon, SettingsIcon, SwapIcon } from '../Icons/Icons';
import { NearbyChips } from '../Explore/Nearby';
import { TravelModeBar } from '../Plan/TravelModeBar';
import { PlaceInput } from './PlaceInput';
import './Search.css';

export function SearchPanel() {
  const m = useMessages();
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);
  const waypoints = useAppStore((s) => s.waypoints);
  const routeStatus = useAppStore((s) => s.routeStatus);
  const routeError = useAppStore((s) => s.routeError);
  const hasPlan = useAppStore((s) => s.plan !== null);
  const title = useAppStore((s) => {
    const r = s.plan?.timed.route;
    return r ? [r.origin.name, ...(r.waypoints ?? []).map((w) => w.name), r.destination.name].join(' → ') : '';
  });
  const mode = useAppStore((s) => s.mode);
  const travelMode = useAppStore((s) => s.travelMode);
  const directionsOpen = useExplore((s) => s.directionsOpen);
  const query = useExplore((s) => s.query);
  const near = useExplore((s) => s.myLocation?.coordinate);
  const searching = useExplore((s) => s.searching);
  const [editing, setEditing] = useState(!hasPlan);
  const ref = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const setInsets = useLayoutStore((s) => s.setInsets);
  useElementSize(ref, (r) => setInsets({ top: Math.round(r.bottom) }));

  const busy = routeStatus === 'geocoding' || routeStatus === 'routing' || routeStatus === 'places';

  useEffect(() => {
    if (routeStatus === 'ready') {
      setEditing(false);
    }
    if (routeStatus === 'error') setEditing(true);
  }, [routeStatus]);

  // An empty field isn't ignored: calculateRoute says which place is missing.
  const submit = () => void useAppStore.getState().calculateRoute();

  const useCurrent = () => useExplore.getState().useMyLocationAsOrigin();
  const openSettings = () => useAppStore.getState().setSettingsOpen(true);

  if (mode !== 'planning') return <div ref={ref} className="search search--hidden" />;

  // Explore: one search field, like any map app. Directions are one tap away.
  if (!hasPlan && !directionsOpen && routeStatus !== 'error' && !busy) {
    const ex = useExplore.getState();
    return (
      <div ref={ref} className="search" role="search">
        <form
          className="search__card search__explore"
          onSubmit={(e) => {
            e.preventDefault();
            void ex.searchSubmit(query);
          }}
        >
          <PlaceInput
            label={m.explore.search}
            icon="search"
            placeholder={m.explore.search}
            value={query}
            place={null}
            near={near}
            onChangeText={(t) => ex.setQuery(t)}
            onSelect={(p) => ex.selectPlace(p, 'search')}
            onSubmit={() => void ex.searchSubmit(useExplore.getState().query)}
            quick
            busy={searching}
          />
          <button type="button" className="icon-btn" onClick={() => ex.openDirections(true)} aria-label={m.explore.directions}>
            <DirectionsIcon size={22} />
          </button>
          <button type="button" className="icon-btn" onClick={openSettings} aria-label={m.ui.settings}>
            <SettingsIcon size={20} />
          </button>
        </form>
        <NearbyChips />
      </div>
    );
  }

  if (!editing && hasPlan) {
    return (
      <div ref={ref} className="search search--collapsed">
        <button ref={editButton} className="routeline" onClick={() => setEditing(true)} aria-label={m.ui.editRoute(title)}>
          <span className="routeline__title">{title}</span>
          <EditIcon size={16} />
        </button>
        <button className="icon-btn search__settings" onClick={openSettings} aria-label={m.ui.settings}>
          <SettingsIcon size={20} />
        </button>
        <button
          className="icon-btn search__settings"
          onClick={() => {
            useAppStore.getState().clearRoute();
            useExplore.getState().openDirections(false);
          }}
          aria-label={m.ui.close}
        >
          <CloseIcon size={20} />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="search" role="search">
      <form
        className="search__card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TravelModeBar />
        <div className="search__fields">
          <PlaceInput
            inputRef={firstField}
            label={m.ui.from}
            icon="origin"
            placeholder={m.ui.fromPlaceholder}
            value={origin.text}
            place={origin.place}
            onChangeText={(t) => useAppStore.getState().setOriginText(t)}
            onSelect={(p) => useAppStore.getState().setOriginPlace(p)}
            onSubmit={submit}
            onUseCurrentLocation={useCurrent}
            quick
            autoFocus={!hasPlan && typeof window !== 'undefined' && window.innerWidth >= 900}
          />
          {waypoints.map((w, i) => (
            <div className="search__stop" key={i}>
              <PlaceInput
                label={`${m.ui.stopPlaceholder} ${i + 1}`}
                icon="stop"
                placeholder={m.ui.stopPlaceholder}
                value={w.text}
                place={w.place}
                near={origin.place?.kind === 'here' ? near : origin.place?.coordinate}
                onChangeText={(t) => useAppStore.getState().setWaypointText(i, t)}
                onSelect={(p) => useAppStore.getState().setWaypointPlace(i, p)}
                onSubmit={submit}
              />
              <button type="button" className="icon-btn" onClick={() => useAppStore.getState().removeWaypoint(i)} aria-label={m.ui.removeStop}>
                <CloseIcon size={16} />
              </button>
            </div>
          ))}
          <PlaceInput
            label={m.ui.to}
            icon="destination"
            placeholder={m.ui.toPlaceholder}
            value={destination.text}
            place={destination.place}
            near={origin.place?.kind === 'here' ? near : origin.place?.coordinate}
            onChangeText={(t) => useAppStore.getState().setDestinationText(t)}
            onSelect={(p) => useAppStore.getState().setDestinationPlace(p)}
            onSubmit={submit}
            quick
          />
          <button type="button" className="icon-btn search__swap" onClick={() => useAppStore.getState().swapPlaces()} aria-label={m.ui.swap}>
            <SwapIcon size={18} />
          </button>
        </div>
        {routeError ? (
          <p className="search__error" role="alert">
            {routeError}
          </p>
        ) : null}
        {routeError && travelMode === 'transit' ? (
          <a className="linkbtn" href={transitTimetablesUrl(origin, destination)} target="_blank" rel="noopener noreferrer">
            {m.travel.transitLink}
          </a>
        ) : null}
        <div className="search__actions">
          {!hasPlan ? (
            <button type="button" className="icon-btn" onClick={() => useExplore.getState().openDirections(false)} aria-label={m.explore.back}>
              <BackIcon size={20} />
            </button>
          ) : null}
          {waypoints.length < 3 ? (
            <button type="button" className="btn btn-quiet" onClick={() => useAppStore.getState().addWaypoint()}>
              + {m.ui.addStop}
            </button>
          ) : null}
          <span className="search__spacer" />
          {hasPlan ? (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setEditing(false);
                requestAnimationFrame(() => editButton.current?.focus());
              }}
              disabled={busy}
            >
              {m.ui.cancel}
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={openSettings} aria-label={m.ui.settings}>
              <SettingsIcon size={20} />
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" />
                <span aria-live="polite">{m.ui.stage[routeStatus] ?? m.ui.stage.routing}</span>
              </>
            ) : (
              m.ui.go
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Where to look up public-transport timetables when the app found none (its
 * open timetables don't cover every place): Google Maps' directions page,
 * opened only if the user taps the link.
 * A start that is "Your location" is left out, so Google uses theirs.
 */
export function transitTimetablesUrl(origin: PlaceField, destination: PlaceField): string {
  const text = (f: PlaceField) => (f.place?.kind === 'here' ? '' : f.place ? f.place.label || f.place.name : f.text.trim());
  const params = new URLSearchParams({ api: '1', travelmode: 'transit' });
  if (text(origin)) params.set('origin', text(origin));
  if (text(destination)) params.set('destination', text(destination));
  return `https://www.google.com/maps/dir/?${params}`;
}
