/**
 * Durable guest recovery credential. The browser stores an opaque token.
 * The server player id stays in the world save.
 */

export interface GuestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): readonly string[];
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
export const GUEST_SCOPE_KEY_PREFIX = 'fc.guest.v2/';
/** Pending first-join id. Separate from the credential so a failed welcome cannot erase it. */
export const GUEST_REGISTRATION_KEY_PREFIX = 'fc.guest.reg.v1/';
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

/** One localStorage key per deployment, mode and world. Components are escaped so values cannot collide. */
export function guestScopeStorageKey(scope: GuestIdentityScope): string {
  return `${GUEST_SCOPE_KEY_PREFIX}${encodeURIComponent(scope.deployment)}/${encodeURIComponent(scope.mode)}/${encodeURIComponent(scope.worldId)}`;
}

/** One pending registration per deployment, mode and world. Not a session token. */
export function guestRegistrationStorageKey(scope: GuestIdentityScope): string {
  return `${GUEST_REGISTRATION_KEY_PREFIX}${encodeURIComponent(scope.deployment)}/${encodeURIComponent(scope.mode)}/${encodeURIComponent(scope.worldId)}`;
}

export function parseGuestScopeStorageKey(key: string): GuestIdentityScope | null {
  if (!key.startsWith(GUEST_SCOPE_KEY_PREFIX)) return null;
  const parts = key.slice(GUEST_SCOPE_KEY_PREFIX.length).split('/');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  try {
    return {
      deployment: decodeURIComponent(parts[0]!),
      mode: decodeURIComponent(parts[1]!),
      worldId: decodeURIComponent(parts[2]!),
    };
  } catch {
    return null;
  }
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
  constructor(readonly reason: 'unavailable' | 'quota' | 'corrupt' | 'unsupported' | 'invalid' | 'exists' | 'unreliable') {
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

type ScopedRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly record: GuestCredentialRecord }
  | { readonly kind: 'corrupt'; readonly raw: string }
  | { readonly kind: 'unsupported'; readonly raw: string }
  | { readonly kind: 'unavailable' };

function readScopedRecord(storage: GuestStorage, scope: GuestIdentityScope): ScopedRead {
  const key = guestScopeStorageKey(scope);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
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
  if (root.version !== 2) return { kind: 'unsupported', raw };
  const row = parseRecord({ sessionToken: root.sessionToken, ...(root.retained !== undefined ? { retained: root.retained } : {}) });
  if (!row) return { kind: 'corrupt', raw };
  return { kind: 'valid', record: { sessionToken: row.sessionToken, retained: row.retained ?? [] } };
}

function v1Record(storage: GuestStorage, scope: GuestIdentityScope): GuestCredentialRecord | 'blocked' | null {
  const read = readGuestStore(storage);
  if (read.kind === 'unavailable' || read.kind === 'corrupt' || read.kind === 'unsupported') return 'blocked';
  if (read.kind !== 'valid') return null;
  const row = read.file.records[guestScopeKey(scope)];
  if (!row) return null;
  return { sessionToken: row.sessionToken, retained: row.retained ?? [] };
}

export function readGuestCredential(storage: GuestStorage, scope: GuestIdentityScope): GuestCredentialRecord | null {
  const scoped = readScopedRecord(storage, scope);
  if (scoped.kind === 'unavailable') throw new GuestStorageError('unavailable');
  if (scoped.kind === 'corrupt') throw new GuestStorageError('corrupt');
  if (scoped.kind === 'unsupported') throw new GuestStorageError('unsupported');
  if (scoped.kind === 'valid') return scoped.record;
  const legacy = v1Record(storage, scope);
  if (legacy === 'blocked') {
    const read = readGuestStore(storage);
    if (read.kind === 'unavailable') throw new GuestStorageError('unavailable');
    if (read.kind === 'unsupported') throw new GuestStorageError('unsupported');
    throw new GuestStorageError('corrupt');
  }
  return legacy;
}

export function sameModeOtherWorld(storage: GuestStorage, scope: GuestIdentityScope): boolean {
  const own = guestScopeStorageKey(scope);
  let names: readonly string[];
  try {
    names = storage.keys();
  } catch {
    throw new GuestStorageError('unavailable');
  }
  for (const key of names) {
    if (key === own) continue;
    const parsed = parseGuestScopeStorageKey(key);
    if (!parsed || parsed.deployment !== scope.deployment || parsed.mode !== scope.mode || parsed.worldId === scope.worldId) continue;
    const row = readScopedRecord(storage, parsed);
    if (row.kind === 'valid') return true;
    if (row.kind === 'corrupt') throw new GuestStorageError('corrupt');
    if (row.kind === 'unsupported') throw new GuestStorageError('unsupported');
    if (row.kind === 'unavailable') throw new GuestStorageError('unavailable');
  }
  const read = readGuestStore(storage);
  if (read.kind === 'unavailable') throw new GuestStorageError('unavailable');
  if (read.kind === 'corrupt') throw new GuestStorageError('corrupt');
  if (read.kind === 'unsupported') throw new GuestStorageError('unsupported');
  if (read.kind !== 'valid') return false;
  const prefix = `${scope.deployment}|${scope.mode}|`;
  const ownV1 = guestScopeKey(scope);
  return Object.keys(read.file.records).some((key) => key.startsWith(prefix) && key !== ownV1);
}

function previousCredential(storage: GuestStorage, scope: GuestIdentityScope): GuestCredentialRecord | null {
  const scoped = readScopedRecord(storage, scope);
  if (scoped.kind === 'corrupt') throw new GuestStorageError('corrupt');
  if (scoped.kind === 'unsupported') throw new GuestStorageError('unsupported');
  if (scoped.kind === 'unavailable') throw new GuestStorageError('unavailable');
  if (scoped.kind === 'valid') return scoped.record;
  const legacy = v1Record(storage, scope);
  if (legacy === 'blocked') {
    const read = readGuestStore(storage);
    if (read.kind === 'unsupported') throw new GuestStorageError('unsupported');
    if (read.kind === 'unavailable') throw new GuestStorageError('unavailable');
    throw new GuestStorageError('corrupt');
  }
  return legacy;
}

export function writeGuestCredential(
  storage: GuestStorage,
  scope: GuestIdentityScope,
  sessionToken: string,
  retainPrevious = true,
): void {
  if (!isGuestToken(sessionToken)) throw new GuestStorageError('invalid');
  const previous = previousCredential(storage, scope);
  const retained = new Set(previous?.retained ?? []);
  if (retainPrevious && previous && previous.sessionToken !== sessionToken) retained.add(previous.sessionToken);
  retained.delete(sessionToken);
  const record = {
    version: 2 as const,
    sessionToken,
    ...(retained.size > 0 ? { retained: [...retained] } : {}),
  };
  try {
    storage.setItem(guestScopeStorageKey(scope), JSON.stringify(record));
  } catch (error) {
    if (error instanceof GuestStorageError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'QuotaExceededError') throw new GuestStorageError('quota');
    throw new GuestStorageError('unavailable');
  }
}

/** Updates one scope and leaves every other saved record in place. */
export function importGuestCredential(
  storage: GuestStorage,
  scope: GuestIdentityScope,
  sessionToken: string,
  replace = false,
): void {
  if (!isGuestToken(sessionToken)) throw new GuestStorageError('invalid');
  const previous = previousCredential(storage, scope);
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

/** In-memory approval for one deployment, mode and world. Not stored and not sent to the server. */
export interface FreshGuestConsent {
  readonly scope: GuestIdentityScope;
  readonly previousCredential: string | null;
  readonly reason: 'unknown_guest' | 'world_changed';
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
    /** Shared by every tab that is still creating this slot. The server dedupes it. */
    readonly registrationId?: string;
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
    readonly outcome: 'storage_unavailable' | 'storage_corrupt' | 'storage_unsupported' | 'world_changed' | 'mode_mismatch' | 'status_unavailable' | 'status_timeout' | 'ambiguous_legacy' | 'consent_mismatch';
    readonly legacyKeys: readonly string[];
    readonly message: string;
    readonly scope?: GuestIdentityScope;
  };

export function planGuestJoin(input: {
  readonly trusted: boolean;
  readonly freshGuest: boolean;
  readonly freshConsent?: FreshGuestConsent;
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
  const scoped = readScopedRecord(input.durable, scope);
  if (scoped.kind === 'unavailable') {
    if (input.allowEphemeral) return { outcome: 'ready_new', scope, legacyKeys: [], ephemeral: true, freshGuest: true };
    return {
      outcome: 'storage_unavailable',
      legacyKeys: [],
      scope,
      message: 'Браузер не смог прочитать сохранённую личность. Новый персонаж не создавался.',
    };
  }
  if (scoped.kind === 'corrupt') {
    return {
      outcome: 'storage_corrupt',
      legacyKeys: [],
      scope,
      message: 'Сохранённые гостевые ключи повреждены. Они не перезаписаны и новый персонаж не создавался.',
    };
  }
  if (scoped.kind === 'unsupported') {
    return {
      outcome: 'storage_unsupported',
      legacyKeys: [],
      scope,
      message: 'Формат сохранённых гостевых ключей не поддерживается. Запись не изменена.',
    };
  }
  if (scoped.kind === 'absent') {
    const legacyFile = readGuestStore(input.durable);
    if (legacyFile.kind === 'unavailable') {
      if (input.allowEphemeral) return { outcome: 'ready_new', scope, legacyKeys: [], ephemeral: true, freshGuest: true };
      return {
        outcome: 'storage_unavailable',
        legacyKeys: [],
        scope,
        message: 'Браузер не смог прочитать сохранённую личность. Новый персонаж не создавался.',
      };
    }
    if (legacyFile.kind === 'corrupt') {
      return {
        outcome: 'storage_corrupt',
        legacyKeys: [],
        scope,
        message: 'Сохранённые гостевые ключи повреждены. Они не перезаписаны и новый персонаж не создавался.',
      };
    }
    if (legacyFile.kind === 'unsupported') {
      return {
        outcome: 'storage_unsupported',
        legacyKeys: [],
        scope,
        message: 'Формат сохранённых гостевых ключей не поддерживается. Запись не изменена.',
      };
    }
  }
  const migrated = scoped.kind === 'absent' ? v1Record(input.durable, scope) : null;
  const existingToken = scoped.kind === 'valid'
    ? scoped.record.sessionToken
    : migrated && migrated !== 'blocked' ? migrated.sessionToken : undefined;
  const consent = input.freshConsent;
  if (consent) {
    const sameScope = consent.scope.deployment === scope.deployment
      && consent.scope.mode === scope.mode
      && consent.scope.worldId === scope.worldId;
    if (!sameScope) {
      return {
        outcome: 'consent_mismatch',
        legacyKeys: [],
        scope,
        message: 'Подтверждение было для другого мира. Новый персонаж не создавался.',
      };
    }
    if (existingToken && existingToken !== consent.previousCredential) {
      return { outcome: 'ready_existing', scope, legacyKeys: [], sendToken: existingToken };
    }
    return { outcome: 'ready_new', scope, legacyKeys: [], freshGuest: true };
  }
  if (existingToken) return { outcome: 'ready_existing', scope, legacyKeys: [], sendToken: existingToken };
  try {
    if (sameModeOtherWorld(input.durable, scope)) {
      return {
        outcome: 'world_changed',
        legacyKeys: [],
        scope,
        message: 'Сервер открыл другой сохранённый мир этого режима. Новый персонаж не создавался.',
      };
    }
  } catch (error) {
    if (error instanceof GuestStorageError) {
      const outcome = error.reason === 'corrupt'
        ? 'storage_corrupt'
        : error.reason === 'unsupported'
          ? 'storage_unsupported'
          : 'storage_unavailable';
      const message = outcome === 'storage_corrupt'
        ? 'Сохранённые гостевые ключи повреждены. Они не перезаписаны и новый персонаж не создавался.'
        : outcome === 'storage_unsupported'
          ? 'Формат сохранённых гостевых ключей не поддерживается. Запись не изменена.'
          : 'Браузер не смог проверить прежние миры. Новый персонаж не создавался.';
      return { outcome, legacyKeys: [], scope, message };
    }
    throw error;
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
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    try {
      writeGuestCredential(durable, scope, sessionToken, true);
      saved = true;
    } catch {
      saved = false;
    }
  }
  if (!saved) return { persisted: false, code: 'storage_write_failed' };
  clearGuestRegistration(durable, scope);
  if (legacy && legacyKeys.length > 0) forgetLegacyKeys(legacy, legacyKeys);
  return { persisted: true };
}

type RegistrationRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly registrationId: string }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'unavailable' };

function isRegistrationId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= TOKEN_MAX && !/\s/.test(value);
}

