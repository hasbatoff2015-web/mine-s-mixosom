import { RU_DISPLAY_NAMES } from './ru';

export function hasExplicitDisplayName(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(RU_DISPLAY_NAMES, id);
}

/** Production registries must pass a mapped ID. Unknown developer IDs stay as the raw key. */
export function displayNameFor(id: string): string {
  return RU_DISPLAY_NAMES[id] ?? id;
}

export function requiredDisplayName(id: string): string {
  const name = RU_DISPLAY_NAMES[id];
  if (!name) throw new Error(`Missing Russian display name for '${id}'`);
  return name;
}

export { RU_DISPLAY_NAMES };
