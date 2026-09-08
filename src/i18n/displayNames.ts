import { EN_DISPLAY_NAMES } from './en';
import { RU_DISPLAY_NAMES } from './ru';

export type DisplayLanguage = 'ru' | 'en';

function namesFor(language: DisplayLanguage): Readonly<Record<string, string>> {
  return language === 'en' ? EN_DISPLAY_NAMES : RU_DISPLAY_NAMES;
}

export function hasExplicitDisplayName(id: string, language: DisplayLanguage = 'ru'): boolean {
  return Object.prototype.hasOwnProperty.call(namesFor(language), id);
}

/** Production registries must pass a mapped ID. Unknown developer IDs stay as the raw key. */
export function displayNameFor(id: string, language: DisplayLanguage = 'ru'): string {
  return namesFor(language)[id] ?? id;
}

export function requiredDisplayName(id: string, language: DisplayLanguage = 'ru'): string {
  const name = namesFor(language)[id];
  if (!name) throw new Error(`Missing ${language.toUpperCase()} display name for '${id}'`);
  return name;
}

export { EN_DISPLAY_NAMES, RU_DISPLAY_NAMES };