export function readGuestRegistration(storage: GuestStorage, scope: GuestIdentityScope): RegistrationRead {
  let raw: string | null;
  try {
    raw = storage.getItem(guestRegistrationStorageKey(scope));
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw == null || raw === '') return { kind: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'corrupt' };
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1) return { kind: 'unsupported' };
  if (!isRegistrationId(root.registrationId)) return { kind: 'corrupt' };
  return { kind: 'valid', registrationId: root.registrationId };
}

function writeGuestRegistration(storage: GuestStorage, scope: GuestIdentityScope, registrationId: string): void {
  if (!isRegistrationId(registrationId)) throw new GuestStorageError('invalid');
  try {
    storage.setItem(guestRegistrationStorageKey(scope), JSON.stringify({ version: 1, registrationId }));
  } catch (error) {
    if (error instanceof GuestStorageError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'QuotaExceededError') throw new GuestStorageError('quota');
    throw new GuestStorageError('unavailable');
  }
}

/** Removes the pending id after the credential is stored. A failure leaves the retry key in place. */
export function clearGuestRegistration(storage: GuestStorage, scope: GuestIdentityScope): void {
  try {
    storage.removeItem(guestRegistrationStorageKey(scope));
  } catch {
    // The saved credential is the source of truth. The pending key is only a retry.
  }
}

