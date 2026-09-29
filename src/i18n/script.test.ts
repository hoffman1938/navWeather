import { describe, expect, it } from 'vitest';
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

  it('leaves non-Georgian text alone', () => {
    expect(localizeScript('Batumi Boulevard', 'en')).toBe('Batumi Boulevard');
    expect(localizeScript('', 'en')).toBe('');
  });
});
