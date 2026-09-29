import { beforeEach, describe, expect, it } from 'vitest';
import { quickPlaces, useSavedPlaces } from './savedPlaces';

const tbilisi = { id: 't', name: 'Tbilisi', label: 'Tbilisi, Georgia', coordinate: [44.793, 41.7151] as [number, number] };
const batumi = { id: 'b', name: 'Batumi', label: 'Batumi, Georgia', coordinate: [41.6367, 41.6509] as [number, number] };
const gori = { id: 'g', name: 'Gori', label: 'Gori', coordinate: [44.1128, 41.9842] as [number, number] };

beforeEach(() => {
  localStorage.clear();
  useSavedPlaces.setState({ saved: [], recents: [], rememberRecents: true });
});

describe('saved places and recents (this device only)', () => {
  it('home/work are single slots; favourites are deduplicated; all persist locally', () => {
    const s = useSavedPlaces.getState();
    s.save(tbilisi, 'home');
    s.save(gori, 'home'); // replaces
    s.save(batumi, 'favorite');
    s.save({ ...batumi, id: 'b2' }, 'favorite'); // same spot
    expect(useSavedPlaces.getState().saved.map((p) => `${p.slot}:${p.name}`)).toEqual(['favorite:Batumi', 'home:Gori']);
    expect(JSON.parse(localStorage.getItem('navweather.places.v1')!).saved).toHaveLength(2);
    expect(useSavedPlaces.getState().slotsOf(batumi)).toEqual(['favorite']);
  });

  it('toggling a favourite off removes that place only (not the first favourite in the list)', () => {
    const s = useSavedPlaces.getState();
    s.save(tbilisi, 'favorite');
    s.save(batumi, 'favorite');
    s.save(gori, 'home');
    useSavedPlaces.getState().toggle(tbilisi, 'favorite'); // tbilisi is the older (second) favourite
    expect(useSavedPlaces.getState().saved.map((p) => `${p.slot}:${p.name}`)).toEqual(['home:Gori', 'favorite:Batumi']);
    useSavedPlaces.getState().toggle(gori, 'favorite'); // on
    expect(useSavedPlaces.getState().slotsOf(gori).sort()).toEqual(['favorite', 'home']);
    useSavedPlaces.getState().toggle(gori, 'home'); // off, favourite stays
    expect(useSavedPlaces.getState().slotsOf(gori)).toEqual(['favorite']);
  });

  it('recents: newest first, no duplicates, never "your location"; turning off clears them', () => {
    const s = useSavedPlaces.getState();
    s.addRecent(gori);
    s.addRecent(batumi);
    s.addRecent({ ...gori, id: 'g2' });
    s.addRecent({ id: 'here', name: 'Your location', label: '', coordinate: [44, 41], kind: 'here' });
    expect(useSavedPlaces.getState().recents.map((p) => p.name)).toEqual(['Gori', 'Batumi']);
    s.setRememberRecents(false);
    expect(useSavedPlaces.getState().recents).toEqual([]);
    s.addRecent(tbilisi);
    expect(useSavedPlaces.getState().recents).toEqual([]);
  });

  it('suggestions: home, work, favourites, then recents not already saved', () => {
    const s = useSavedPlaces.getState();
    s.addRecent(batumi);
    s.addRecent(gori);
    s.save(batumi, 'favorite');
    s.save(tbilisi, 'work');
    expect(quickPlaces().map((q) => `${q.slot}:${q.place.name}`)).toEqual(['work:Tbilisi', 'favorite:Batumi', 'recent:Gori']);
  });
});

describe('parking spot', () => {
  it('one spot at a time, offered first in suggestions', () => {
    const s = useSavedPlaces.getState();
    s.save(batumi, 'favorite');
    s.save({ ...gori, kind: 'parking' }, 'parking');
    s.save({ ...tbilisi, kind: 'parking' }, 'parking');
    expect(useSavedPlaces.getState().saved.filter((p) => p.slot === 'parking').map((p) => p.name)).toEqual(['Tbilisi']);
    expect(quickPlaces()[0]).toMatchObject({ slot: 'parking' });
  });
});
