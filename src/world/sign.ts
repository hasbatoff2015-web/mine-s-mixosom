export const MAX_SIGN_LINES = 4;
export const MAX_SIGN_LINE_CHARS = 32;
export type SignLines = readonly [string, string, string, string];

export function sanitizeSignLines(raw: unknown): SignLines | undefined {
  if (!Array.isArray(raw) || raw.length !== MAX_SIGN_LINES
    || raw.some((line) => typeof line !== 'string' || line.length > MAX_SIGN_LINE_CHARS)) return undefined;
  const lines = raw.map((line: string) => line.normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ''));
  return lines as unknown as SignLines;
}

export const EMPTY_SIGN_LINES: SignLines = ['', '', '', ''];
