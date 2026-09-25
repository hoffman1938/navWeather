import { en, type Messages } from './en';
import { ka } from './ka';
import { ru } from './ru';

export type Locale = 'en' | 'ka' | 'ru';
export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'ka', name: 'ქართული' },
  { id: 'ru', name: 'Русский' },
];

const table: Record<Locale, Messages> = { en, ka, ru };

export function getMessages(locale: Locale): Messages {
  return table[locale] ?? en;
}

/** Best supported locale for the browser language. */
export function detectLocale(lang = typeof navigator !== 'undefined' ? navigator.language : 'en'): Locale {
  const base = lang.slice(0, 2).toLowerCase();
  return base === 'ka' || base === 'ru' ? base : 'en';
}

export { en };
export type { Messages };
