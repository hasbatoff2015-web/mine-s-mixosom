/**
 * Durable guest recovery credential. The browser stores an opaque token.
 * The server player id stays in the world save.
 */

export interface GuestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GuestIdentityScope {
  readonly deployment: string;
  readonly mode: string;
  readonly worldId: string;
}

export interface GuestCredentialRecord {
  readonly sessionToken: string;
  readonly retained: readonly string[];
}

export const GUEST_STORAGE_KEY = 'fc.guest.v1';
export const LEGACY_ANARCHY_SESSION_KEY = 'fc.anarchy.sessionToken';

const TOKEN_MAX = 80;

export function guestDeploymentId(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
  if (host === 'dev.megacraft.agariobrainrot.ru') return 'dev';
  if (host === 'megacraft.agariobrainrot.ru') return 'prod';
  return `other:${host}`;
}

export function guestScopeKey(scope: GuestIdentityScope): string {
  return `${scope.deployment}|${scope.mode}|${scope.worldId}`;
}

export function legacySessionStorageKey(url: string, defaultUrl: string): string {
  return url === defaultUrl ? LEGACY_ANARCHY_SESSION_KEY : `fc.session.${url}`;
}

export function isGuestToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= TOKEN_MAX && !/\s/.test(value);
}

interface StoredRecord {
  sessionToken: string;
  retained?: string[];
}

interface StoredFile {
  readonly version: 1;
  readonly records: Record<string, StoredRecord>;
}

export type GuestStoreRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly file: StoredFile; readonly raw: string }
  | { readonly kind: 'corrupt'; readonly raw: string }
  | { readonly kind: 'unsupported'; readonly raw: string }
  | { readonly kind: 'unavailable' };

export class GuestStorageError extends Error {
  constructor(readonly reason: 'unavailable' | 'quota' | 'corrupt' | 'unsupported' | 'invalid' | 'exists') {
    super(reason);
    this.name = 'GuestStorageError';
  }
}

function parseRecord(value: unknown): StoredRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set(['sessionToken', 'retained']);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (!isGuestToken(record.sessionToken)) return null;
  if (record.retained === undefined) return { sessionToken: record.sessionToken };
  if (!Array.isArray(record.retained) || record.retained.some((item) => !isGuestToken(item))) return null;
  return {
    sessionToken: record.sessionToken,
    ...(record.retained.length > 0 ? { retained: record.retained.filter(isGuestToken) } : {}),
  };
}

export function readGuestStore(storage: GuestStorage): GuestStoreRead {
  let raw: string | null;
  try {
    raw = storage.getItem(GUEST_STORAGE_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw == null || raw === '') return { kind: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt', raw };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'corrupt', raw };
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1) return { kind: 'unsupported', raw };
  if (!root.records || typeof root.records !== 'object' || Array.isArray(root.records)) {
    return { kind: 'corrupt', raw };
  }
  const records: Record<string, StoredRecord> = {};
  for (const [key, value] of Object.entries(root.records)) {
    const row = parseRecord(value);
    if (!row) return { kind: 'corrupt', raw };
    records[key] = row;
  }
  return { kind: 'valid', raw, file: { version: 1, records } };
}

function requireWritable(storage: GuestStorage): StoredFile {
  const read = readGuestStore(storage);
  if (read.kind === 'absent') return { version: 1, records: {} };
  if (read.kind === 'valid') return { version: 1, records: { ...read.file.records } };
  if (read.kind === 'unsupported') throw new GuestStorageError('unsupported');
  if (read.kind === 'unavailable') throw new GuestStorageError('unavailable');
  throw new GuestStorageError('corrupt');
}

function writeFile(storage: GuestStorage, file: StoredFile): void {
  try {
    storage.setItem(GUEST_STORAGE_KEY, JSON.stringify(file));
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'QuotaExceededError') throw new GuestStorageError('quota');
    throw new GuestStorageError('unavailable');
  }
}

export function readGuestCredential(storage: GuestStorage, scope: GuestIdentityScope): GuestCredentialRecord | null {
  const read = readGuestStore(storage);
  if (read.kind === 'unavailable') throw new GuestStorageError('unavailable');
  if (read.kind === 'corrupt') throw new GuestStorageError('corrupt');
  if (read.kind === 'unsupported') throw new GuestStorageError('unsupported');
  if (read.kind === 'absent') return null;
  const row = read.file.records[guestScopeKey(scope)];
  if (!row) return null;
  return { sessionToken: row.sessionToken, retained: row.retained ?? [] };
}

