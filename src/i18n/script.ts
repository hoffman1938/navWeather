/**
 * Georgian place and street names for readers of other scripts.
 *
 * OpenStreetMap often has only the Georgian name (დაჩი უჯარმელის ქუჩა).
 * In the English and Russian UI such names are transliterated — the way
 * major map apps show them — using the Georgian national romanization
 * (2002, without apostrophes, as on road signs) or the customary Cyrillic
 * one. The street-type word is translated (ქუჩა → St / ул.) and road
 * numbers keep their letter as on signs (ს 12 → S12, შ 1 → Sh1).
 * The Georgian UI shows names untouched.
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

/** Transliterate Georgian script in `text` for the given UI language ("ka" leaves it as is). */
export function localizeScript(text: string, locale: string): string {
  if (!text || locale === 'ka' || !GEORGIAN.test(text)) return text;
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

/*
 * Latin-script names for a Russian or Georgian voice ("Khashuri" → Хашури /
 * ხაშური). A voice made for one language reads another script with foreign
 * sounds — or not at all — so names are said the way locals say them. The
 * digraphs are the Georgian national romanization's, read backwards;
 * apostrophes mark its ejectives (k' → კ).
 */
const FROM_LATIN: Record<'ru' | 'ka', [string, string][]> = {
  ru: [
    ["ch'", 'ч'], ["ts'", 'ц'], ['kh', 'х'], ['gh', 'г'], ['sh', 'ш'], ['ch', 'ч'], ['ts', 'ц'], ['dz', 'дз'], ['zh', 'ж'],
    ['ph', 'ф'], ['th', 'т'], ['ck', 'к'], ['qu', 'кв'], ['ee', 'и'], ['oo', 'у'], ['ya', 'я'], ['yu', 'ю'], ['yo', 'йо'],
    ['a', 'а'], ['b', 'б'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'дж'], ['k', 'к'],
    ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'],
    ['v', 'в'], ['w', 'в'], ['x', 'кс'], ['z', 'з'],
  ],
  ka: [
    ["ch'", 'ჭ'], ["ts'", 'წ'], ["k'", 'კ'], ["t'", 'ტ'], ["p'", 'პ'], ["q'", 'ყ'], ['kh', 'ხ'], ['gh', 'ღ'], ['sh', 'შ'],
    ['ch', 'ჩ'], ['ts', 'ც'], ['dz', 'ძ'], ['zh', 'ჟ'], ['ph', 'ფ'], ['th', 'თ'], ['ck', 'ქ'], ['qu', 'ქვ'], ['ee', 'ი'],
    ['oo', 'უ'], ['a', 'ა'], ['b', 'ბ'], ['d', 'დ'], ['e', 'ე'], ['f', 'ფ'], ['g', 'გ'], ['h', 'ჰ'], ['i', 'ი'], ['j', 'ჯ'],
    ['k', 'ქ'], ['l', 'ლ'], ['m', 'მ'], ['n', 'ნ'], ['o', 'ო'], ['p', 'ფ'], ['q', 'ყ'], ['r', 'რ'], ['s', 'ს'], ['t', 'თ'],
    ['u', 'უ'], ['v', 'ვ'], ['w', 'ვ'], ['x', 'ქს'], ['y', 'ი'], ['z', 'ზ'],
  ],
};

function latinWord(w: string, target: 'ru' | 'ka'): string {
  const lower = w.toLowerCase().replace(/’/g, "'");
  let out = '';
  for (let i = 0; i < lower.length; ) {
    const ch = lower[i];
    const next = lower[i + 1] ?? '';
    const digraph = FROM_LATIN[target].find(([lat]) => lat.length > 1 && lower.startsWith(lat, i));
    if (digraph) {
      out += digraph[1];
      i += digraph[0].length;
      continue;
    }
    // Letters that depend on their neighbours.
    if (ch === 'c') {
      out += /[eiy]/.test(next) ? (target === 'ru' ? 'ц' : 'ს') : target === 'ru' ? 'к' : 'ქ';
      i++;
      continue;
    }
    if (ch === 'y' && target === 'ru') {
      out += /[aeiou]/.test(next) || i === lower.length - 1 ? 'й' : 'и';
      i++;
      continue;
    }
    if (ch === 'e' && target === 'ru' && i === 0) {
      out += 'э';
      i++;
      continue;
    }
    const letter = FROM_LATIN[target].find(([lat]) => lat === ch);
    if (letter) out += letter[1];
    else if (ch !== "'") out += ch;
    i++;
  }
  // Georgian spells a sound once (Wissol → ვისოლ); Russian keeps the double letter.
  if (target === 'ka') return out.replace(/(.)\1/gu, '$1');
  if (!out) return out;
  // Keep the look of the original: capitalised names, all-caps abbreviations.
  return w === w.toUpperCase() && w.length > 1 ? out.toUpperCase() : /^[A-Z]/.test(w) ? out[0].toUpperCase() + out.slice(1) : out;
}

/** Latin words in `text` written in Cyrillic ("ru") or Georgian ("ka") script. */
export function latinToScript(text: string, target: 'ru' | 'ka'): string {
  return text.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => latinWord(w, target));
}
