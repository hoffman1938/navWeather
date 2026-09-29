/**
 * Georgian case endings and number words, shared by the Georgian messages
 * and the voice (which says "12:55-ზე" as "თორმეტ საათსა და ორმოცდათხუთმეტ
 * წუთზე", the way a person reads it).
 */

export type Postposition = 'tan' | 'shi' | 'ze' | 'mde' | 'is' | 'it' | 'dan';
const SUFFIX: Record<Postposition, string> = { tan: 'თან', shi: 'ში', ze: 'ზე', mde: 'მდე', is: 'ის', it: 'ით', dan: 'დან' };

/** "ზე" → 'ze' (the endings written after a hyphen: "S12-ზე", "12:55-ზე"). */
export const POSTPOSITION_OF: Record<string, Postposition> = Object.fromEntries(
  Object.entries(SUFFIX).map(([pp, s]) => [s, pp as Postposition]),
);

/** A name with a postposition, declined like a Georgian noun (last word only). */
export function withPostposition(name: string, pp: Postposition): string {
  const last = name.slice(-1);
  if (!/[ა-ჺ]/.test(last)) return `${name}-${SUFFIX[pp]}`; // S12-ზე, Khunevi-თან
  if (last === 'ი') {
    // Consonant stem: the nominative -ი drops (but stays before -დან: ბათუმიდან).
    const stem = name.slice(0, -1);
    if (pp === 'dan') return `${name}დან`;
    return pp === 'mde' ? `${stem}ამდე` : `${stem}${SUFFIX[pp]}`;
  }
  if ('აეოუ'.includes(last)) {
    const cut = last === 'ა' || last === 'ე';
    if (pp === 'tan') return `${name}სთან`;
    if (pp === 'is') return cut ? `${name.slice(0, -1)}ის` : `${name}ს`;
    if (pp === 'it') return cut ? `${name.slice(0, -1)}ით` : `${name}თი`;
    if (pp === 'dan') return cut ? `${name.slice(0, -1)}იდან` : `${name}დან`;
    return `${name}${SUFFIX[pp]}`;
  }
  return pp === 'mde' ? `${name}ამდე` : `${name}${SUFFIX[pp]}`;
}

const ONES = [
  'ნული', 'ერთი', 'ორი', 'სამი', 'ოთხი', 'ხუთი', 'ექვსი', 'შვიდი', 'რვა', 'ცხრა',
  'ათი', 'თერთმეტი', 'თორმეტი', 'ცამეტი', 'თოთხმეტი', 'თხუთმეტი', 'თექვსმეტი', 'ჩვიდმეტი', 'თვრამეტი', 'ცხრამეტი',
];
const SCORES = ['', 'ოცი', 'ორმოცი', 'სამოცი', 'ოთხმოცი'];
const HUNDREDS = ['', 'ასი', 'ორასი', 'სამასი', 'ოთხასი', 'ხუთასი', 'ექვსასი', 'შვიდასი', 'რვაასი', 'ცხრაასი'];

/** The form before a noun or another number: ოცი → ოც (ოც წუთში), რვა stays. */
export const kaStem = (w: string) => (w.endsWith('ი') ? w.slice(0, -1) : w);

/** Georgian number words (counting by twenties): 55 → "ორმოცდათხუთმეტი". */
export function kaNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) {
    const r = n % 20;
    const score = SCORES[Math.floor(n / 20)];
    return r ? `${kaStem(score)}და${ONES[r]}` : score;
  }
  if (n < 1000) {
    const r = n % 100;
    const h = HUNDREDS[Math.floor(n / 100)];
    return r ? `${kaStem(h)} ${kaNumber(r)}` : h;
  }
  const t = Math.floor(n / 1000);
  const r = n % 1000;
  const th = t === 1 ? 'ათასი' : `${kaNumber(t)} ათასი`;
  return r ? `${kaStem(th)} ${kaNumber(r)}` : th;
}

/** "12:55" + ზე → "თორმეტ საათსა და ორმოცდათხუთმეტ წუთზე"; "13:00" → "ცამეტ საათზე". */
export function kaTime(h: number, m: number, pp: Postposition): string {
  const hours = kaStem(kaNumber(h));
  if (!m) return `${hours} ${withPostposition('საათი', pp)}`;
  return `${hours} საათსა და ${kaStem(kaNumber(m))} ${withPostposition('წუთი', pp)}`;
}

/** Ordinal: 11 → "მეთერთმეტე" (the numbers 1–10 have their own words in the messages). */
export function kaOrdinal(n: number): string {
  if (n === 1) return 'პირველი';
  return `მე${kaNumber(n).replace(/[ია]$/, '')}ე`;
}
