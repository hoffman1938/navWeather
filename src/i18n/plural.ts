/** CLDR plural categories (Russian needs one/few/many; English one/other). */
export interface PluralForms {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

const rulesCache = new Map<string, Intl.PluralRules>();

export function plural(n: number, forms: PluralForms, locale: string): string {
  let rules = rulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    rulesCache.set(locale, rules);
  }
  const cat = rules.select(n) as keyof PluralForms;
  return forms[cat] ?? forms.other;
}
