import { describe, expect, it } from 'vitest';
import { ftsQuery, parseNear, rerank, type GeoRow } from './geocode';

const row = (p: Partial<GeoRow>): GeoRow => ({
  id: 'n1',
  kind: 'city',
  rank: 10,
  lat: 41.7,
  lon: 44.8,
  name_en: 'X',
  name_ru: 'Х',
  ctx_en: 'Georgia',
  ctx_ru: 'Грузия',
  s: -5,
  ...p,
});

describe('our geocoder: query and ranking (DP-4.4)', () => {
  it('turns the text into FTS5 prefix terms — letters and digits only, nothing of the MATCH syntax gets through', () => {
    expect(ftsQuery('Rustaveli 12, Tbilisi')).toBe('"rustaveli"* "12"* "tbilisi"*');
    expect(ftsQuery('Кутаиси')).toBe('"кутаиси"*');
    expect(ftsQuery('ქუთაისი')).toBe('"ქუთაისი"*');
    expect(ftsQuery('a" OR name:* NEAR(x')).toBe('"a" "or"* "name"* "near"* "x"'); // quoted: OR, NEAR, : are words, not operators
    expect(ftsQuery('x')).toBeNull();
    expect(ftsQuery('  ,.;  ')).toBeNull();
    expect(ftsQuery('one two three four five six seven')!.split(' ')).toHaveLength(6);
  });

  it('reads `near` only as two valid numbers', () => {
    expect(parseNear('44.8,41.7')).toEqual([44.8, 41.7]);
    expect(parseNear('200,41')).toBeNull();
    expect(parseNear('44.8;41.7')).toBeNull();
    expect(parseNear(null)).toBeNull();
  });

  it('a name that starts with the query, bigger places and closer ones come first; labels in the UI language', () => {
    // Ranks as the pipeline gives them: a place in Tbilisi 6 + 36 × 0.08, a Kutaisi street 5 + 35 × 0.25.
    const rows = [
      row({ id: 'n1', kind: 'restaurant', rank: 8.9, name_en: 'Batumi Grill', name_ru: 'Батуми Гриль', ctx_en: 'Tbilisi', ctx_ru: 'Тбилиси', s: -9 }),
      row({ id: 'n2', kind: 'city', rank: 35, name_en: 'Batumi', name_ru: 'Батуми', lat: 41.65, lon: 41.64, s: -8 }),
      row({ id: 'n3', kind: 'street', rank: 13.75, name_en: 'Batumi Street', name_ru: 'ул. Батуми', ctx_en: 'Kutaisi', ctx_ru: 'Кутаиси', s: -8.5 }),
    ];
    const en = rerank(rows, 'Batumi', null, 'en', 5);
    expect(en.map((p) => p.label)).toEqual(['Batumi, Georgia', 'Batumi Street, Kutaisi', 'Batumi Grill, Tbilisi']);
    expect(en[0]).toEqual({ id: 'osm:n2', name: 'Batumi', label: 'Batumi, Georgia', coordinate: [41.64, 41.65], kind: 'city' });
    expect(en[2].kind).toBe('poi');
    expect(rerank(rows, 'Батуми', null, 'ru', 1)[0].label).toBe('Батуми, Грузия');
    // Near Kutaisi, the Kutaisi street moves up past the far restaurant… but not past the city itself.
    const near = rerank(rows, 'Batumi', [42.7, 42.27], 'en', 5).map((p) => p.id);
    expect(near.indexOf('osm:n3')).toBeLessThan(near.indexOf('osm:n1'));
  });

  it('the same label twice is shown once', () => {
    const rows = [row({ id: 'n1', name_en: 'Gori', ctx_en: 'Georgia' }), row({ id: 'w2', kind: 'town', name_en: 'Gori', ctx_en: 'Georgia' })];
    expect(rerank(rows, 'gori', null, 'en', 5)).toHaveLength(1);
  });
});