function registrationFailure(read: RegistrationRead): GuestStorageError | null {
  if (read.kind === 'corrupt') return new GuestStorageError('corrupt');
  if (read.kind === 'unsupported') return new GuestStorageError('unsupported');
  if (read.kind === 'unavailable') return new GuestStorageError('unavailable');
  return null;
}

const REGISTRATION_DB = 'fc-guest-reg';
const REGISTRATION_STORE = 'registrations';

/**
 * IndexedDB readwrite transactions on one store are serialized across tabs.
 * `absent` means there is no factory. `failed` means open or the transaction
 * actually failed. A failed open is not treated as a successful lock.
 */
function claimRegistrationIndexedDb(
  scope: GuestIdentityScope,
  storage: GuestStorage,
  replace: boolean,
  randomId: () => string,
  factory: IDBFactory | undefined,
): Promise<string | 'absent' | 'failed'> {
  if (!factory) return Promise.resolve('absent');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | 'failed'): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(REGISTRATION_DB, 1);
    } catch {
      finish('failed');
      return;
    }
    request.onerror = () => finish('failed');
    request.onblocked = () => finish('failed');
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(REGISTRATION_STORE)) db.createObjectStore(REGISTRATION_STORE);
      } catch {
        finish('failed');
      }
    };
    request.onsuccess = () => {
      let tx: IDBTransaction;
      try {
        tx = request.result.transaction(REGISTRATION_STORE, 'readwrite');
      } catch {
        finish('failed');
        return;
      }
      tx.onerror = () => finish('failed');
      tx.onabort = () => finish('failed');
      const store = tx.objectStore(REGISTRATION_STORE);
      const key = guestScopeKey(scope);
      const get = store.get(key);
      get.onerror = () => finish('failed');
      get.onsuccess = () => {
        const existing = get.result as { registrationId?: unknown } | undefined;
        if (!replace && isRegistrationId(existing?.registrationId)) {
          try {
            writeGuestRegistration(storage, scope, existing.registrationId);
          } catch {
            // The IndexedDB row is still the shared id. A local mirror failure
            // must not mint a second registration.
          }
          finish(existing.registrationId);
          return;
        }
        const id = randomId();
        const put = store.put({ registrationId: id }, key);
        put.onerror = () => finish('failed');
        put.onsuccess = () => {
          try {
            writeGuestRegistration(storage, scope, id);
          } catch {
            // Same as above: the transaction already stored the id.
          }
          finish(id);
        };
      };
    };
  });
}

