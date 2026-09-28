import { describe, expect, it } from 'vitest';
import { liveUrl, parseLiveUrl, parsePlaceUrl, placeUrl } from './links';

describe('place links', () => {
  it('round-trips a named place (coordinates rounded to ~1 m)', () => {
    const url = placeUrl({ id: 'x', name: 'Batumi Boulevard', label: 'Batumi', coordinate: [41.6367123, 41.6509876] }, 'https://nav.example');
    expect(url).toBe('https://nav.example/?p=41.65099%2C41.63671&n=Batumi+Boulevard');
    const p = parsePlaceUrl(new URL(url).search)!;
    expect(p.coordinate).toEqual([41.63671, 41.65099]);
    expect(p.name).toBe('Batumi Boulevard');
  });

  it('a dropped pin shares coordinates only', () => {
    const url = placeUrl({ id: 'pin', name: 'Dropped pin', label: '', coordinate: [44.8, 41.7], kind: 'pin' }, 'https://nav.example');
    expect(url).not.toContain('n=');
    expect(parsePlaceUrl(new URL(url).search)!.name).toBe('41.70000, 44.80000');
  });

  it('rejects malformed or out-of-range links', () => {
    expect(parsePlaceUrl('?p=91,10')).toBeNull();
    expect(parsePlaceUrl('?p=10,181')).toBeNull();
    expect(parsePlaceUrl('?p=abc')).toBeNull();
    expect(parsePlaceUrl('')).toBeNull();
    expect(parsePlaceUrl('?p=41.7,44.8&n=%3Cb%3Ex%3C/b%3E')!.name).toBe('<b>x</b>'); // rendered as text by React
  });
});

describe('live links', () => {
  it('only accepts well-formed share ids', () => {
    const id = 'AbCdEfGhIjKlMnOpQrSt_-';
    expect(parseLiveUrl(new URL(liveUrl(id, 'https://nav.example')).pathname)).toBe(id);
    expect(parseLiveUrl(`/live/${id}/`)).toBe(id);
    expect(parseLiveUrl('/live/short')).toBeNull();
    expect(parseLiveUrl('/live/../../etc')).toBeNull();
    expect(parseLiveUrl('/')).toBeNull();
  });
});
