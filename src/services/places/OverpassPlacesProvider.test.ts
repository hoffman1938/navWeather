import { describe, expect, it } from 'vitest';
import { parseOverpassElements } from './OverpassPlacesProvider';

/** Town names along the route ("near Khashuri") in the UI language's script. */

const town = (id: number, tags: Record<string, string>) => ({ type: 'node', id, lat: 42, lon: 44, tags: { place: 'town', ...tags } });
const names = (lang: string) =>
  parseOverpassElements(
    [
      town(1, { name: 'ხაშური', 'name:en': 'Khashuri', 'name:ru': 'Хашури' }),
      town(2, { name: 'ხუნევი', 'name:en': 'Khunevi' }),
      town(3, { 'name:en': 'Nowhere' }),
    ] as never,
    lang,
  ).map((p) => p.name);

describe('place names', () => {
  it('Russian: its own name, else the Georgian name in Cyrillic (not the English one)', () => {
    expect(names('ru')).toEqual(['Хашури', 'Хуневи', 'Nowhere']);
  });
  it('Georgian and English', () => {
    expect(names('ka')).toEqual(['ხაშური', 'ხუნევი', 'Nowhere']);
    expect(names('en')).toEqual(['Khashuri', 'Khunevi', 'Nowhere']);
  });
});
