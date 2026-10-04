import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types/geo';
import { haversineM } from '../utils/distance';
import { countriesAlong, countryAt, decodeCountries, type CountriesFile } from './countries';
import file from './data/countries-v1.json';

const index = decodeCountries(file as CountriesFile);

/** A straight line a → b as a route: point at a distance along it. */
function line(a: LngLat, b: LngLat) {
  const total = haversineM(a, b);
  const at = (d: number): LngLat => {
    const t = Math.max(0, Math.min(1, d / total));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  return { total, at };
}

describe('countries from Natural Earth (DP-4.5)', () => {
  it('finds the country of a point, in the UI language; nothing at sea', () => {
    expect(countryAt(index, [44.79, 41.72])).toEqual({ code: 'GE', name: 'Georgia' }); // Tbilisi
    expect(countryAt(index, [41.64, 41.62], 'ru')).toEqual({ code: 'GE', name: 'Грузия' }); // Batumi
    expect(countryAt(index, [28.9, 41.05])?.code).toBe('TR'); // Istanbul, European side (the Golden Horn is water at this scale)
    expect(countryAt(index, [44.51, 40.18])?.code).toBe('AM'); // Yerevan
    expect(countryAt(index, [49.87, 40.41])?.code).toBe('AZ'); // Baku
    expect(countryAt(index, [2.35, 48.86])?.code).toBe('FR'); // Paris (no ISO_A2 in the source, ISO_A2_EH used)
    expect(countryAt(index, [35, 43])).toBeNull(); // Black Sea
    expect(index.countries.length).toBeGreaterThan(200);
  });

  it('places the Georgia → Armenia border on the Tbilisi → Yerevan road within a few km', () => {
    const { total, at } = line([44.79, 41.72], [44.51, 40.18]);
    const r = countriesAlong(index, at, total);
    expect(r.crossings).toHaveLength(1);
    const [c] = r.crossings;
    expect([c.from.code, c.to.code]).toEqual(['GE', 'AM']);
    // The border near Sadakhlo is at about 41.2° N.
    const [, lat] = at(c.alongM);
    expect(lat).toBeGreaterThan(41.1);
    expect(lat).toBeLessThan(41.3);
    expect(r.countries[0]?.code).toBe('GE');
    expect(r.countries.at(-1)?.code).toBe('AM');
  });

  it('a route that stays in one country has no crossings; points at sea are skipped, not borders', () => {
    const inland = line([44.79, 41.72], [42.7, 42.27]); // Tbilisi → Kutaisi
    expect(countriesAlong(index, inland.at, inland.total).crossings).toEqual([]);
    // Batumi → Poti across the bay: some points at sea, still Georgia on both ends.
    const coast = line([41.64, 41.65], [41.67, 42.15]);
    const r = countriesAlong(index, coast.at, coast.total);
    expect(r.crossings).toEqual([]);
  });
});
