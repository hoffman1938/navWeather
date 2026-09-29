import { describe, expect, it } from 'vitest';
import { speakable } from './speakable';

/** What the voice is given: written shorthand spelled out the way a person says it. */

describe('Russian', () => {
  const say = (t: string) => speakable(t, 'ru-RU');
  it('units, temperatures and percentages in words, in the right form', () => {
    expect(say('Впереди ограничение 60 км/ч.')).toBe('Впереди ограничение 60 километров в час.');
    expect(say('Сейчас там -3°, снег.')).toBe('Сейчас там минус 3 градуса, снег.');
    expect(say('Сейчас там 21°C, ясно.')).toBe('Сейчас там 21 градус, ясно.');
    expect(say('Вероятность 2%.')).toBe('Вероятность 2 процента.');
    expect(say('Через 5 км поверните.')).toBe('Через 5 километров поверните.');
    expect(say('Ветер 12 м/с.')).toBe('Ветер 12 метров в секунду.');
  });

  it('street types by the preposition before them', () => {
    expect(say('Поверните направо на ул. Руставели.')).toBe('Поверните направо на улицу Руставели.');
    expect(say('Начните движение по наб. Звиад Гамсахурдиас')).toBe('Начните движение по набережной Звиад Гамсахурдиас');
    expect(say('Вы на ул. Руставели, около Батуми.')).toBe('Вы на улице Руставели, около Батуми.');
    expect(say('Держитесь левее на пр. Чавчавадзе')).toBe('Держитесь левее на проспект Чавчавадзе');
  });

  it('road numbers and pauses', () => {
    expect(say('Вы на С2, около Чакви.')).toBe('Вы на эс 2, около Чакви.');
    expect(say('ДТП впереди (по сообщениям), примерно через 3 минуты.')).toBe('ДТП впереди, по сообщениям, примерно через 3 минуты.');
  });
});

it('English is left alone', () => {
  expect(speakable('Speed limit 60 km/h (reported).', 'en-US')).toBe('Speed limit 60 km/h (reported).');
});
