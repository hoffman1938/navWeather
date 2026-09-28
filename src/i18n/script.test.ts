import { describe, expect, it } from 'vitest';
import { withPostposition } from './ka';
import { localizeScript } from './script';

describe('Georgian names in other scripts', () => {
  it('English: national romanization, street type translated', () => {
    expect(localizeScript('დაჩი უჯარმელის ქუჩა', 'en')).toBe('Dachi Ujarmelis St');
    expect(localizeScript('რუსთაველის გამზირი', 'en')).toBe('Rustavelis Ave');
    expect(localizeScript('ხაშური', 'en')).toBe('Khashuri');
    expect(localizeScript('ქუთაისი', 'en')).toBe('Kutaisi');
    expect(localizeScript('წყალტუბო', 'en')).toBe('Tsqaltubo');
  });

  it('Russian: customary Cyrillic, type word first', () => {
    expect(localizeScript('დაჩი უჯარმელის ქუჩა', 'ru')).toBe('ул. Дачи Уджармелис');
    expect(localizeScript('ზესტაფონი', 'ru')).toBe('Зестафони');
  });

  it('road numbers keep their sign letter', () => {
    expect(localizeScript('ს 12', 'en')).toBe('S12');
    expect(localizeScript('შ-1', 'en')).toBe('Sh1');
    expect(localizeScript('ს1', 'ru')).toBe('С1');
    expect(localizeScript('Turn right onto ს 12', 'en')).toBe('Turn right onto S12');
  });

  it('leaves Georgian UI and non-Georgian text alone', () => {
    expect(localizeScript('დაჩი უჯარმელის ქუჩა', 'ka')).toBe('დაჩი უჯარმელის ქუჩა');
    expect(localizeScript('Batumi Boulevard', 'en')).toBe('Batumi Boulevard');
    expect(localizeScript('', 'en')).toBe('');
  });
});

describe('Georgian postpositions follow case rules', () => {
  it('consonant stems drop the nominative -ი', () => {
    expect(withPostposition('ხაშური', 'tan')).toBe('ხაშურთან');
    expect(withPostposition('ბათუმი', 'shi')).toBe('ბათუმში');
    expect(withPostposition('ბათუმი', 'mde')).toBe('ბათუმამდე');
    expect(withPostposition('ქუთაისი', 'is')).toBe('ქუთაისის');
  });
  it('vowel stems', () => {
    expect(withPostposition('სამტრედია', 'tan')).toBe('სამტრედიასთან');
    expect(withPostposition('სამტრედია', 'shi')).toBe('სამტრედიაში');
    expect(withPostposition('სამტრედია', 'is')).toBe('სამტრედიის');
  });
  it('numbers, abbreviations and Latin names keep the hyphen', () => {
    expect(withPostposition('ს 12', 'ze')).toBe('ს 12-ზე');
    expect(withPostposition('Khunevi', 'tan')).toBe('Khunevi-თან');
  });
});