export function sameModeOtherWorld(storage: GuestStorage, scope: GuestIdentityScope): boolean {
  const read = readGuestStore(storage);
  if (read.kind !== 'valid') return false;
  const prefix = `${scope.deployment}|${scope.mode}|`;
  const own = guestScopeKey(scope);
  return Object.keys(read.file.records).some((key) => key.startsWith(prefix) && key !== own);
}

export function writeGuestCredential(
  storage: GuestStorage,
  scope: GuestIdentityScope,
  sessionToken: string,
  retainPrevious = true,
): void {
  if (!isGuestToken(sessionToken)) throw new GuestStorageError('invalid');
  const file = requireWritable(storage);
  const key = guestScopeKey(scope);
  const previous = file.records[key];
  const retained = new Set(previous?.retained ?? []);
  if (retainPrevious && previous && previous.sessionToken !== sessionToken) retained.add(previous.sessionToken);
  retained.delete(sessionToken);
  file.records[key] = {
    sessionToken,
    ...(retained.size > 0 ? { retained: [...retained] } : {}),
  };
  writeFile(storage, file);
}

/** Updates one scope and leaves every other saved record in place. */
export function importGuestCredential(
  storage: GuestStorage,
  scope: GuestIdentityScope,
  sessionToken: string,
  replace = false,
): void {
  if (!isGuestToken(sessionToken)) throw new GuestStorageError('invalid');
  const file = requireWritable(storage);
  const previous = file.records[guestScopeKey(scope)];
  if (previous && previous.sessionToken !== sessionToken && !replace) {
    throw new GuestStorageError('exists');
  }
  writeGuestCredential(storage, scope, sessionToken, true);
}

export function collectLegacyTokens(legacy: GuestStorage, keys: readonly string[]): { token?: string; ambiguous: boolean; keys: string[] } {
  const found: { key: string; token: string }[] = [];
  for (const key of keys) {
    let raw: string | null = null;
    try {
      raw = legacy.getItem(key);
    } catch {
      throw new GuestStorageError('unavailable');
    }
    if (isGuestToken(raw)) found.push({ key, token: raw });
  }
  const unique = [...new Set(found.map((row) => row.token))];
  if (unique.length > 1) return { ambiguous: true, keys: found.map((row) => row.key) };
  if (unique.length === 1) return { token: unique[0], ambiguous: false, keys: found.map((row) => row.key) };
  return { ambiguous: false, keys: [] };
}

export function forgetLegacyKeys(legacy: GuestStorage, keys: readonly string[]): void {
  for (const key of keys) {
    try {
      legacy.removeItem(key);
    } catch {
      // Leaving the legacy copy is safer than throwing after a confirmed resume.
    }
  }
}

export interface IdentityStatus {
  readonly ok: boolean;
  readonly ready?: boolean;
  readonly mode?: string;
  readonly world?: string;
}

export type GuestJoinPlan =
  | {
    readonly outcome: 'ready_existing' | 'ready_new';
    readonly sendToken?: string;
    readonly freshGuest?: boolean;
    readonly ephemeral?: boolean;
    readonly scope: GuestIdentityScope;
    readonly legacyKeys: readonly string[];
  }
  | {
    readonly outcome: 'untrusted';
    readonly legacyKeys: readonly string[];
  }
  | {
    readonly outcome: 'storage_unavailable' | 'storage_corrupt' | 'storage_unsupported' | 'world_changed' | 'mode_mismatch' | 'status_unavailable' | 'ambiguous_legacy';
    readonly legacyKeys: readonly string[];
    readonly message: string;
    readonly scope?: GuestIdentityScope;
  };

