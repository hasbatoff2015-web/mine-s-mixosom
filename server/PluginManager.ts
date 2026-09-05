import type { GameMode, PlayerSnapshot } from '../shared/protocol';
import type { EventBus, ServerEventName, EventHandler } from './events';
import { CONSOLE_SENDER_ID, type CommandHandler, type CommandRegistry } from './commands';
import { bundledExampleDir, discoverPluginModules } from './pluginLoader';
import { serverLog } from './log';
import type { PermissionService } from './services/permissions';
import type { PluginConfigService, ConfigValue } from './services/pluginConfig';
import type { TeleportReason, TeleportService, TeleportHistoryService, TeleportScheduleOptions } from './services/teleport';
import { formatPluginHelp, type PluginHelpMeta } from './services/pluginHelp';

/** Separate from protocol version, world schema, and schematic import version. */
export const PLUGIN_API_VERSION = 1;

/** Startup hooks may return a Promise; the server waits at most this long. */
export const PLUGIN_HOOK_TIMEOUT_MS = 2_000;

export type PluginPhase = 'registered' | 'loaded' | 'enabled' | 'disabled' | 'failed';

export interface ServerStatus {
  readonly worldId: string;
  readonly seed: string;
  readonly readyState: string;
  readonly tickRate: number;
  readonly tickNumber: number;
  readonly playerCount: number;
  readonly pluginApiVersion: number;
}

export interface PluginEntityView {
  readonly id: string;
  readonly kind: 'player' | 'mob' | 'minecart' | 'item' | 'arrow' | 'falling';
}

export interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  readonly gamemode: GameMode;
  health(): number;
  position(): { readonly x: number; readonly y: number; readonly z: number };
  snapshot(): PlayerSnapshot;
  teleport(x: number, y: number, z: number): boolean;
  sendMessage(text: string): void;
  give(itemId: string, count: number): { given: number; leftover: number };
  removeItem(itemId: string, count: number): number;
  clearInventory(): number;
  hasItem(itemId: string, count?: number): boolean;
  kick(reason?: string): void;
}

export interface WorldView {
  readonly seed: string;
  readonly worldId: string;
  spawn(): readonly [number, number, number];
  setSpawn(x: number, y: number, z: number): boolean;
  getTimeOfDay(): number;
  getBlock(x: number, y: number, z: number): number;
  /** Mutates authoritative world, persists, and broadcasts. Plugins must use this — not a client. */
  setBlock(x: number, y: number, z: number, blockId: number): boolean;
  breakBlock(x: number, y: number, z: number): boolean;
  getEntity(id: string): PluginEntityView | undefined;
  surfaceY(x: number, z: number): number;
  isSolid(x: number, y: number, z: number): boolean;
  isLiquid(x: number, y: number, z: number): boolean;
}

export interface PluginHost {
  status(): ServerStatus;
  world(): WorldView;
  players(): readonly PlayerView[];
  player(idOrName: string): PlayerView | undefined;
  broadcast(text: string): void;
  permissions?(): PermissionService;
  teleports?(): TeleportService;
  history?(): TeleportHistoryService;
  config?(): PluginConfigService;
  dataLoad?<T>(plugin: string, key: string, fallback: T): T;
  dataSave?(plugin: string, key: string, value: unknown): void;
}

export interface ServerAPI {
  readonly apiVersion: number;
  getStatus(): ServerStatus;
  getWorld(): WorldView;
  getPlayers(): readonly PlayerView[];
  getPlayer(idOrName: string): PlayerView | undefined;
  broadcast(text: string): void;
  registerCommand(handler: CommandHandler): () => void;
  registerEvent<K extends ServerEventName>(name: K, handler: EventHandler<K>): () => void;
  scheduleOnce(ms: number, fn: () => void): () => void;
  scheduleRepeating(ms: number, fn: () => void): () => void;
  log(message: string): void;
  hasPermission(playerIdOrName: string, node: string): boolean;
  isOperator(playerIdOrName: string): boolean;
  teleport(
    playerId: string,
    x: number,
    y: number,
    z: number,
    reason?: TeleportReason,
    options?: TeleportScheduleOptions,
  ): { ok: boolean; error?: string };
  lastTeleport(playerId: string): { worldId: string; x: number; y: number; z: number; reason: TeleportReason } | undefined;
  consumeLastTeleport(playerId: string): { worldId: string; x: number; y: number; z: number; reason: TeleportReason } | undefined;
  loadData<T>(key: string, fallback: T): T;
  saveData(key: string, value: unknown): void;
  loadConfig<T extends Record<string, ConfigValue>>(defaults: T): T;
  getConfig<T extends ConfigValue>(key: string, fallback: T): T;
  setConfig(key: string, value: ConfigValue): void;
  formatHelp(meta: PluginHelpMeta): string[];
}

