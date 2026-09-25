import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { config } from '../../config';
import { isAbortError } from '../../services/http';
import { getProviders } from '../../services/providers';
import type { LngLat, Place } from '../../types/geo';
import { useMessages } from '../../state/settings';
import { LocateIcon, PinIcon } from '../Icons/Icons';

interface Props {
  label: string;
  value: string;
  place: Place | null;
  placeholder: string;
  icon: 'origin' | 'destination' | 'stop';
  inputRef?: RefObject<HTMLInputElement | null>;
  onChangeText(text: string): void;
  onSelect(place: Place): void;
  onSubmit(): void;
  onUseCurrentLocation?: () => void;
  near?: LngLat;
  autoFocus?: boolean;
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

  const showCurrent = !!onUseCurrentLocation && open && !place && value.trim().length === 0;
  const options: ({ kind: 'place'; place: Place } | { kind: 'current' })[] = [
    ...(showCurrent ? [{ kind: 'current' as const }] : []),
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
        {icon === 'destination' ? <PinIcon size={18} /> : <span className={`place-input__dot${icon === 'stop' ? ' is-stop' : ''}`} />}
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
              key={o.kind === 'current' ? 'current' : o.place.id}
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
