/**
 * Georgian place and street names for readers of other scripts.
 *
 * OpenStreetMap often has only the Georgian name (დაჩი უჯარმელის ქუჩა).
 * In the English and Russian UI such names are transliterated — the way
 * major map apps show them — using the Georgian national romanization
 * (2002, without apostrophes, as on road signs) or the customary Cyrillic
 * one. The street-type word is translated (ქუჩა → St / ул.) and road
 * numbers keep their letter as on signs (ს 12 → S12, შ 1 → Sh1).
 */

const GEORGIAN = /[ა-ჺ]/;

const LATIN: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o',
  პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts',
  ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};

const CYRILLIC: Record<string, string> = {
  ა: 'а', ბ: 'б', გ: 'г', დ: 'д', ე: 'е', ვ: 'в', ზ: 'з', თ: 'т', ი: 'и', კ: 'к', ლ: 'л', მ: 'м', ნ: 'н', ო: 'о',
  პ: 'п', ჟ: 'ж', რ: 'р', ს: 'с', ტ: 'т', უ: 'у', ფ: 'ф', ქ: 'к', ღ: 'г', ყ: 'к', შ: 'ш', ჩ: 'ч', ც: 'ц',
  ძ: 'дз', წ: 'ц', ჭ: 'ч', ხ: 'х', ჯ: 'дж', ჰ: 'х',
};

/** Street-type words: translated, and placed where each language expects them. */
const STREET_TYPES: Record<string, { en: string; ru: string }> = {
  ქუჩა: { en: 'St', ru: 'ул.' },
  გამზირი: { en: 'Ave', ru: 'пр.' },
  შესახვევი: { en: 'Ln', ru: 'пер.' },
  ჩიხი: { en: 'Dead End', ru: 'тупик' },
  მოედანი: { en: 'Sq', ru: 'пл.' },
  ხეივანი: { en: 'Alley', ru: 'аллея' },
  სანაპირო: { en: 'Embankment', ru: 'наб.' },
  გზატკეცილი: { en: 'Hwy', ru: 'шоссе' },
  აღმართი: { en: 'Rise', ru: 'подъём' },
  დასახლება: { en: 'Settlement', ru: 'посёлок' },
};

/** Road numbers: the letter as printed on signs. */
const ROAD_LETTER: Record<string, { en: string; ru: string }> = {
  ს: { en: 'S', ru: 'С' }, // international
  შ: { en: 'Sh', ru: 'Ш' }, // national
  ე: { en: 'E', ru: 'Е' },
};

type Target = 'en' | 'ru';

function word(w: string, table: Record<string, string>): string {
  let out = '';
  for (const ch of w) out += table[ch] ?? ch;
  // Georgian has no letter case: capitalise like a proper noun.
  return out ? out[0].toUpperCase() + out.slice(1) : out;
}

export function hasGeorgian(text: string): boolean {
  return GEORGIAN.test(text);
}

/** Transliterate Georgian script in `text` for the given UI language. */
export function localizeScript(text: string, locale: string): string {
  if (!text || !GEORGIAN.test(text)) return text;
  const target: Target = locale === 'ru' ? 'ru' : 'en';
  const table = target === 'ru' ? CYRILLIC : LATIN;

  // Road numbers: "ს 12", "შ-1", "ს12" → S12 / Sh1.
  let t = text.replace(/(^|[^ა-ჺ])([სშე])[\s-]?(\d+)/g, (_, pre: string, letter: string, num: string) => `${pre}${ROAD_LETTER[letter][target]}${num}`);

  const parts = t.split(/(\s+)/);
  let prefix = '';
  let suffix = '';
  const mapped = parts.map((p, i) => {
    if (!GEORGIAN.test(p)) return p;
    const type = STREET_TYPES[p];
    // A street-type word at the end of a name: translate and move it.
    if (type && i === parts.length - 1 && parts.length > 1) {
      if (target === 'ru') prefix = `${type.ru} `;
      else suffix = ` ${type.en}`;
      return '';
    }
    return word(p, table);
  });
  t = mapped.join('').trim();
  return `${prefix}${t}${suffix}`.replace(/\s{2,}/g, ' ');
}
