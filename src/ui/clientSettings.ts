/**
 * Versioned client-only preferences. Gameplay authority (gamemode, inventory,
 * position, health) is never stored here.
 */

export const CLIENT_SETTINGS_STORAGE_KEY = 'megacraft.settings.v1';
export const CLIENT_SETTINGS_VERSION = 1;

export interface ClientSettings {
  volume: number;
  sensitivity: number;
  renderDistance: number;
  fov: number;
  clouds: boolean;
}

export const CLIENT_SETTINGS_LIMITS = {
  volume: { min: 0, max: 1 },
  sensitivity: { min: 0.0007, max: 0.005 },
  renderDistance: { min: 2, max: 6 },
  fov: { min: 60, max: 100 },
} as const;

export interface ClientSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultClientSettings(coarsePointer = false): ClientSettings {
  return {
    volume: 0.7,
    sensitivity: 0.0022,
    renderDistance: coarsePointer ? 2 : 4,
    fov: 75,
    clouds: true,
  };
}

function defaultStorage(): ClientSettingsStorage | undefined {
  try {
    const storage = (globalThis as { localStorage?: ClientSettingsStorage }).localStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return undefined;
    }
    return storage;
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickNumber(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = finiteNumber(raw);
  if (value === undefined) return fallback;
  return clamp(value, min, max);
}

function pickClouds(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 1) return true;
  if (raw === 'false' || raw === 0) return false;
  return fallback;
}

/** Merge a stored object onto defaults. Bad fields fall back one at a time. */
export function sanitizeClientSettings(
  raw: unknown,
  fallback: ClientSettings = defaultClientSettings(false),
): ClientSettings {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    volume: pickNumber(source.volume, fallback.volume, CLIENT_SETTINGS_LIMITS.volume.min, CLIENT_SETTINGS_LIMITS.volume.max),
    sensitivity: pickNumber(
      source.sensitivity,
      fallback.sensitivity,
      CLIENT_SETTINGS_LIMITS.sensitivity.min,
      CLIENT_SETTINGS_LIMITS.sensitivity.max,
    ),
    renderDistance: Math.round(pickNumber(
      source.renderDistance,
      fallback.renderDistance,
      CLIENT_SETTINGS_LIMITS.renderDistance.min,
      CLIENT_SETTINGS_LIMITS.renderDistance.max,
    )),
    fov: Math.round(pickNumber(source.fov, fallback.fov, CLIENT_SETTINGS_LIMITS.fov.min, CLIENT_SETTINGS_LIMITS.fov.max)),
    clouds: pickClouds(source.clouds, fallback.clouds),
  };
}

export function loadClientSettings(
  storage: ClientSettingsStorage | undefined = defaultStorage(),
  coarsePointer = false,
): ClientSettings {
  const fallback = defaultClientSettings(coarsePointer);
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return sanitizeClientSettings(parsed, fallback);
  } catch {
    return fallback;
  }
}

export function saveClientSettings(
  settings: ClientSettings,
  storage: ClientSettingsStorage | undefined = defaultStorage(),
): ClientSettings {
  const next = sanitizeClientSettings(settings);
  if (!storage) return next;
  try {
    storage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify({
      v: CLIENT_SETTINGS_VERSION,
      volume: next.volume,
      sensitivity: next.sensitivity,
      renderDistance: next.renderDistance,
      fov: next.fov,
      clouds: next.clouds,
    }));
  } catch {
    return next;
  }
  return next;
}
