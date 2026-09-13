import {
  HOME_LIMIT_ERROR,
  HOME_MAX_DEFAULT,
  HOME_MISSING_ERROR,
  HOME_NAME_TAKEN_ERROR,
  HOME_PLUGIN_NAME,
  homeNameKey,
  validateHomeName,
} from '../../shared/homes';
import type { JsonFileStore } from './jsonStore';

export { HOME_PLUGIN_NAME, HOME_MAX_DEFAULT };

export interface HomeLocation {
  name: string;
  nameKey: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
}

export interface HomeStore {
  players: Record<string, HomeLocation[]>;
}

export interface HomeResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly home?: HomeLocation;
  readonly homes?: readonly HomeLocation[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseHome(value: unknown): HomeLocation | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.worldId !== 'string') return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  const name = value.name.trim() || 'home';
  const nameKey = typeof value.nameKey === 'string' && value.nameKey ? value.nameKey : homeNameKey(name);
  return { name, nameKey, worldId: value.worldId, x, y, z };
}

export function migrateHomeStore(raw: unknown): HomeStore {
  if (!isRecord(raw) || !isRecord(raw.players)) return { players: {} };
  const players: Record<string, HomeLocation[]> = {};
  for (const [owner, list] of Object.entries(raw.players)) {
    if (!Array.isArray(list)) continue;
    players[owner.toLowerCase()] = list.map(parseHome).filter((home): home is HomeLocation => Boolean(home));
  }
  return { players };
}

export class HomeService {
  private store: HomeStore = { players: {} };

  constructor(private readonly files: JsonFileStore) {
    this.load();
  }

  load(): void {
    this.store = migrateHomeStore(this.files.load<unknown>(`${HOME_PLUGIN_NAME}/homes`, { players: {} }));
  }

  persist(): void {
    this.files.save(`${HOME_PLUGIN_NAME}/homes`, this.store);
  }

  list(ownerKey: string): HomeLocation[] {
    return [...(this.store.players[ownerKey.toLowerCase()] ?? [])];
  }

  find(ownerKey: string, name: string): HomeLocation | undefined {
    const key = homeNameKey(name);
    return this.list(ownerKey).find((home) => home.nameKey === key || home.name.toLowerCase() === key);
  }

  set(
    ownerKey: string,
    rawName: string,
    pos: { readonly worldId: string; readonly x: number; readonly y: number; readonly z: number },
    maxHomes: number,
  ): HomeResult {
    const parsed = validateHomeName(rawName);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const owner = ownerKey.toLowerCase();
    const homes = this.list(owner);
    const existing = homes.findIndex((home) => home.nameKey === homeNameKey(parsed.name));
    if (existing < 0 && homes.length >= maxHomes) {
      return { ok: false, error: maxHomes <= HOME_MAX_DEFAULT ? HOME_LIMIT_ERROR : `You can only set ${maxHomes} home(s).` };
    }
    if (existing < 0) {
      const taken = homes.some((home) => home.nameKey === homeNameKey(parsed.name));
      if (taken) return { ok: false, error: HOME_NAME_TAKEN_ERROR };
    }
    const next: HomeLocation = {
      name: parsed.name,
      nameKey: homeNameKey(parsed.name),
      worldId: pos.worldId,
      x: pos.x,
      y: pos.y,
      z: pos.z,
    };
    if (existing >= 0) homes[existing] = next;
    else homes.push(next);
    this.store.players[owner] = homes;
    this.persist();
    return { ok: true, home: next, homes };
  }

  remove(ownerKey: string, name: string): HomeResult {
    const owner = ownerKey.toLowerCase();
    const homes = this.list(owner);
    const key = homeNameKey(name);
    const next = homes.filter((home) => home.nameKey !== key);
    if (next.length === homes.length) return { ok: false, error: HOME_MISSING_ERROR };
    this.store.players[owner] = next;
    this.persist();
    return { ok: true, homes: next };
  }
}
