import ruDictionary from '../data/chat-profanity-ru.json';
import enDictionary from '../data/chat-profanity-en.json';

interface ProfanityDictionary {
  readonly roots: readonly string[];
  readonly words: readonly string[];
  readonly insults: readonly string[];
  readonly phrases: readonly (readonly string[])[];
  readonly spellings: readonly string[];
  readonly exceptions: readonly string[];
}

function foldedEnding(value: string): string {
  return value.replaceAll('ё', 'е').replaceAll('й', 'и');
}

const CYR_ENDINGS = new Set([
  '', 'а', 'у', 'е', 'и', 'ы', 'о', 'ю', 'я', 'ь',
  'ой', 'ою', 'ом', 'ем', 'ём', 'ая', 'ое', 'ые', 'ие', 'ий', 'ый',
  'ов', 'ев', 'ёв', 'ам', 'ям', 'ами', 'ями', 'ах', 'ях',
  'ка', 'ки', 'ку', 'ке', 'кой', 'ок',
  'ец', 'ца', 'цу', 'це', 'цы',
  'ть', 'ти', 'л', 'ла', 'ло', 'ли',
  'ал', 'ала', 'али', 'ил', 'ила', 'или', 'ел', 'ела', 'ели',
  'ул', 'ула', 'ули', 'нул', 'нула', 'нуло', 'нули', 'анул', 'янул',
  'ать', 'ять', 'ить', 'еть', 'оть', 'уть', 'ся', 'сь', 'дь',
  'ина', 'ины', 'ину', 'ине', 'ища', 'ище', 'ня', 'ню', 'ни',
  'ота', 'ас', 'аса', 'асу', 'асом', 'юк', 'юга',
  'атый', 'ятый', 'овый', 'евый',
  'ный', 'ная', 'ное', 'ные', 'ных', 'ного', 'ному', 'ным', 'ном',
  'ёнок', 'енка', 'енку',
].map(foldedEnding));

const LAT_ENDINGS = new Set(['', 's', 'es', 'ed', 'ing', 'er', 'ers', 'y', 'ies']);

const CYR_PREFIXES = [
  'пере', 'при', 'про', 'под', 'над', 'рас', 'раз', 'обо', 'пре', 'вз',
  'за', 'на', 'по', 'вы', 'до', 'от', 'из', 'ис', 'об', 'во', 'со', 'не',
  'ни', 'о', 'у', 'с', 'в',
].sort((left, right) => right.length - left.length);

const LEET_CYR: Record<string, string> = {
  '0': 'о', '1': 'и', '3': 'е', '4': 'а', '5': 'с', '6': 'б', '7': 'т', '@': 'а', '$': 'с', '!': 'и',
};
const LEET_LAT: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '@': 'a', '$': 's', '!': 'i',
};
const TO_CYR: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', y: 'у', x: 'х', k: 'к', m: 'м', h: 'н',
  t: 'т', b: 'в', i: 'и', u: 'и',
};
const TO_LAT: Record<string, string> = {
  а: 'a', е: 'e', ё: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', м: 'm',
  н: 'h', т: 't', в: 'b', и: 'i', й: 'i', і: 'i', ї: 'i',
};
const VOWELS = new Set([...'aeiouyаеёиоуыэюя']);

interface CompiledLanguage {
  readonly words: ReadonlySet<string>;
  readonly roots: readonly string[];
  readonly exceptions: ReadonlySet<string>;
  readonly phrases: readonly (readonly string[])[];
  readonly endings: ReadonlySet<string>;
  readonly prefixes: readonly string[];
  readonly script: 'cyr' | 'lat';
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}@$*]/u.test(ch);
}

function isSeparator(ch: string): boolean {
  return '-_.*\'`~+=|/\\,'.includes(ch);
}

function isGlue(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  if (code >= 0x200b && code <= 0x200f) return true;
  if (code >= 0x202a && code <= 0x202e) return true;
  if (code >= 0x2060 && code <= 0x206f) return true;
  if (code === 0xfeff) return true;
  return /\p{M}/u.test(ch) || /\p{Cf}/u.test(ch);
}

