/** Server-issued player id. A display nickname never matches this. */
export const PLAYER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlayerId(value: string): boolean {
  return PLAYER_ID_PATTERN.test(value.trim());
}

export function canonicalPlayerId(value: string): string {
  return value.trim().toLowerCase();
}
