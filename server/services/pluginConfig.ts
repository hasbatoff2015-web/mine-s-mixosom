import type { JsonFileStore } from './jsonStore';

export type ConfigValue = string | number | boolean;

export interface PluginConfigSchema {
  readonly [key: string]: {
    readonly type: 'string' | 'number' | 'boolean';
    readonly description: string;
  };
}

function parseValue(raw: string, type: 'string' | 'number' | 'boolean'): ConfigValue | undefined {
  if (type === 'string') return raw;
  if (type === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  const key = raw.trim().toLowerCase();
  if (key === 'true' || key === '1' || key === 'yes' || key === 'on') return true;
  if (key === 'false' || key === '0' || key === 'no' || key === 'off') return false;
  return undefined;
}

export class PluginConfigService {
  private readonly cache = new Map<string, Record<string, ConfigValue>>();

  constructor(private readonly store: JsonFileStore) {}

  load<T extends Record<string, ConfigValue>>(plugin: string, defaults: T): T {
    const saved = this.store.load<Record<string, ConfigValue>>(`config/${plugin}`, {});
    const merged = { ...defaults, ...saved } as T;
    this.cache.set(plugin, { ...merged });
    this.store.save(`config/${plugin}`, merged);
    return merged;
  }

  getAll(plugin: string): Record<string, ConfigValue> {
    return { ...(this.cache.get(plugin) ?? {}) };
  }

  get<T extends ConfigValue>(plugin: string, key: string, fallback: T): T {
    const value = this.cache.get(plugin)?.[key];
    return (value as T | undefined) ?? fallback;
  }

  set(plugin: string, key: string, value: ConfigValue): void {
    const current = this.cache.get(plugin) ?? {};
    current[key] = value;
    this.cache.set(plugin, current);
    this.store.save(`config/${plugin}`, current);
  }

  setFromString(
    plugin: string,
    key: string,
    raw: string,
    schema: PluginConfigSchema,
  ): { ok: true; value: ConfigValue } | { ok: false; error: string } {
    const field = schema[key];
    if (!field) return { ok: false, error: `Unknown setting '${key}'.` };
    const value = parseValue(raw, field.type);
    if (value === undefined) return { ok: false, error: `Value for '${key}' must be a ${field.type}.` };
    this.set(plugin, key, value);
    return { ok: true, value };
  }
}
