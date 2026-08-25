export type ParsedChatLine =
  | { readonly kind: 'empty' }
  | { readonly kind: 'say'; readonly text: string }
  | { readonly kind: 'command'; readonly name: string; readonly args: readonly string[] };

export function parseChatLine(raw: string): ParsedChatLine {
  const trimmed = raw.replace(/^\s+|\s+$/g, '');
  if (!trimmed) return { kind: 'empty' };
  if (!trimmed.startsWith('/')) return { kind: 'say', text: trimmed };
  const tokens = tokenize(trimmed.slice(1));
  const name = tokens[0]?.toLowerCase();
  if (!name) return { kind: 'empty' };
  return { kind: 'command', name, args: tokens.slice(1) };
}

export function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const character of source.trim()) {
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  return tokens;
}
