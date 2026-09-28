import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { config } from '../../config';
import { isAbortError } from '../../services/http';
import { getProviders } from '../../services/providers';
import type { LngLat, Place } from '../../types/geo';
import { useMessages } from '../../state/settings';
import { quickPlaces, useSavedPlaces, type SavedSlot } from '../../state/savedPlaces';
import { ClockIcon, HomeIcon, LocateIcon, PinIcon, SearchIcon, StarIcon, WorkIcon } from '../Icons/Icons';

interface Props {
  label: string;
  value: string;
  place: Place | null;
  placeholder: string;
  icon: 'origin' | 'destination' | 'stop' | 'search';
  inputRef?: RefObject<HTMLInputElement | null>;
  onChangeText(text: string): void;
  onSelect(place: Place): void;
  onSubmit(): void;
  onUseCurrentLocation?: () => void;
  near?: LngLat;
  autoFocus?: boolean;
  /** Offer saved places and recent destinations while the field is empty. */
  quick?: boolean;
}

/** Autocomplete input following the WAI-ARIA combobox pattern. */
export function PlaceInput(props: Props) {
  const { label, value, place, placeholder, icon, onChangeText, onSelect, onSubmit, onUseCurrentLocation, near } = props;
  const m = useMessages();
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Place[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = props.inputRef ?? ownRef;
  const nearRef = useRef(near);
  nearRef.current = near;
  const langRef = useRef(m.locale);
  langRef.current = m.locale;

  // Debounced, abortable suggestions — only while the user is typing.
  useEffect(() => {
    if (place || value.trim().length < 2 || !open) {
      setItems([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await getProviders().autocomplete.suggest(value, {
          signal: ctrl.signal,
          near: nearRef.current,
          language: langRef.current,
        });
        setItems(res);
        setActive(res.length ? 0 : -1);
      } catch (e) {
        if (!isAbortError(e)) setItems([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, config.geocoding.autocompleteDebounceMs);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [value, place, open]);

  const empty = open && !place && value.trim().length === 0;
  const showCurrent = !!onUseCurrentLocation && empty;
  useSavedPlaces((st) => st.saved.length + st.recents.length); // re-render when saved places change
  const quick = props.quick && empty ? quickPlaces() : [];
  const options: ({ kind: 'place'; place: Place } | { kind: 'current' } | { kind: 'quick'; place: Place; slot: SavedSlot | 'recent' })[] = [
    ...(showCurrent ? [{ kind: 'current' as const }] : []),
    ...quick.map((q) => ({ kind: 'quick' as const, place: q.place, slot: q.slot })),
    ...items.map((p) => ({ kind: 'place' as const, place: p })),
  ];
  const expanded = open && options.length > 0;

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'current') onUseCurrentLocation?.();
    else onSelect(o.place);
    setOpen(false);
    setItems([]);
  };

  return (
    <div className="place-input">
      <span className={`place-input__icon place-input__icon--${icon}`} aria-hidden="true">
        {icon === 'destination' ? (
          <PinIcon size={18} />
        ) : icon === 'search' ? (
          <SearchIcon size={18} />
        ) : (
          <span className={`place-input__dot${icon === 'stop' ? ' is-stop' : ''}`} />
        )}
      </span>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="place-input__field"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        placeholder={placeholder}
        value={value}
        autoFocus={props.autoFocus}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && expanded) {
            e.preventDefault();
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === 'ArrowUp' && expanded) {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (expanded && active >= 0) choose(active);
            else {
              setOpen(false);
              onSubmit();
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {loading && open ? <span className="spinner place-input__spinner" aria-hidden="true" /> : null}
      {expanded ? (
        <ul className="suggestions" id={listId} role="listbox" aria-label={m.ui.suggestions(label)}>
          {options.map((o, i) => (
            <li
              key={o.kind === 'current' ? 'current' : `${o.kind}:${o.place.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`suggestion${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.kind === 'current' ? (
                <>
                  <LocateIcon size={18} className="suggestion__icon suggestion__icon--accent" />
                  <span className="suggestion__name">{m.ui.currentLocation}</span>
                </>
              ) : o.kind === 'quick' ? (
                <>
                  {o.slot === 'home' ? (
                    <HomeIcon size={18} className="suggestion__icon suggestion__icon--accent" />
                  ) : o.slot === 'work' ? (
                    <WorkIcon size={18} className="suggestion__icon suggestion__icon--accent" />
                  ) : o.slot === 'favorite' ? (
                    <StarIcon size={18} filled className="suggestion__icon suggestion__icon--accent" />
                  ) : (
                    <ClockIcon size={18} className="suggestion__icon" />
                  )}
                  <span className="suggestion__text">
                    <span className="suggestion__name">{o.slot === 'home' ? m.explore.home : o.slot === 'work' ? m.explore.work : o.place.name}</span>
                    <span className="suggestion__label">{o.slot === 'home' || o.slot === 'work' ? o.place.name : o.place.label && o.place.label !== o.place.name ? o.place.label.replace(`${o.place.name}, `, '') : ''}</span>
                  </span>
                </>
              ) : (
                <>
                  <PinIcon size={18} className="suggestion__icon" />
                  <span className="suggestion__text">
                    <span className="suggestion__name">{o.place.name}</span>
                    {o.place.label !== o.place.name ? (
                      <span className="suggestion__label">{o.place.label.replace(`${o.place.name}, `, '')}</span>
                    ) : null}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
