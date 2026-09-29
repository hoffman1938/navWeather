import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ka } from './ka';
import { ru } from './ru';

describe('message grammar', () => {
  it('Russian: verb agrees with one or several hazards', () => {
    expect(ru.alert.voice.combined(['Дождь'], 'через 20 минут')).toBe('Дождь ожидается впереди через 20 минут.');
    expect(ru.alert.voice.combined(['Грозы'], 'через 20 минут')).toBe('Грозы ожидаются впереди через 20 минут.');
    expect(ru.alert.voice.combined(['Дождь', 'Туман'], 'через 20 минут')).toBe('Дождь и туман ожидаются впереди через 20 минут.');
    expect(en.alert.voice.combined(['Rain'], 'about 20 minutes')).toBe('Rain is expected ahead in about 20 minutes.');
  });

  it('Russian: spoken ETA says "через" exactly once', () => {
    expect(ru.assistant.eta('13:00', '4 часа 50 минут')).toBe('Прибытие в 13:00, через 4 часа 50 минут.');
    expect(ru.assistant.eta('13:00', ru.time.aFewMinutes)).toBe('Прибытие в 13:00, через несколько минут.');
  });

  it('confirmed reports: number agreement', () => {
    expect(ru.alert.reportConfirmed(1)).toBe('По сообщениям · подтвердил 1 водитель');
    expect(ru.alert.reportConfirmed(2)).toBe('По сообщениям · подтвердили 2 водителя');
    expect(ru.alert.reportConfirmed(5)).toBe('По сообщениям · подтвердили 5 водителей');
    expect(ru.alert.reportConfirmed(21)).toBe('По сообщениям · подтвердил 21 водитель');
    expect(en.alert.reportConfirmed(1)).toBe('Reported · 1 driver confirmed');
    expect(en.alert.reportConfirmed(3)).toBe('Reported · 3 drivers confirmed');
    // Georgian nouns stay singular after numerals.
    expect(ka.alert.reportConfirmed(3)).toBe('შეტყობინება · დაადასტურა 3 მძღოლმა');
  });

  it('every report kind has a name and a hint in every language', () => {
    for (const m of [en, ka, ru]) {
      for (const k of ['accident', 'hazard', 'roadworks', 'closure', 'weather']) {
        expect(m.reports.kinds[k]).toBeTruthy();
        expect(m.reports.hints[k]).toBeTruthy();
      }
    }
  });
});
