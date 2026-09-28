import { create } from 'zustand';
import type { Place } from '../types/geo';

/**
 * Saved places (Home, Work, favourites) and recent destinations — on this
 * device only (localStorage), never sent anywhere. Recents can be switched
 * off and cleared in Settings; only destinations the user chose are kept,
 * never positions.
 */

export type SavedSlot = 'home' | 'work' | 'favorite';

interface SavedPlace extends Place {
  slot: SavedSlot;
}

interface Persisted {
  saved: SavedPlace[];
  recents: Place[];
  rememberRecents: boolean;
}

export interface SavedPlacesState extends Persisted {
  save(place: Place, slot: SavedSlot): void;
  remove(placeId: string, slot?: SavedSlot): void;
  slotsOf(place: Place): SavedSlot[];
  addRecent(place: Place): void;
  clearRecents(): void;
  setRememberRecents(on: boolean): void;
}

const KEY = 'navweather.places.v1';
const MAX_RECENTS = 8;
const MAX_FAVORITES = 30;

/** Same spot ≈ within ~10 m (5 decimals). */
export function sameSpot(a: Place, b: Place): boolean {
  return a.coordinate[0].toFixed(4) === b.coordinate[0].toFixed(4) && a.coordinate[1].toFixed(4) === b.coordinate[1].toFixed(4);
}

/** Only what's needed to show and route to a place. */
function slim(p: Place): Place {
  return { id: p.id, name: p.name, label: p.label, coordinate: [Number(p.coordinate[0].toFixed(6)), Number(p.coordinate[1].toFixed(6))], kind: p.kind };
}

function valid(p: unknown): p is Place {
  const x = p as Place;
  return !!x && typeof x.name === 'string' && Array.isArray(x.coordinate) && x.coordinate.length === 2 && x.coordinate.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function load(): Persisted {
  const empty: Persisted = { saved: [], recents: [], rememberRecents: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const d = JSON.parse(raw) as Partial<Persisted>;
    return {
      saved: (d.saved ?? []).filter((p): p is SavedPlace => valid(p) && ['home', 'work', 'favorite'].includes((p as SavedPlace).slot)),
      recents: (d.recents ?? []).filter(valid).slice(0, MAX_RECENTS),
      rememberRecents: d.rememberRecents !== false,
    };
  } catch {
    return empty;
  }
}

function persist(s: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ saved: s.saved, recents: s.recents, rememberRecents: s.rememberRecents }));
  } catch {
    /* storage blocked: keep working for this session */
  }
}

export const useSavedPlaces = create<SavedPlacesState>()((set, get) => {
  const commit = (patch: Partial<Persisted>) => {
    set(patch);
    persist(get());
  };
  return {
    ...load(),

    save(place, slot) {
      const p = { ...slim(place), slot };
      let saved = get().saved;
      // Home and Work are single slots; a favourite is saved once per spot.
      saved = slot === 'favorite' ? saved.filter((s) => !(s.slot === 'favorite' && sameSpot(s, p))) : saved.filter((s) => s.slot !== slot);
      commit({ saved: [p, ...saved].slice(0, MAX_FAVORITES + 2) });
    },

    remove(placeId, slot) {
      commit({ saved: get().saved.filter((s) => !(s.id === placeId && (!slot || s.slot === slot))) });
    },

    slotsOf(place) {
      return get()
        .saved.filter((s) => sameSpot(s, place))
        .map((s) => s.slot);
    },

    addRecent(place) {
      if (!get().rememberRecents || place.kind === 'here' || place.kind === 'me') return;
      const p = slim(place);
      commit({ recents: [p, ...get().recents.filter((r) => !sameSpot(r, p))].slice(0, MAX_RECENTS) });
    },

    clearRecents: () => commit({ recents: [] }),

    setRememberRecents(on) {
      commit({ rememberRecents: on, ...(on ? {} : { recents: [] }) });
    },
  };
});

/** Suggestions for an empty search field: Home, Work, favourites, then recent destinations. */
export function quickPlaces(): { place: Place; slot: SavedSlot | 'recent' }[] {
  const { saved, recents } = useSavedPlaces.getState();
  const order: SavedSlot[] = ['home', 'work', 'favorite'];
  const out: { place: Place; slot: SavedSlot | 'recent' }[] = [...saved]
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))
    .map((s) => ({ place: s, slot: s.slot }));
  for (const r of recents) if (!out.some((o) => sameSpot(o.place, r))) out.push({ place: r, slot: 'recent' });
  return out.slice(0, 8);
}