export function planGuestJoin(input: {
  readonly trusted: boolean;
  readonly freshGuest: boolean;
  readonly allowEphemeral: boolean;
  readonly targetMode: string;
  readonly hostname: string;
  readonly status: IdentityStatus;
  readonly durable: GuestStorage | null;
  readonly legacy: GuestStorage | null;
  readonly legacyKeys: readonly string[];
}): GuestJoinPlan {
  if (!input.trusted) return { outcome: 'untrusted', legacyKeys: [] };
  if (!input.status.ok || input.status.ready !== true || !input.status.world) {
    return {
      outcome: 'status_unavailable',
      legacyKeys: [],
      message: 'Не удалось проверить мир сервера. Персонаж не создавался.',
    };
  }
  if (input.status.mode !== input.targetMode) {
    return {
      outcome: 'mode_mismatch',
      legacyKeys: [],
      message: 'Сервер ответил другим режимом. Сохранённый ключ не отправлен.',
    };
  }
  const scope: GuestIdentityScope = {
    deployment: guestDeploymentId(input.hostname),
    mode: input.targetMode,
    worldId: input.status.world,
  };
  if (!input.durable) {
    if (input.allowEphemeral) return { outcome: 'ready_new', scope, legacyKeys: [], ephemeral: true, freshGuest: true };
    return {
      outcome: 'storage_unavailable',
      legacyKeys: [],
      scope,
      message: 'Браузер не смог прочитать сохранённую личность. Новый персонаж не создавался.',
    };
  }
  const read = readGuestStore(input.durable);
  if (read.kind === 'unavailable') {
    if (input.allowEphemeral) return { outcome: 'ready_new', scope, legacyKeys: [], ephemeral: true, freshGuest: true };
    return {
      outcome: 'storage_unavailable',
      legacyKeys: [],
      scope,
      message: 'Браузер не смог прочитать сохранённую личность. Новый персонаж не создавался.',
    };
  }
  if (read.kind === 'corrupt') {
    return {
      outcome: 'storage_corrupt',
      legacyKeys: [],
      scope,
      message: 'Сохранённые гостевые ключи повреждены. Они не перезаписаны и новый персонаж не создавался.',
    };
  }
  if (read.kind === 'unsupported') {
    return {
      outcome: 'storage_unsupported',
      legacyKeys: [],
      scope,
      message: 'Формат сохранённых гостевых ключей не поддерживается. Запись не изменена.',
    };
  }
  const existing = read.kind === 'valid' ? read.file.records[guestScopeKey(scope)] : undefined;
  if (input.freshGuest) return { outcome: 'ready_new', scope, legacyKeys: [], freshGuest: true };
  if (existing) return { outcome: 'ready_existing', scope, legacyKeys: [], sendToken: existing.sessionToken };
  if (read.kind === 'valid' && sameModeOtherWorld(input.durable, scope)) {
    return {
      outcome: 'world_changed',
      legacyKeys: [],
      scope,
      message: 'Сервер открыл другой сохранённый мир этого режима. Новый персонаж не создавался.',
    };
  }
  if (!input.legacy) return { outcome: 'ready_new', scope, legacyKeys: [] };
  let legacy: ReturnType<typeof collectLegacyTokens>;
  try {
    legacy = collectLegacyTokens(input.legacy, input.legacyKeys);
  } catch {
    return {
      outcome: 'storage_unavailable',
      legacyKeys: [],
      scope,
      message: 'Браузер не смог прочитать сохранённую личность. Новый персонаж не создавался.',
    };
  }
  if (legacy.ambiguous) {
    return {
      outcome: 'ambiguous_legacy',
      legacyKeys: legacy.keys,
      scope,
      message: 'Найдено несколько старых гостевых ключей. Автоматически персонаж не выбран.',
    };
  }
  if (legacy.token) {
    return { outcome: 'ready_existing', scope, legacyKeys: legacy.keys, sendToken: legacy.token };
  }
  return { outcome: 'ready_new', scope, legacyKeys: [] };
}

export function confirmGuestWelcome(
  durable: GuestStorage | null,
  legacy: GuestStorage | null,
  scope: GuestIdentityScope | undefined,
  sessionToken: string,
  legacyKeys: readonly string[],
): { persisted: boolean; code?: 'storage_write_failed' } {
  if (!scope || !durable || !isGuestToken(sessionToken)) return { persisted: false, code: 'storage_write_failed' };
  try {
    writeGuestCredential(durable, scope, sessionToken, true);
  } catch {
    return { persisted: false, code: 'storage_write_failed' };
  }
  if (legacy && legacyKeys.length > 0) forgetLegacyKeys(legacy, legacyKeys);
  return { persisted: true };
}

export async function withGuestScopeLock<T>(
  scope: GuestIdentityScope,
  body: () => Promise<T>,
  locks?: { request<R>(name: string, callback: () => Promise<R>): Promise<R> },
): Promise<T> {
  const name = `fc-guest:${guestScopeKey(scope)}`;
  if (locks?.request) return locks.request(name, body);
  return body();
}
