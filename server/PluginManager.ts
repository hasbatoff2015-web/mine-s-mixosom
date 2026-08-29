import type { GameMode, PlayerSnapshot } from '../shared/protocol';
import type { EventBus, ServerEventName, EventHandler } from './events';
import type { CommandHandler, CommandRegistry } from './commands';
import { serverLog } from './log';

export interface PlayerView {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
  snapshot(): PlayerSnapshot;
}

export interface WorldView {
  readonly seed: string;
  readonly worldId: string;
  spawn(): readonly [number, number, number];
  getBlock(x: number, y: number, z: number): number;
  /** Mutates authoritative world, persists, and broadcasts. Plugins must use this — not a client. */
  setBlock(x: number, y: number, z: number, blockId: number): boolean;
}

export interface ServerAPI {
  getWorld(): WorldView;
  getPlayers(): readonly PlayerView[];
  getPlayer(id: string): PlayerView | undefined;
  broadcast(text: string): void;
  registerCommand(handler: CommandHandler): void;
  registerEvent<K extends ServerEventName>(name: K, handler: EventHandler<K>): () => void;
  log(message: string): void;
}

export interface Plugin {
  readonly name: string;
  onLoad?(api: ServerAPI): void;
  onEnable?(api: ServerAPI): void;
  onDisable?(): void;
}

export class PluginManager {
  private readonly plugins: Plugin[] = [];
  private enabled = false;
  private api: ServerAPI | undefined;

  constructor(
    private readonly events: EventBus,
    private readonly commands: CommandRegistry,
  ) {}

  createApi(world: WorldView, players: () => readonly PlayerView[], broadcast: (text: string) => void): ServerAPI {
    const api: ServerAPI = Object.freeze({
      getWorld: () => world,
      getPlayers: () => players(),
      getPlayer: (id: string) => players().find((player) => player.id === id),
      broadcast,
      registerCommand: (handler: CommandHandler) => this.commands.register(handler),
      registerEvent: <K extends ServerEventName>(name: K, handler: EventHandler<K>) => this.events.on(name, handler),
      log: (message: string) => serverLog(`plugin ${message}`),
    });
    this.api = api;
    return api;
  }

  register(plugin: Plugin): void {
    if (this.plugins.some((entry) => entry.name === plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    this.plugins.push(plugin);
    if (this.api) plugin.onLoad?.(this.api);
    if (this.enabled && this.api) plugin.onEnable?.(this.api);
  }

  loadAll(): void {
    if (!this.api) return;
    for (const plugin of this.plugins) plugin.onLoad?.(this.api);
  }

  enableAll(): void {
    if (!this.api) return;
    this.enabled = true;
    for (const plugin of this.plugins) plugin.onEnable?.(this.api);
  }

  disableAll(): void {
    this.enabled = false;
    for (const plugin of [...this.plugins].reverse()) plugin.onDisable?.();
  }

  list(): readonly Plugin[] {
    return this.plugins;
  }
}

export type { GameMode };