function collapseRuns(text: string): string {
  let out = '';
  let previous = '';
  for (const ch of text) {
    if (ch === previous) continue;
    out += ch;
    previous = ch;
  }
  return out;
}

function hasRepeat(text: string): boolean {
  let previous = '';
  for (const ch of text) {
    if (ch === previous) return true;
    previous = ch;
  }
  return false;
}

function foldLetters(raw: string, script: 'cyr' | 'lat'): string {
  const leet = script === 'cyr' ? LEET_CYR : LEET_LAT;
  const map = script === 'cyr' ? TO_CYR : TO_LAT;
  let out = '';
  for (const ch of raw.normalize('NFKD').toLowerCase()) {
    if (isGlue(ch) || isSeparator(ch)) continue;
    const mapped = map[leet[ch] ?? ch] ?? (leet[ch] ?? ch);
    if (script === 'cyr') {
      if (mapped === 'ё' || mapped === 'е') out += 'е';
      else if (mapped === 'й' || mapped === 'и') out += 'и';
      else if (/[а-я]/u.test(mapped)) out += mapped;
    } else if (/[a-z]/u.test(mapped)) {
      out += mapped;
    }
  }
  return out;
}

function oneVowelShort(token: string, word: string): boolean {
  if (token.length + 1 !== word.length || token.length < 3) return false;
  let skipped = false;
  let index = 0;
  for (const ch of word) {
    if (index < token.length && token[index] === ch) {
      index += 1;
      continue;
    }
    if (!skipped && VOWELS.has(ch)) {
      skipped = true;
      continue;
    }
    return false;
  }
  return skipped && index === token.length;
}

function compile(
  dictionary: ProfanityDictionary,
  script: 'cyr' | 'lat',
  endings: ReadonlySet<string>,
  prefixes: readonly string[],
): CompiledLanguage {
  const words = new Set<string>();
  const exceptions = new Set<string>();
  const remember = (value: string, target: Set<string>): void => {
    const plain = foldLetters(value, script);
    const folded = collapseRuns(plain);
    if (plain.length > 0) target.add(plain);
    if (folded.length > 0) target.add(folded);
  };
  for (const value of [...dictionary.words, ...dictionary.insults, ...dictionary.spellings]) remember(value, words);
  for (const value of dictionary.exceptions) remember(value, exceptions);
  const roots: string[] = [];
  for (const root of dictionary.roots) {
    const folded = collapseRuns(foldLetters(root, script));
    if (folded.length >= 3 && !roots.includes(folded)) roots.push(folded);
  }
  const phrases = dictionary.phrases
    .map((phrase) => phrase.map((part) => collapseRuns(foldLetters(part, script))).filter((part) => part.length > 0))
    .filter((phrase) => phrase.length >= 2);
  return { words, roots, exceptions, phrases, endings, prefixes, script };
}

const LANGUAGES: readonly CompiledLanguage[] = [
  compile(ruDictionary as ProfanityDictionary, 'cyr', CYR_ENDINGS, CYR_PREFIXES),
  compile(enDictionary as ProfanityDictionary, 'lat', LAT_ENDINGS, []),
];

function matchesStem(language: CompiledLanguage, key: string): boolean {
  if (key.length < 3 || language.exceptions.has(key)) return false;
  if (language.words.has(key)) return true;
  if (hasRepeat(key)) {
    const collapsed = collapseRuns(key);
    for (const word of language.words) {
      if (word.length >= 3 && collapseRuns(word) === collapsed) return true;
    }
  }
  for (const word of language.words) {
    if (word.length >= 4 && oneVowelShort(key, word)) return true;
  }
  const candidates = [key];
  if (language.script === 'cyr') {
    for (const prefix of language.prefixes) {
      if (!key.startsWith(prefix) || key.length <= prefix.length + 2) continue;
      const rest = key.slice(prefix.length);
      if (!language.exceptions.has(rest)) candidates.push(rest);
      break;
    }
  }
  for (const candidate of candidates) {
    if (language.words.has(candidate)) return true;
    for (const root of language.roots) {
      if (!candidate.startsWith(root)) continue;
      if (language.endings.has(candidate.slice(root.length))) return true;
    }
  }
  return false;
}

