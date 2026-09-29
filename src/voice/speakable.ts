import { plural, type PluralForms } from '../i18n/plural';

/**
 * Text as a person would say it. Messages are written for the eye
 * ("60 км/ч", "ул. Руставели", "-3°"); a voice given that text may spell out
 * abbreviations, drop minus signs or read slashes aloud. This spells
 * everything out first, in the grammar of the sentence (Russian; English
 * voices read the English messages well as they are).
 */
export function speakable(text: string, lang: string): string {
  return lang.slice(0, 2).toLowerCase() === 'ru' ? tidy(ru(text)) : text;
}

/** Parentheses and middots become pauses; no doubled or dangling commas. */
function tidy(t: string): string {
  return t
    .replace(/\s*\(([^()]*)\)/g, ', $1,')
    .replace(/\s*·\s*/g, ', ')
    .replace(/,\s*(?=[,.!?;:—]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const MINUS = /(^|[\s(,:;])[-−–](?=\d)/g;

// ─── Russian ──────────────────────────────────────────────────────────────

const forms = (one: string, few: string, many: string): PluralForms => ({ one, few, many, other: few });
const RU = {
  km: forms('километр', 'километра', 'километров'),
  m: forms('метр', 'метра', 'метров'),
  mi: forms('миля', 'мили', 'миль'),
  min: forms('минуту', 'минуты', 'минут'),
  h: forms('час', 'часа', 'часов'),
  mm: forms('миллиметр', 'миллиметра', 'миллиметров'),
  kw: forms('киловатт', 'киловатта', 'киловатт'),
  deg: forms('градус', 'градуса', 'градусов'),
  pct: forms('процент', 'процента', 'процентов'),
};
const ruCount = (n: string, f: PluralForms) => `${n} ${plural(Number(n.replace(',', '.')), f, 'ru')}`;

/** Street types by case: nominative, accusative ("на улицу"), dative ("по улице"), prepositional ("на улице"), genitive. */
const RU_STREETS: Record<string, [string, string, string, string, string]> = {
  'ул.': ['улица', 'улицу', 'улице', 'улице', 'улицы'],
  'пр.': ['проспект', 'проспект', 'проспекту', 'проспекте', 'проспекта'],
  'просп.': ['проспект', 'проспект', 'проспекту', 'проспекте', 'проспекта'],
  'пер.': ['переулок', 'переулок', 'переулку', 'переулке', 'переулка'],
  'пл.': ['площадь', 'площадь', 'площади', 'площади', 'площади'],
  'наб.': ['набережная', 'набережную', 'набережной', 'набережной', 'набережной'],
};

function ruStreetCase(before: string): number {
  if (/(^|\s)(вы|я|мы)\s+(на|в)\s+$/i.test(before)) return 3; // "Вы на улице"
  if (/(^|\s)(на|в)\s+$/i.test(before)) return 1; // "поверните на улицу"
  if (/(^|\s)по\s+$/i.test(before)) return 2;
  if (/(^|\s)(до|около|от|с|у|направлении|конца)\s+$/i.test(before)) return 4;
  return 0;
}

function ru(text: string): string {
  let t = text.replace(MINUS, '$1минус ');
  t = t.replace(/(\d+)\s?°(?:\s?[CСF](?![A-Za-zА-Яа-яЁё]))?/g, (_, n: string) => ruCount(n, RU.deg));
  t = t.replace(/(\d+)\s?%/g, (_, n: string) => ruCount(n, RU.pct));
  t = t.replace(/(\d+)\s?км\/ч/g, (_, n: string) => `${ruCount(n, RU.km)} в час`);
  t = t.replace(/(\d+)\s?миль\/ч/g, (_, n: string) => `${ruCount(n, RU.mi)} в час`);
  t = t.replace(/(\d+)\s?м\/с/g, (_, n: string) => `${ruCount(n, RU.m)} в секунду`);
  t = t.replace(/(\d+(?:,\d+)?)\s?(км|мм|м|мин|ч|кВт)\.?(?![а-яёА-ЯЁ/])/g, (_, n: string, u: string) =>
    ruCount(n, u === 'км' ? RU.km : u === 'мм' ? RU.mm : u === 'м' ? RU.m : u === 'мин' ? RU.min : u === 'ч' ? RU.h : RU.kw),
  );
  // Street types: "поверните на ул. Руставели" → "на улицу Руставели".
  t = t.replace(/(^|[\s,(])(ул\.|просп\.|пр\.|пер\.|пл\.|наб\.)\s*/g, (_all, pre: string, abbr: string, offset: number) => {
    const before = t.slice(0, offset) + pre;
    return `${pre}${RU_STREETS[abbr][ruStreetCase(before)]} `;
  });
  // Road numbers: "С2" is said "эс два" (not the preposition "с").
  t = t.replace(/(^|[^А-Яа-яЁё])С-?(\d+)/g, '$1эс $2');
  return t;
}
