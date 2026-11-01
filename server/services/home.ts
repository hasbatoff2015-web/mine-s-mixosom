import type { JsonFileStore } from './jsonStore';
import { canonicalPlayerId, isPlayerId } from './permissionSubject';
import {
  HOME_LIMIT_ERROR,
  HOME_MISSING_ERROR,
  HOME_NAME_TAKEN_ERROR,
  HOME_PLUGIN_NAME,
  homeNameKey,
  validateHomeName,
  type HomeLocation,
  type HomeStore,
} from '../../shared/homes';

export { HOME_PLUGIN_NAME };

export interface HomeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly home?: HomeLocation;
  readonly homes?: readonly HomeLocation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function migrateHome(raw: unknown): HomeLocation | undefined {
  if (!isRecord(raw) || typeof raw.name !== 'string') return undefined;
  if (typeof raw.worldId !== 'string') return undefined;
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof raw.z !== 'number') return undefined;
  if (![raw.x, raw.y, raw.z].every(Number.isFinite)) return undefined;
  const yaw = typeof raw.yaw === 'number' && Number.isFinite(raw.yaw) ? raw.yaw : undefined;
  const pitch = typeof raw.pitch === 'number' && Number.isFinite(raw.pitch) ? raw.pitch : undefined;
  return {
    name: raw.name,
    worldId: raw.worldId,
    x: raw.x,
    y: raw.y,
    z: raw.z,
    ...(yaw !== undefined ? { yaw } : {}),
    ...(pitch !== undefined ? { pitch } : {}),
  };
}

export class HomeService {
  private store: HomeStore = { version: 2, players: {}, legacy: {} };

  constructor(private readonly files: JsonFileStore) {}

  load(): void {
    const raw = this.files.load<unknown>(`${HOME_PLUGIN_NAME}/homes`, { players: {} });
    const players: Record<string, HomeLocation[]> = {};
    const legacy: Record<string, HomeLocation[]> = {};
    const record = isRecord(raw) ? raw : {};
    const version = record.version === 2 ? 2 : 1;
    if (isRecord(record.players)) {
      for (const [key, list] of Object.entries(record.players)) {
        if (!Array.isArray(list)) continue;
        const homes = list.map(migrateHome).filter((home): home is HomeLocation => Boolean(home));
        if (version === 2 && isPlayerId(key)) players[canonicalPlayerId(key)] = homes;
        else if (version === 2) legacy[key.trim().toLowerCase()] = homes;
        else if (isPlayerId(key)) players[canonicalPlayerId(key)] = homes;
        else legacy[key.trim().toLowerCase()] = homes;
      }
    }
    if (isRecord(record.legacy)) {
      for (const [key, list] of Object.entries(record.legacy)) {
        if (!Array.isArray(list) || isPlayerId(key)) continue;
        const name = key.trim().toLowerCase();
        const homes = list.map(migrateHome).filter((home): home is HomeLocation => Boolean(home));
        legacy[name] = [...(legacy[name] ?? []), ...homes];
      }
    }
    this.store = { version: 2, players, legacy };
    this.persist();
  }

  persist(): void {
    this.files.save(`${HOME_PLUGIN_NAME}/homes`, this.store);
  }

  ownerKey(playerId: string): string {
    return isPlayerId(playerId) ? canonicalPlayerId(playerId) : '';
  }

  list(playerId: string): HomeLocation[] {
    const key = this.ownerKey(playerId);
    if (!key) return [];
    return [...(this.store.players[key] ?? [])];
  }

  legacyList(nickname: string): HomeLocation[] {
    const name = nickname.trim().toLowerCase();
    if (!name || isPlayerId(name)) return [];
    return [...(this.store.legacy?.[name] ?? [])];
  }

  get(playerId: string, name: string): HomeLocation | undefined {
    const key = homeNameKey(name);
    return this.list(playerId).find((home) => homeNameKey(home.name) === key);
  }

  set(
    playerId: string,
    rawName: string,
    location: Omit<HomeLocation, 'name'>,
    maxHomes: number,
  ): HomeResult {
    const valid = validateHomeName(rawName);
    if (!valid.ok) return valid;
    const owner = this.ownerKey(playerId);
    if (!owner) return { ok: false, error: 'Player id is required.' };
    const homes = this.list(playerId);
    const existing = homes.findIndex((home) => homeNameKey(home.name) === homeNameKey(valid.name));
    if (existing < 0 && homes.length >= maxHomes) {
      return { ok: false, error: HOME_LIMIT_ERROR(maxHomes) };
    }
    const next: HomeLocation = { ...location, name: valid.name };
    if (existing >= 0) homes[existing] = next;
    else homes.push(next);
    this.store.players[owner] = homes;
    this.persist();
    return { ok: true, home: next, homes };
  }

  remove(playerId: string, rawName: string): HomeResult {
    const owner = this.ownerKey(playerId);
    if (!owner) return { ok: false, error: HOME_MISSING_ERROR };
    const homes = this.list(playerId);
    const key = homeNameKey(rawName);
    const next = homes.filter((home) => homeNameKey(home.name) !== key);
    if (next.length === homes.length) return { ok: false, error: HOME_MISSING_ERROR };
    this.store.players[owner] = next;
    this.persist();
    return { ok: true, homes: next };
  }

  /**
   * Move one inert nickname home list onto a player id.
   * A name clash leaves the legacy list untouched.
   */
  migrateLegacy(legacyName: string, playerId: string): { ok: true } | { ok: false; error: string } {
    const name = legacyName.trim().toLowerCase();
    const owner = this.ownerKey(playerId);
    if (!name || isPlayerId(name)) return { ok: false, error: 'Legacy homes were not found.' };
    if (!owner) return { ok: false, error: 'Player id is required.' };
    const incoming = this.store.legacy?.[name] ?? [];
    if (incoming.length === 0) return { ok: false, error: 'Legacy homes were not found.' };
    const current = this.store.players[owner] ?? [];
    const taken = new Set(current.map((home) => homeNameKey(home.name)));
    const clash = incoming.filter((home) => taken.has(homeNameKey(home.name)));
    if (clash.length > 0) {
      return { ok: false, error: `Home name already exists: ${clash.map((home) => home.name).join(', ')}` };
    }
    this.store.players[owner] = [...current, ...incoming.map((home) => ({ ...home }))];
    const legacy = { ...(this.store.legacy ?? {}) };
    delete legacy[name];
    this.store.legacy = legacy;
    this.persist();
    return { ok: true };
  }

  renameTaken(ownerName: string, rawName: string, except?: string): boolean {
    const key = homeNameKey(rawName);
    const skip = except ? homeNameKey(except) : '';
    return this.list(ownerName).some((home) => {
      const current = homeNameKey(home.name);
      return current === key && current !== skip;
    });
  }

  uniqueError(): HomeResult {
    return { ok: false, error: HOME_NAME_TAKEN_ERROR };
  }

  all(): HomeLocation[] {
    const homes: HomeLocation[] = [];
    for (const list of Object.values(this.store.players)) homes.push(...list);
    return homes;
  }
}