export interface Plugin {
  readonly name: string;
  readonly version?: string;
  /** Must match `PLUGIN_API_VERSION` when set. Omitted = current (inline/test plugins). */
  readonly apiVersion?: number;
  onLoad?(api: ServerAPI): void | Promise<void>;
  onEnable?(api: ServerAPI): void | Promise<void>;
  onDisable?(): void | Promise<void>;
}

interface PluginBindings {
  readonly unsubscribers: Array<() => void>;
  readonly timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>;
  api?: ServerAPI;
  loadCount: number;
  enableCount: number;
  disableCount: number;
}

export interface PluginRecord {
  readonly plugin: Plugin;
  phase: PluginPhase;
  readonly source?: string;
  readonly error?: string;
  readonly loadCount: number;
  readonly enableCount: number;
  readonly disableCount: number;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return Boolean(value) && typeof value === 'object' && typeof (value as Promise<unknown>).then === 'function';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

async function withTimeout(promise: Promise<unknown>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${PLUGIN_HOOK_TIMEOUT_MS}ms`)), PLUGIN_HOOK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class PluginManager {
  private readonly plugins: Plugin[] = [];
  private readonly records = new Map<string, { plugin: Plugin; phase: PluginPhase; source?: string; error?: string }>();
  private readonly bindings = new Map<string, PluginBindings>();
  private host: PluginHost | undefined;
  private globallyEnabled = false;
  private lastBoot: Promise<void> | undefined;

  constructor(
    private readonly events: EventBus,
    private readonly commands: CommandRegistry,
  ) {}

  attachHost(host: PluginHost): void {
    this.host = host;
  }

  /** @deprecated Use attachHost. Kept so older call sites compile during the swap. */
  createApi(world: WorldView, players: () => readonly PlayerView[], broadcast: (text: string) => void): ServerAPI {
    this.attachHost({
      status: () => ({
        worldId: world.worldId,
        seed: world.seed,
        readyState: 'READY',
        tickRate: 20,
        tickNumber: 0,
        playerCount: players().length,
        pluginApiVersion: PLUGIN_API_VERSION,
      }),
      world: () => world,
      players,
      player: (idOrName) => {
        const list = players();
        const lower = idOrName.toLowerCase();
        return list.find((entry) => entry.id === idOrName) ?? list.find((entry) => entry.name.toLowerCase() === lower);
      },
      broadcast,
    });
    return this.scopedApi('__host__');
  }

  private add(plugin: Plugin, source?: string): void {
    if (this.plugins.some((entry) => entry.name === plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    this.plugins.push(plugin);
    this.records.set(plugin.name, { plugin, phase: 'registered', source });
    this.bindings.set(plugin.name, { unsubscribers: [], timers: [], loadCount: 0, enableCount: 0, disableCount: 0 });
  }

  register(plugin: Plugin, options?: { source?: string }): void {
    this.add(plugin, options?.source);
    if (this.host) this.lastBoot = this.boot(plugin);
  }

  /** Wait for the latest register()/enableAll() hook to finish. */
  async whenReady(): Promise<void> {
    if (this.lastBoot) await this.lastBoot;
  }

  async discover(dir: string): Promise<void> {
    const { loaded, errors } = await discoverPluginModules(dir);
    for (const failure of errors) {
      serverLog(`plugins: skip ${failure.source}: ${failure.error}`, 'error');
    }
    for (const entry of loaded) {
      try {
        this.add(entry.plugin, entry.source);
      } catch (error) {
        serverLog(`plugins: register ${entry.plugin.name} failed: ${errorMessage(error)}`, 'error');
        this.fail(entry.plugin.name, errorMessage(error));
      }
    }
    const names = loaded.map((entry) => entry.plugin.name);
    serverLog(
      names.length > 0
        ? `plugins: discovered ${names.length} from ${dir}: ${names.join(', ')}`
        : `plugins: discovered 0 from ${dir} (none)`,
    );
  }

  /**
   * Register `server/plugin-examples` for local QA (`FC_EXAMPLE_PLUGIN=1`).
   * Does not scan test fixtures. Safe if the same plugin is already in pluginDir.
   */
  async loadBundledExample(): Promise<void> {
    const { loaded, errors } = await discoverPluginModules(bundledExampleDir());
    for (const failure of errors) {
      serverLog(`plugins: skip bundled example ${failure.source}: ${failure.error}`, 'error');
    }
    for (const entry of loaded) {
      if (this.plugins.some((plugin) => plugin.name === entry.plugin.name)) {
        serverLog(`plugins: bundled example '${entry.plugin.name}' already registered`);
        continue;
      }
      this.add(entry.plugin, 'bundled:example');
    }
    if (loaded.length > 0) {
      serverLog('plugins: loaded bundled example (FC_EXAMPLE_PLUGIN=1)');
    }
  }

  async loadAll(): Promise<void> {
    if (!this.host) return;
    if (this.lastBoot) await this.lastBoot;
    this.lastBoot = (async () => {
      for (const plugin of this.plugins) await this.loadOne(plugin);
    })();
    await this.lastBoot;
  }

  async enableAll(): Promise<void> {
    if (!this.host) return;
    if (this.lastBoot) await this.lastBoot;
    this.globallyEnabled = true;
    this.lastBoot = (async () => {
      for (const plugin of this.plugins) await this.enableOne(plugin);
    })();
    await this.lastBoot;
  }

  async disableAll(): Promise<void> {
    if (this.lastBoot) await this.lastBoot.catch(() => undefined);
    this.globallyEnabled = false;
    for (const plugin of [...this.plugins].reverse()) await this.disableOne(plugin);
  }

  async disable(name: string): Promise<void> {
    const plugin = this.plugins.find((entry) => entry.name === name);
    if (plugin) await this.disableOne(plugin);
  }

  /**
   * Re-enable a disabled plugin. `enableAll()` stays idempotent and will not
   * revive plugins that were explicitly disabled.
   */
  async enable(name: string): Promise<boolean> {
    const plugin = this.plugins.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!plugin) return false;
    const record = this.records.get(plugin.name);
    if (!record || record.phase === 'failed') return false;
    if (record.phase === 'enabled') return true;
    if (record.phase === 'disabled') record.phase = 'registered';
    await this.loadOne(plugin);
    await this.enableOne(plugin);
    return this.records.get(plugin.name)?.phase === 'enabled';
  }

  /**
   * Disable → cleanup → load → enable on the same instance.
   * ESM source is not re-imported; file edits still need a restart.
   */
  async reload(name: string): Promise<{ ok: boolean; message: string }> {
    const plugin = this.plugins.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (!plugin) return { ok: false, message: `Plugin '${name}' not found.` };
    const record = this.records.get(plugin.name);
    if (!record) return { ok: false, message: `Plugin '${name}' not found.` };
    if (record.phase === 'failed') {
      return { ok: false, message: `Plugin '${plugin.name}' failed and cannot reload without a server restart.` };
    }
    await this.disableOne(plugin);
    record.phase = 'registered';
    await this.loadOne(plugin);
    await this.enableOne(plugin);
    if (this.phaseOf(plugin.name) === 'enabled') {
      return {
        ok: true,
        message: `Reloaded ${plugin.name} (lifecycle only; source file changes still need a restart).`,
      };
    }
    return { ok: false, message: `Failed to reload ${plugin.name}.` };
  }

  find(name: string): PluginRecord | undefined {
    return this.recordsView().find((record) => record.plugin.name.toLowerCase() === name.toLowerCase());
  }

  list(): readonly Plugin[] {
    return this.plugins;
  }

  recordsView(): readonly PluginRecord[] {
    return this.plugins.map((plugin) => {
      const record = this.records.get(plugin.name);
      const bindings = this.bindings.get(plugin.name);
      return {
        plugin,
        phase: record?.phase ?? 'registered',
        source: record?.source,
        error: record?.error,
        loadCount: bindings?.loadCount ?? 0,
        enableCount: bindings?.enableCount ?? 0,
        disableCount: bindings?.disableCount ?? 0,
      };
    });
  }

  phaseOf(name: string): PluginPhase | undefined {
    return this.records.get(name)?.phase;
  }

  private fail(name: string, error: string): void {
    const record = this.records.get(name);
    if (record) {
      record.phase = 'failed';
      record.error = error;
    }
    const bindings = this.bindings.get(name);
    bindings?.unsubscribers.splice(0).forEach((stop) => {
      try { stop(); } catch { /* ignore cleanup errors */ }
    });
    this.clearTimers(name);
  }

  private scopedApi(pluginName: string): ServerAPI {
    const host = this.host;
    if (!host) throw new Error('Plugin host is not attached');
    const bindings = this.bindings.get(pluginName) ?? {
      unsubscribers: [],
      timers: [],
      loadCount: 0,
      enableCount: 0,
      disableCount: 0,
    };
    this.bindings.set(pluginName, bindings);

    const track = (stop: () => void): (() => void) => {
      bindings.unsubscribers.push(stop);
      return () => {
        const index = bindings.unsubscribers.indexOf(stop);
        if (index >= 0) bindings.unsubscribers.splice(index, 1);
        stop();
      };
    };

    const api: ServerAPI = Object.freeze({
      apiVersion: PLUGIN_API_VERSION,
      getStatus: () => host.status(),
      getWorld: () => host.world(),
      getPlayers: () => host.players(),
      getPlayer: (idOrName: string) => host.player(idOrName),
      broadcast: (text: string) => host.broadcast(text),
      registerCommand: (handler: CommandHandler) => {
        const wrapped: CommandHandler = {
          ...handler,
          execute: (args, sender) => {
            try {
              return handler.execute(args, sender);
            } catch (error) {
              serverLog(`plugin ${pluginName} command /${handler.name} threw: ${errorMessage(error)}`, 'error');
              return { ok: false, lines: ['Command failed.'] };
            }
          },
        };
        const unregister = this.commands.register(wrapped);
        return track(unregister);
      },
      registerEvent: <K extends ServerEventName>(name: K, handler: EventHandler<K>) => {
        const wrapped: EventHandler<K> = (event) => {
          try {
            handler(event);
          } catch (error) {
            serverLog(`plugin ${pluginName} event ${name} threw: ${errorMessage(error)}`, 'error');
          }
        };
        const unsubscribe = this.events.on(name, wrapped);
        return track(unsubscribe);
      },
      scheduleOnce: (ms: number, fn: () => void) => {
        const handle = setTimeout(() => {
          this.dropTimer(pluginName, handle);
          this.runTask(pluginName, 'scheduleOnce', fn);
        }, Math.max(0, ms));
        bindings.timers.push(handle);
        return track(() => {
          clearTimeout(handle);
          this.dropTimer(pluginName, handle);
        });
      },
      scheduleRepeating: (ms: number, fn: () => void) => {
        const handle = setInterval(() => this.runTask(pluginName, 'scheduleRepeating', fn), Math.max(1, ms));
        bindings.timers.push(handle);
        return track(() => {
          clearInterval(handle);
          this.dropTimer(pluginName, handle);
        });
      },
      log: (message: string) => serverLog(`plugin ${pluginName} ${message}`),
      hasPermission: (playerIdOrName: string, node: string) => (
        playerIdOrName === CONSOLE_SENDER_ID || (host.permissions?.().has(playerIdOrName, node) ?? false)
      ),
      isOperator: (playerIdOrName: string) => (
        playerIdOrName === CONSOLE_SENDER_ID || (host.permissions?.().isOperator(playerIdOrName) ?? false)
      ),
      teleport: (playerId: string, x: number, y: number, z: number, reason: TeleportReason = 'command', options?: TeleportScheduleOptions) => {
        const teleports = host.teleports?.();
        if (!teleports) return { ok: false, error: 'Teleport service unavailable.' };
        return teleports.schedule(playerId, { x, y, z }, reason, options);
      },
      lastTeleport: (playerId: string) => host.history?.().peek(playerId),
      consumeLastTeleport: (playerId: string) => host.history?.().consume(playerId),
      loadData: <T>(key: string, fallback: T) => host.dataLoad?.(pluginName, key, fallback) ?? fallback,
      saveData: (key: string, value: unknown) => { host.dataSave?.(pluginName, key, value); },
      loadConfig: <T extends Record<string, ConfigValue>>(defaults: T) => (
        host.config?.().load(pluginName, defaults) ?? defaults
      ),
      getConfig: <T extends ConfigValue>(key: string, fallback: T) => (
        host.config?.().get(pluginName, key, fallback) ?? fallback
      ),
      setConfig: (key: string, value: ConfigValue) => { host.config?.().set(pluginName, key, value); },
      formatHelp: (meta: PluginHelpMeta) => formatPluginHelp(meta),
    });
    bindings.api = api;
    return api;
  }

  private runTask(pluginName: string, kind: string, fn: () => void): void {
    const record = this.records.get(pluginName);
    if (!record || record.phase !== 'enabled') return;
    try {
      fn();
    } catch (error) {
      serverLog(`plugin ${pluginName} ${kind} threw: ${errorMessage(error)}`, 'error');
    }
  }

  private dropTimer(pluginName: string, handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
    const bindings = this.bindings.get(pluginName);
    if (!bindings) return;
    const index = bindings.timers.indexOf(handle);
    if (index >= 0) bindings.timers.splice(index, 1);
  }

  private clearTimers(name: string): void {
    const bindings = this.bindings.get(name);
    if (!bindings) return;
    for (const handle of bindings.timers.splice(0)) {
      clearTimeout(handle);
      clearInterval(handle);
    }
  }

  private apiFor(plugin: Plugin): ServerAPI {
    const existing = this.bindings.get(plugin.name)?.api;
    return existing ?? this.scopedApi(plugin.name);
  }

  private compatible(plugin: Plugin): boolean {
    if (plugin.apiVersion === undefined) return true;
    return plugin.apiVersion === PLUGIN_API_VERSION;
  }

  private async boot(plugin: Plugin): Promise<void> {
    await this.loadOne(plugin);
    if (this.globallyEnabled) await this.enableOne(plugin);
  }

  private async loadOne(plugin: Plugin): Promise<void> {
    const record = this.records.get(plugin.name);
    const bindings = this.bindings.get(plugin.name);
    if (!record || !bindings || !this.host) return;
    if (record.phase === 'failed' || record.phase === 'loaded' || record.phase === 'enabled') return;
    if (record.phase === 'disabled') record.phase = 'registered';
    if (!this.compatible(plugin)) {
      const error = `incompatible plugin API ${plugin.apiVersion} (server ${PLUGIN_API_VERSION})`;
      serverLog(`plugins: ${plugin.name} ${error}`, 'error');
      this.fail(plugin.name, error);
      return;
    }
    const api = this.apiFor(plugin);
    try {
      const result = plugin.onLoad?.(api);
      if (isThenable(result)) await withTimeout(result, `plugin ${plugin.name} onLoad`);
      bindings.loadCount += 1;
      record.phase = 'loaded';
    } catch (error) {
      serverLog(`plugin ${plugin.name} onLoad threw: ${errorMessage(error)}`, 'error');
      this.fail(plugin.name, errorMessage(error));
    }
  }

  private async enableOne(plugin: Plugin): Promise<void> {
    const record = this.records.get(plugin.name);
    const bindings = this.bindings.get(plugin.name);
    if (!record || !bindings || !this.host) return;
    if (record.phase === 'failed' || record.phase === 'enabled' || record.phase === 'disabled') return;
    if (record.phase === 'registered') await this.loadOne(plugin);
    if (record.phase !== 'loaded') return;
    if (!this.compatible(plugin)) {
      const error = `incompatible plugin API ${plugin.apiVersion} (server ${PLUGIN_API_VERSION})`;
      serverLog(`plugins: ${plugin.name} ${error}`, 'error');
      this.fail(plugin.name, error);
      return;
    }
    const api = this.apiFor(plugin);
    try {
      const result = plugin.onEnable?.(api);
      if (isThenable(result)) await withTimeout(result, `plugin ${plugin.name} onEnable`);
      bindings.enableCount += 1;
      record.phase = 'enabled';
    } catch (error) {
      serverLog(`plugin ${plugin.name} onEnable threw: ${errorMessage(error)}`, 'error');
      this.fail(plugin.name, errorMessage(error));
    }
  }

  private async disableOne(plugin: Plugin): Promise<void> {
    const record = this.records.get(plugin.name);
    const bindings = this.bindings.get(plugin.name);
    if (!record || !bindings) return;
    if (record.phase !== 'enabled') {
      this.disposeBindings(plugin.name);
      if (record.phase !== 'failed') record.phase = 'disabled';
      return;
    }
    try {
      const result = plugin.onDisable?.();
      if (isThenable(result)) await withTimeout(result, `plugin ${plugin.name} onDisable`);
      bindings.disableCount += 1;
    } catch (error) {
      serverLog(`plugin ${plugin.name} onDisable threw: ${errorMessage(error)}`, 'error');
    }
    this.disposeBindings(plugin.name);
    record.phase = 'disabled';
  }

  private disposeBindings(name: string): void {
    const bindings = this.bindings.get(name);
    if (!bindings) return;
    for (const stop of bindings.unsubscribers.splice(0)) {
      try { stop(); } catch { /* ignore */ }
    }
    this.clearTimers(name);
    bindings.api = undefined;
  }
}

export type { GameMode };
