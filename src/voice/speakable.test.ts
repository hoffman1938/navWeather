import { describe, expect, it } from 'vitest';
import { kaNumber, kaOrdinal, kaTime } from '../i18n/kaGrammar';
import { latinToScript } from '../i18n/script';
import { speakable } from './speakable';

/** What the voice is given: written shorthand spelled out the way a person says it. */

describe('Russian', () => {
  const say = (t: string) => speakable(t, 'ru');
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

  it('the on-device voice: Latin names in Cyrillic, and "с кольца" said "с круга" (its dictionary stresses ко́льца)', () => {
    const natural = (t: string) => speakable(t, 'ru', { natural: true });
    expect(natural('Маршрут до Batumi. Вероятен дождь около Khashuri.')).toBe('Маршрут до Батуми. Вероятен дождь около Хашури.');
    expect(natural('Вы на S12.')).toBe('Вы на эс 12.');
    expect(natural('Съезжайте с кольца на улицу Руставели.')).toBe('Съезжайте с круга на улицу Руставели.');
    // Browser voices read names themselves.
    expect(say('Маршрут до Batumi.')).toBe('Маршрут до Batumi.');
  });
});

describe('Georgian', () => {
  const say = (t: string) => speakable(t, 'ka');
  it('times with an ending, as they are read', () => {
    expect(say('ჩახვალთ 12:55-ზე, 20 წუთში.')).toBe('ჩახვალთ თორმეტ საათსა და ორმოცდათხუთმეტ წუთზე, 20 წუთში.');
    expect(say('ჩახვალთ 13:00-ზე.')).toBe('ჩახვალთ ცამეტ საათზე.');
  });

  it('units, temperatures, numbers with endings, ordinals', () => {
    expect(say('წინ სიჩქარის ლიმიტია 60 კმ/სთ.')).toBe('წინ სიჩქარის ლიმიტია 60 კილომეტრი საათში.');
    expect(say('ახლა იქ -3°-ია, თოვლი.')).toBe('ახლა იქ მინუს 3 გრადუსია, თოვლი.');
    expect(say('ხართ ს 2-ზე.')).toBe('ხართ ს ორზე.');
    expect(say('გადით მე-11 გასასვლელზე')).toBe('გადით მეთერთმეტე გასასვლელზე');
    expect(say('5 კმ-ში')).toBe('5 კილომეტრში');
  });

  it('the on-device voice: Latin names in Georgian script, declined', () => {
    const natural = (t: string) => speakable(t, 'ka', { natural: true });
    expect(natural('Batumi-მდე 16 კილომეტრია.')).toBe('ბათუმამდე 16 კილომეტრია.');
    expect(natural('ხართ S12-ზე, Chakvi-თან ახლოს.')).toBe('ხართ ს თორმეტზე, ჩაქვთან ახლოს.');
  });
});

it('English is left alone', () => {
  expect(speakable('Speed limit 60 km/h (reported).', 'en')).toBe('Speed limit 60 km/h (reported).');
});

describe('Georgian numbers', () => {
  it('count by twenties', () => {
    expect([0, 8, 19, 20, 21, 40, 55, 79, 99].map(kaNumber)).toEqual([
      'ნული', 'რვა', 'ცხრამეტი', 'ოცი', 'ოცდაერთი', 'ორმოცი', 'ორმოცდათხუთმეტი', 'სამოცდაცხრამეტი', 'ოთხმოცდაცხრამეტი',
    ]);
    expect(kaNumber(125)).toBe('ას ოცდახუთი');
    expect(kaNumber(800)).toBe('რვაასი');
    expect(kaNumber(1500)).toBe('ათას ხუთასი');
    expect(kaNumber(2000)).toBe('ორი ათასი');
  });
  it('times and ordinals', () => {
    expect(kaTime(9, 5, 'mde')).toBe('ცხრა საათსა და ხუთ წუთამდე');
    expect(kaOrdinal(2)).toBe('მეორე');
    expect(kaOrdinal(8)).toBe('მერვე');
    expect(kaOrdinal(20)).toBe('მეოცე');
  });
});

describe('Latin names in the voice’s script', () => {
  it('Georgian romanization read back', () => {
    expect(latinToScript('Mtskheta, Kutaisi, Kobuleti', 'ru')).toBe('Мцхета, Кутаиси, Кобулети');
    expect(latinToScript('Mtskheta, Kutaisi, Wissol', 'ka')).toBe('მცხეთა, ქუთაისი, ვისოლ');
    expect(latinToScript("Tsqaltubo, K'obuleti", 'ka')).toBe('ცყალთუბო, კობულეთი');
  });
  it('keeps capitals and abbreviations; leaves other scripts alone', () => {
    expect(latinToScript('SOCAR и Gulf', 'ru')).toBe('СОКАР и Гулф');
    expect(latinToScript('ბათუმი 12', 'ka')).toBe('ბათუმი 12');
  });
});