/**
 * One registration id for every tab creating this slot.
 * A valid pending record is reused and is not a new character.
 * A damaged record is not treated as empty and is not overwritten.
 * A new id is written only inside a Web Lock (`lockHeld`) or a successful
 * IndexedDB transaction. localStorage alone is not treated as that lock.
 */
export async function claimGuestRegistration(
  storage: GuestStorage,
  scope: GuestIdentityScope,
  options?: {
    readonly randomId?: () => string;
    readonly replace?: boolean;
    readonly lockHeld?: boolean;
    readonly indexedDb?: IDBFactory;
  },
): Promise<string> {
  const replace = options?.replace === true;
  const randomId = options?.randomId ?? (() => crypto.randomUUID());
  const current = readGuestRegistration(storage, scope);
  const blocked = registrationFailure(current);
  if (blocked) throw blocked;
  if (!replace && current.kind === 'valid') return current.registrationId;
  const factory = options?.indexedDb ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  const indexed = await claimRegistrationIndexedDb(scope, storage, replace, randomId, factory);
  if (indexed !== 'absent' && indexed !== 'failed') return indexed;
  if (options?.lockHeld) {
    const id = randomId();
    writeGuestRegistration(storage, scope, id);
    const again = readGuestRegistration(storage, scope);
    const againBlocked = registrationFailure(again);
    if (againBlocked) throw againBlocked;
    if (again.kind === 'valid') return again.registrationId;
    throw new GuestStorageError('unavailable');
  }
  throw new GuestStorageError('unreliable');
}

export interface GuestScopeLock {
  request<R>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<R>): Promise<R>;
}

export async function withGuestScopeLock<T>(
  scope: GuestIdentityScope,
  body: () => Promise<T>,
  locks?: GuestScopeLock,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw Object.assign(new Error('Подключение отменено'), { code: 'cancelled' });
  const name = `fc-guest:${guestScopeKey(scope)}`;
  if (locks?.request) return locks.request(name, { signal }, body);
  return body();
}
