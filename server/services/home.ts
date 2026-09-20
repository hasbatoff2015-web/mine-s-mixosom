import type { JsonFileStore } from './jsonStore';
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
  private store: HomeStore = { players: {} };

  constructor(private readonly files: JsonFileStore) {}

  load(): void {
    const raw = this.files.load<unknown>(`${HOME_PLUGIN_NAME}/homes`, { players: {} });
    const players: Record<string, HomeLocation[]> = {};
    if (isRecord(raw) && isRecord(raw.players)) {
      for (const [key, list] of Object.entries(raw.players)) {
        if (!Array.isArray(list)) continue;
        players[key.toLowerCase()] = list.map(migrateHome).filter((home): home is HomeLocation => Boolean(home));
      }
    }
    this.store = { players };
  }

  persist(): void {
    this.files.save(`${HOME_PLUGIN_NAME}/homes`, this.store);
  }

  ownerKey(name: string): string {
    return name.trim().toLowerCase();
  }

  list(ownerName: string): HomeLocation[] {
    return [...(this.store.players[this.ownerKey(ownerName)] ?? [])];
  }

  get(ownerName: string, name: string): HomeLocation | undefined {
    const key = homeNameKey(name);
    return this.list(ownerName).find((home) => homeNameKey(home.name) === key);
  }

  set(
    ownerName: string,
    rawName: string,
    location: Omit<HomeLocation, 'name'>,
    maxHomes: number,
  ): HomeResult {
    const valid = validateHomeName(rawName);
    if (!valid.ok) return valid;
    const owner = this.ownerKey(ownerName);
    const homes = this.list(ownerName);
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

  remove(ownerName: string, rawName: string): HomeResult {
    const owner = this.ownerKey(ownerName);
    const homes = this.list(ownerName);
    const key = homeNameKey(rawName);
    const next = homes.filter((home) => homeNameKey(home.name) !== key);
    if (next.length === homes.length) return { ok: false, error: HOME_MISSING_ERROR };
    this.store.players[owner] = next;
    this.persist();
    return { ok: true, homes: next };
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