function keysFor(token: string, script: 'cyr' | 'lat'): string[] {
  const folded = foldLetters(token, script);
  if (folded.length === 0) return [];
  if (!hasRepeat(folded)) return [folded];
  const collapsed = collapseRuns(folded);
  return collapsed === folded ? [folded] : [folded, collapsed];
}

function tokenBanned(token: string): boolean {
  for (const language of LANGUAGES) {
    for (const key of keysFor(token, language.script)) {
      const collapsed = collapseRuns(key);
      if (language.exceptions.has(key) || language.exceptions.has(collapsed)) continue;
      if (matchesStem(language, key) || (collapsed !== key && matchesStem(language, collapsed))) return true;
    }
  }
  return false;
}

interface TokenSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function tokenize(chars: readonly string[]): TokenSpan[] {
  const spans: TokenSpan[] = [];
  let index = 0;
  while (index < chars.length) {
    if (!isWordChar(chars[index] ?? '')) {
      index += 1;
      continue;
    }
    const start = index;
    let end = index + 1;
    index += 1;
    while (index < chars.length) {
      const current = chars[index] ?? '';
      if (isWordChar(current)) {
        end = index + 1;
        index += 1;
        continue;
      }
      if (!isSeparator(current) && !isGlue(current)) break;
      let look = index;
      while (look < chars.length && (isSeparator(chars[look] ?? '') || isGlue(chars[look] ?? ''))) look += 1;
      if (look < chars.length && isWordChar(chars[look] ?? '')) {
        index = look;
        continue;
      }
      break;
    }
    spans.push({ start, end, text: chars.slice(start, end).join('') });
    index = Math.max(index, end);
  }
  return spans;
}

function phraseHits(spans: readonly TokenSpan[]): Set<number> {
  const hits = new Set<number>();
  if (spans.length < 2) return hits;
  for (const language of LANGUAGES) {
    const tokenKeys = spans.map((span) => collapseRuns(foldLetters(span.text, language.script)));
    for (const phrase of language.phrases) {
      for (let start = 0; start <= tokenKeys.length - phrase.length; start += 1) {
        let matched = true;
        for (let offset = 0; offset < phrase.length; offset += 1) {
          if (tokenKeys[start + offset] !== phrase[offset]) {
            matched = false;
            break;
          }
        }
        if (!matched) continue;
        for (let offset = 0; offset < phrase.length; offset += 1) hits.add(start + offset);
      }
    }
  }
  return hits;
}

function spacedLetterHits(spans: readonly TokenSpan[], chars: readonly string[]): Set<number> {
  const hits = new Set<number>();
  let run: number[] = [];
  const flush = (): void => {
    if (run.length >= 4) {
      const joined = run.map((index) => spans[index]?.text ?? '').join('');
      if (tokenBanned(joined)) {
        for (const index of run) hits.add(index);
      }
    }
    run = [];
  };
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (!span || span.end - span.start !== 1 || !isWordChar(span.text)) {
      flush();
      continue;
    }
    if (run.length > 0) {
      const previous = spans[run[run.length - 1] ?? 0];
      const gap = previous ? chars.slice(previous.end, span.start).join('') : '';
      if (!/^[\s\p{Cf}\p{M}]+$/u.test(gap)) flush();
    }
    run.push(index);
  }
  flush();
  return hits;
}

/** Replace each banned token with the same number of `*` code points. */
export function censorChatText(text: string): string {
  if (!text) return text;
  const chars = [...text];
  const spans = tokenize(chars);
  if (spans.length === 0) return text;
  const banned = new Set<number>();
  spans.forEach((span, index) => {
    if (tokenBanned(span.text)) banned.add(index);
  });
  for (const index of phraseHits(spans)) banned.add(index);
  for (const index of spacedLetterHits(spans, chars)) banned.add(index);
  if (banned.size === 0) return text;
  const out = chars.slice();
  for (const index of banned) {
    const span = spans[index];
    if (!span) continue;
    for (let cursor = span.start; cursor < span.end; cursor += 1) out[cursor] = '*';
  }
  return out.join('');
}
