const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuid(value: unknown): string | undefined {
  if (typeof value !== 'string' || !UUID_TEXT.test(value)) return undefined;
  return value.toLowerCase();
}
