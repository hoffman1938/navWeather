import type { Locale } from '../i18n';
import { kaNumber, kaOrdinal, kaTime, POSTPOSITION_OF, withPostposition } from '../i18n/kaGrammar';
import { plural, type PluralForms } from '../i18n/plural';
import { latinToScript } from '../i18n/script';

/**
 * Text as a person would say it. Messages are written for the eye
 * ("60 км/ч", "12:55-ზე", "ул. Руставели", "-3°"); a voice given that text
 * spells out abbreviations, drops minus signs and reads slashes aloud. This
 * spells everything out first, in the grammar of the sentence.
 *
 * `natural` is for the on-device voice, which knows only one language's
 * sounds and reads through a pronunciation dictionary: Latin-script names
 * are rewritten in its script (browser voices read foreign names
 * themselves) and the few words its dictionary stresses wrongly are
 * rephrased.
 */
export function speakable(text: string, locale: Locale, opts: { natural?: boolean } = {}): string {
  if (locale === 'ru') return tidy(ru(text, !!opts.natural));
  if (locale === 'ka') return tidy(ka(text, !!opts.natural));
  return text;
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

/** Words the on-device voice's dictionary stresses wrongly, said another way ("с ко́льца" → "с круга"). */
const RU_REPHRASE: [RegExp, string][] = [[/(^|\s)(с|из) кольца(?![а-яё])/gi, '$1$2 круга']];

function ru(text: string, natural: boolean): string {
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
  if (natural) {
    t = latinToScript(t, 'ru');
    for (const [re, say] of RU_REPHRASE) t = t.replace(re, say);
  }
  // Road numbers: "С2" is said "эс два" (not the preposition "с").
  t = t.replace(/(^|[^А-Яа-яЁё])С-?(\d+)/g, '$1эс $2');
  return t;
}

// ─── Georgian ─────────────────────────────────────────────────────────────

const KA_SUFFIX = 'თან|ში|ზე|მდე|ის|ით|დან';
const KA_UNITS: Record<string, string> = {
  'კმ/სთ': 'კილომეტრი საათში',
  'მილი/სთ': 'მილი საათში',
  'მ/წმ': 'მეტრი წამში',
  კმ: 'კილომეტრი',
  მ: 'მეტრი',
  წთ: 'წუთი',
  სთ: 'საათი',
  ფტ: 'ფუტი',
  მმ: 'მილიმეტრი',
  კვტ: 'კილოვატი',
};

/** A word with an ending written after a hyphen: ("20", "ზე") → "ოცზე"; ("გრადუსი", "ია") → "გრადუსია". */
function kaWith(word: string, suffix?: string): string {
  if (!suffix) return word;
  if (suffix === 'ია') return /[აეიოუ]$/.test(word) ? `${word}ა` : `${word}ია`;
  return withPostposition(word, POSTPOSITION_OF[suffix]);
}

function ka(text: string, natural: boolean): string {
  let t = text;
  // "12:55-ზე" → "თორმეტ საათსა და ორმოცდათხუთმეტ წუთზე".
  t = t.replace(new RegExp(`(\\d{1,2}):(\\d{2})-(${KA_SUFFIX})`, 'g'), (_, h: string, m: string, s: string) =>
    kaTime(Number(h), Number(m), POSTPOSITION_OF[s]),
  );
  t = t.replace(MINUS, '$1მინუს ');
  t = t.replace(new RegExp(`(\\d+)\\s?°[CF]?(?:-(${KA_SUFFIX}|ია))?`, 'g'), (_, n: string, s?: string) => `${n} ${kaWith('გრადუსი', s)}`);
  t = t.replace(new RegExp(`(\\d+)\\s?%(?:-(${KA_SUFFIX}|ია))?`, 'g'), (_, n: string, s?: string) => `${n} ${kaWith('პროცენტი', s)}`);
  const units = Object.keys(KA_UNITS)
    .map((u) => u.replace('/', '\\/'))
    .join('|');
  t = t.replace(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(${units})(?:-(${KA_SUFFIX}|ია))?(?![ა-ჰ/])`, 'g'), (_, n: string, u: string, s?: string) => {
    const words = KA_UNITS[u].split(' ');
    words[words.length - 1] = kaWith(words[words.length - 1], s);
    return `${n} ${words.join(' ')}`;
  });
  // A number with an ending: "ს 2-ზე" → "ს ორზე", "მე-11" → "მეთერთმეტე".
  t = t.replace(/მე-(\d+)/g, (_, n: string) => kaOrdinal(Number(n)));
  t = t.replace(new RegExp(`(^|[^\\d.,])(\\d+)-(${KA_SUFFIX}|ია)`, 'g'), (_, pre: string, n: string, s: string) => {
    const gap = /[A-Za-zა-ჰ]$/.test(pre) ? ' ' : '';
    return `${pre}${gap}${kaWith(kaNumber(Number(n)), s)}`;
  });
  if (natural) {
    // "Khashuri-თან" → "ხაშურთან": transliterated, then declined like a Georgian name.
    t = t.replace(new RegExp(`([A-Za-z][A-Za-z'’]*(?:[ -][A-Za-z][A-Za-z'’]*)*)-(${KA_SUFFIX})`, 'g'), (_, name: string, s: string) =>
      withPostposition(latinToScript(name, 'ka'), POSTPOSITION_OF[s]),
    );
    t = latinToScript(t, 'ka');
  }
  return t;
}
