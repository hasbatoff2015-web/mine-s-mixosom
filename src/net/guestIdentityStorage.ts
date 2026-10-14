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

function isToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= TOKEN_MAX && !/\s/.test(value);
}

interface StoredFile {
  readonly version: 1;
  readonly records: Record<string, { sessionToken: string; retained?: string[] }>;
}

function readFile(storage: GuestStorage): StoredFile {
  let raw: string | null;
  try {
    raw = storage.getItem(GUEST_STORAGE_KEY);
  } catch {
    throw new GuestStorageError('unavailable');
  }
  if (raw == null || raw === '') return { version: 1, records: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, records: {} };
    const record = parsed as { version?: unknown; records?: unknown };
    if (record.version !== 1 || !record.records || typeof record.records !== 'object' || Array.isArray(record.records)) {
      return { version: 1, records: {} };
    }
    const records: StoredFile['records'] = {};
    for (const [key, value] of Object.entries(record.records)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const token = (value as { sessionToken?: unknown }).sessionToken;
      if (!isToken(token)) continue;
      const retainedRaw = (value as { retained?: unknown }).retained;
      const retained = Array.isArray(retainedRaw) ? retainedRaw.filter(isToken) : [];
      records[key] = { sessionToken: token, ...(retained.length > 0 ? { retained } : {}) };
    }
    return { version: 1, records };
  } catch {
    return { version: 1, records: {} };
  }
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

export class GuestStorageError extends Error {
  constructor(readonly reason: 'unavailable' | 'quota') {
    super(reason);
    this.name = 'GuestStorageError';
  }
}

export function readGuestCredential(storage: GuestStorage, scope: GuestIdentityScope): GuestCredentialRecord | null {
  const file = readFile(storage);
  const row = file.records[guestScopeKey(scope)];
  if (!row) return null;
  return { sessionToken: row.sessionToken, retained: row.retained ?? [] };
}

export function hasOtherGuestScope(storage: GuestStorage, scope: GuestIdentityScope): boolean {
  const file = readFile(storage);
  const key = guestScopeKey(scope);
  return Object.keys(file.records).some((candidate) => candidate !== key);
}

export function writeGuestCredential(
  storage: GuestStorage,
  scope: GuestIdentityScope,
  sessionToken: string,
  retainPrevious = true,
): void {
  if (!isToken(sessionToken)) throw new GuestStorageError('unavailable');
  const file = readFile(storage);
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

export function collectLegacyTokens(legacy: GuestStorage, keys: readonly string[]): { token?: string; ambiguous: boolean; keys: string[] } {
  const found: { key: string; token: string }[] = [];
  for (const key of keys) {
    let raw: string | null = null;
    try {
      raw = legacy.getItem(key);
    } catch {
      throw new GuestStorageError('unavailable');
    }
    if (isToken(raw)) found.push({ key, token: raw });
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

export interface GuestJoinPlan {
  readonly sendToken?: string;
  readonly freshGuest?: boolean;
  readonly scope?: GuestIdentityScope;
  readonly legacyKeys: readonly string[];
  readonly warning?: 'storage' | 'other-world';
  readonly blocked?: 'status' | 'ambiguous';
  readonly message?: string;
}

export function planGuestJoin(input: {
  readonly trusted: boolean;
  readonly freshGuest: boolean;
  readonly hostname: string;
  readonly status: IdentityStatus;
  readonly durable: GuestStorage | null;
  readonly legacy: GuestStorage | null;
  readonly legacyKeys: readonly string[];
}): GuestJoinPlan {
  if (!input.trusted) {
    return { legacyKeys: [], freshGuest: input.freshGuest || undefined };
  }
  if (!input.status.ok || input.status.ready !== true || !input.status.mode || !input.status.world) {
    return {
      legacyKeys: [],
      blocked: 'status',
      message: 'Не удалось проверить мир сервера. Персонаж не создавался.',
    };
  }
  const scope: GuestIdentityScope = {
    deployment: guestDeploymentId(input.hostname),
    mode: input.status.mode,
    worldId: input.status.world,
  };
  if (!input.durable) {
    return {
      scope,
      legacyKeys: [],
      freshGuest: input.freshGuest || undefined,
      warning: 'storage',
    };
  }
  let existing: GuestCredentialRecord | null = null;
  try {
    existing = readGuestCredential(input.durable, scope);
  } catch {
    return { scope, legacyKeys: [], freshGuest: input.freshGuest || undefined, warning: 'storage' };
  }
  if (input.freshGuest) {
    return { scope, legacyKeys: [], freshGuest: true };
  }
  if (existing) return { scope, legacyKeys: [], sendToken: existing.sessionToken };
  if (!input.legacy) {
    const other = safeOtherScope(input.durable, scope);
    return { scope, legacyKeys: [], ...(other ? { warning: 'other-world' as const } : {}) };
  }
  let legacy: ReturnType<typeof collectLegacyTokens>;
  try {
    legacy = collectLegacyTokens(input.legacy, input.legacyKeys);
  } catch {
    return { scope, legacyKeys: [], warning: 'storage' };
  }
  if (legacy.ambiguous) {
    return {
      scope,
      legacyKeys: legacy.keys,
      blocked: 'ambiguous',
      message: 'Найдено несколько старых гостевых ключей. Автоматически персонаж не выбран.',
    };
  }
  if (legacy.token) return { scope, legacyKeys: legacy.keys, sendToken: legacy.token };
  const other = safeOtherScope(input.durable, scope);
  return { scope, legacyKeys: [], ...(other ? { warning: 'other-world' as const } : {}) };
}

function safeOtherScope(storage: GuestStorage, scope: GuestIdentityScope): boolean {
  try {
    return hasOtherGuestScope(storage, scope);
  } catch {
    return false;
  }
}

export function confirmGuestWelcome(
  durable: GuestStorage | null,
  legacy: GuestStorage | null,
  scope: GuestIdentityScope | undefined,
  sessionToken: string,
  legacyKeys: readonly string[],
): { persisted: boolean; warning?: 'storage' } {
  if (!scope || !durable) return { persisted: false, warning: 'storage' };
  try {
    writeGuestCredential(durable, scope, sessionToken, true);
  } catch {
    return { persisted: false, warning: 'storage' };
  }
  if (legacy && legacyKeys.length > 0) forgetLegacyKeys(legacy, legacyKeys);
  return { persisted: true };
}
