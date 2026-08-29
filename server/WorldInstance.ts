import { mkdir } from 'node:fs/promises';
import { BlockId, getBlockDefinition, isKnownBlockId } from '../src/blocks';
import { PLAYER_NET_REACH, TICK_RATE, chunkKey, floorDiv, isValidWorldY } from '../src/core/constants';
import { Inventory } from '../src/inventory';
import { tryGetItemDefinition } from '../src/items';
import { PlayerController } from '../src/player';
import { VoxelWorld } from '../src/world/World';
import { ANARCHY_WORLD_ID } from '../src/world/import/anarchy';
import { estimateWorldSpawn, isGameMode } from '../src/world/spawn';
import type {
  ClientInputMessage,
  GameMode,
  PlayerSnapshot,
  RemotePlayerInfo,
  WorldBlockStates,
  WorldModifications,
} from '../shared/protocol';
import type { ServerConfig } from './config';
import { worldDirectory } from './config';
import { CommandRegistry, fail, ok, type CommandSender } from './commands';
import { EventBus } from './events';
import { PluginManager, type PlayerView, type WorldView } from './PluginManager';
import { WorldPersistence, type StoredPlayer, type WorldDiskState, type WorldReadyState } from './persistence';
import { netDebug, serverLog } from './log';

export interface ConnectedSink {
  send(payload: unknown): void;
}

const IDLE_INPUT: ClientInputMessage = {
  type: 'input',
  seq: 0,
  forward: 0,
  right: 0,
  jump: false,
  sneak: false,
  sprint: false,
  descend: false,
  flySprint: false,
  yaw: 0,
  pitch: 0,
  selectedSlot: 0,
};

export class ServerPlayer implements PlayerView {
  connected = true;
  disconnectedAt = 0;
  lastInput: ClientInputMessage = { ...IDLE_INPUT };
  lastInputSeq = -1;
  viewCx = 0;
  viewCz = 0;
  viewRadius = 4;
  knownChunks = new Set<string>();
  sink: ConnectedSink | null = null;

  constructor(
    readonly id: string,
    readonly sessionToken: string,
    public name: string,
    readonly controller: PlayerController,
    readonly inventory: Inventory,
    public health: number,
    public gamemode: GameMode,
    public selectedSlot: number,
  ) {}

  snapshot(): PlayerSnapshot {
    const position = this.controller.position;
    const velocity = this.controller.velocity;
    return {
      id: this.id,
      name: this.name,
      x: position.x,
      y: position.y,
      z: position.z,
      yaw: this.controller.yaw,
      pitch: this.controller.pitch,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      health: this.health,
      gamemode: this.gamemode,
      sneaking: this.controller.sneaking,
      sprinting: this.controller.sprinting,
      onGround: this.controller.onGround,
      selectedSlot: this.selectedSlot,
    };
  }

  remoteInfo(): RemotePlayerInfo {
    const snap = this.snapshot();
    return {
      id: snap.id,
      name: snap.name,
      x: snap.x,
      y: snap.y,
      z: snap.z,
      yaw: snap.yaw,
      pitch: snap.pitch,
    };
  }

  commandSender(): CommandSender {
    return {
      playerId: this.id,
      name: this.name,
      gamemode: this.gamemode,
    };
  }
}

export class WorldInstance {
  readyState: WorldReadyState = 'UNINITIALIZED';
  readonly world: VoxelWorld;
  readonly events = new EventBus();
  readonly commands = new CommandRegistry();
  readonly plugins = new PluginManager(this.events, this.commands);
  readonly players = new Map<string, ServerPlayer>();
  readonly tokens = new Map<string, string>();
  tickNumber = 0;
  spawn: [number, number, number];
  private dirty = false;
  private readonly persistence: WorldPersistence;
  private storedPlayers: Record<string, StoredPlayer> = {};
  private readonly generatedChunks = new Set<string>();
  private persistTimer: ReturnType<typeof setInterval> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private readonly dt: number;
  private worldView: WorldView;

  constructor(readonly config: ServerConfig) {
    this.persistence = new WorldPersistence(worldDirectory(config));
    this.world = new VoxelWorld(config.worldSeed);
    this.spawn = [0.5, 70, 0.5];
    this.dt = 1 / config.tickRate;
    this.worldView = this.createWorldView();
    this.registerBuiltinCommands();
    this.plugins.createApi(this.worldView, () => [...this.players.values()].filter((player) => player.connected), (text) => {
      this.broadcastChat('system', 'server', text);
    });
  }

  get worldId(): string {
    return this.config.worldId;
  }

  get seed(): string {
    return this.world.seed;
  }

  async initialize(): Promise<void> {
    this.readyState = 'INITIALIZING';
    await mkdir(this.persistence.directory, { recursive: true });
    const existing = await this.persistence.load();
    if (existing) {
      this.world.restore({
        timeOfDay: existing.timeOfDay,
        modifications: existing.modifications,
        chests: {},
        furnaces: {},
        blockStates: existing.blockStates,
      });
      this.spawn = [existing.meta.spawn[0], existing.meta.spawn[1], existing.meta.spawn[2]];
      this.storedPlayers = existing.players;
      for (const stored of Object.values(existing.players)) {
        if (stored.sessionToken) this.tokens.set(stored.sessionToken, stored.id);
      }
      this.preloadSpawnChunks();
      this.readyState = 'READY';
      serverLog(`world loaded: ${this.worldId} from ${this.persistence.directory}`);
      return;
    }
    this.spawn = estimateWorldSpawn(this.world);
    this.preloadSpawnChunks();
    this.dirty = true;
    await this.save();
    this.readyState = 'READY';
    serverLog(`world created: ${this.worldId} at ${this.persistence.directory}`);
    serverLog(
      'Fresh procedural Anarchy world. Browser IndexedDB is not imported. To load an exported dump: npm run server:import -- <dump.json>',
    );
  }

  startLoops(): void {
    const tickMs = 1000 / this.config.tickRate;
    this.tickTimer = setInterval(() => this.tick(), tickMs);
    this.persistTimer = setInterval(() => {
      if (this.dirty) void this.save();
    }, this.config.persistIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.plugins.disableAll();
    await this.save();
  }

  async save(): Promise<void> {
    const players: Record<string, StoredPlayer> = { ...this.storedPlayers };
    for (const player of this.players.values()) {
      players[player.id] = this.toStored(player);
    }
    this.storedPlayers = players;
    const state: WorldDiskState = {
      meta: {
        worldId: this.worldId,
        seed: this.seed,
        spawn: this.spawn,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        readyState: 'READY',
      },
      timeOfDay: this.world.timeOfDay,
      modifications: this.world.serializeModifications(),
      blockStates: this.world.serializeBlockStates(),
      players,
    };
    await this.persistence.save(state);
    this.dirty = false;
  }

  onlineCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (player.connected) count += 1;
    return count;
  }

  connectedPlayers(): ServerPlayer[] {
    return [...this.players.values()].filter((player) => player.connected);
  }

  join(options: {
    sink: ConnectedSink;
    name?: string;
    sessionToken?: string;
  }): { player: ServerPlayer; resumed: boolean } | { error: string } {
    if (this.readyState !== 'READY') return { error: 'world not ready' };
    if (this.onlineCount() >= this.config.maxPlayers) return { error: 'server full' };

    if (options.sessionToken) {
      const existingId = this.tokens.get(options.sessionToken);
      const existing = existingId ? this.players.get(existingId) : undefined;
      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = 0;
        existing.sink = options.sink;
        if (options.name) existing.name = options.name;
        serverLog(`player joined: ${existing.name} (${existing.id}, resume)`);
        this.events.emit('playerJoin', { playerId: existing.id, name: existing.name });
        return { player: existing, resumed: true };
      }
      const stored = existingId ? this.storedPlayers[existingId] : undefined;
      if (stored) {
        const restored = this.materializeStoredPlayer(stored, options.sink, options.name);
        serverLog(`player joined: ${restored.name} (${restored.id}, resume)`);
        this.events.emit('playerJoin', { playerId: restored.id, name: restored.name });
        return { player: restored, resumed: true };
      }
    }

    const id = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const name = options.name ?? `Player-${id.slice(0, 4)}`;
    const controller = new PlayerController({ position: this.spawn, yaw: 0, pitch: 0 });
    const inventory = createStarterInventory();
    const player = new ServerPlayer(
      id,
      sessionToken,
      name,
      controller,
      inventory,
      20,
      'survival',
      0,
    );
    player.controller.creativeFlightAllowed = player.gamemode === 'creative';
    player.sink = options.sink;
    this.players.set(id, player);
    this.tokens.set(sessionToken, id);
    const spawnChunkX = floorDiv(Math.floor(player.controller.position.x), 16);
    const spawnChunkZ = floorDiv(Math.floor(player.controller.position.z), 16);
    player.viewCx = spawnChunkX;
    player.viewCz = spawnChunkZ;
    player.viewRadius = this.config.chunkViewRadius;
    this.syncChunksFor(player);
    serverLog(`player joined: ${player.name} (${player.id})`);
    this.events.emit('playerJoin', { playerId: player.id, name: player.name });
    this.dirty = true;
    return { player, resumed: false };
  }

  disconnect(playerId: string, persist = true): void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.sink = null;
    player.lastInput = { ...IDLE_INPUT, yaw: player.controller.yaw, pitch: player.controller.pitch, selectedSlot: player.selectedSlot };
    serverLog(`player disconnected: ${player.name} (${player.id})`);
    this.events.emit('playerQuit', { playerId: player.id, name: player.name });
    this.broadcast({ type: 'player_left', playerId: player.id }, playerId);
    if (persist) {
      this.storedPlayers[player.id] = this.toStored(player);
      this.dirty = true;
    }
  }

  applyInput(player: ServerPlayer, input: ClientInputMessage): boolean {
    if (input.seq < player.lastInputSeq) {
      netDebug('player input', `stale seq ${input.seq} < ${player.lastInputSeq} for ${player.id}`);
      return false;
    }
    if (input.seq === player.lastInputSeq) {
      netDebug('player input', `duplicate seq ${input.seq} for ${player.id}`);
      return false;
    }
    player.lastInputSeq = input.seq;
    player.lastInput = input;
    player.selectedSlot = input.selectedSlot;
    player.controller.yaw = input.yaw;
    player.controller.pitch = input.pitch;
    player.controller.creativeFlightAllowed = player.gamemode === 'creative';
    return true;
  }

  tryBreak(player: ServerPlayer, x: number, y: number, z: number): { ok: true } | { ok: false; reason: string } {
    if (!isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) return { ok: false, reason: 'bounds' };
    if (!this.inReach(player, x, y, z)) return { ok: false, reason: 'reach' };
    const block = this.world.getBlock(x, y, z);
    if (block === BlockId.Air) return { ok: false, reason: 'empty' };
    const definition = getBlockDefinition(block);
    if (definition.breakable === false) return { ok: false, reason: 'unbreakable' };
    const event = this.events.createBlockBreak(player.id, x, y, z, block);
    this.events.emit('blockBreak', event);
    if (event.cancelled) return { ok: false, reason: 'cancelled' };
    if (!this.world.setBlock(x, y, z, BlockId.Air)) return { ok: false, reason: 'rejected' };
    this.dirty = true;
    this.broadcast({ type: 'block_update', x, y, z, blockId: BlockId.Air });
    netDebug('break accepted', `${player.name} ${x},${y},${z}`);
    return { ok: true };
  }

  tryPlace(player: ServerPlayer, x: number, y: number, z: number, requestedBlock?: number): { ok: true } | { ok: false; reason: string } {
    if (!isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) return { ok: false, reason: 'bounds' };
    if (!this.inReach(player, x, y, z)) return { ok: false, reason: 'reach' };
    const existing = this.world.getBlock(x, y, z);
    const existingDef = getBlockDefinition(existing);
    if (existing !== BlockId.Air && existingDef.replaceable !== true) return { ok: false, reason: 'occupied' };

    let blockId: number | undefined;
    if (player.gamemode === 'creative' && requestedBlock !== undefined && isKnownBlockId(requestedBlock) && requestedBlock !== BlockId.Air) {
      blockId = requestedBlock;
    } else {
      const stack = player.inventory.getSlot(player.selectedSlot);
      const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
      blockId = item?.placesBlockId;
      if (blockId === undefined) return { ok: false, reason: 'inventory' };
    }
    if (!isKnownBlockId(blockId) || blockId === BlockId.Air) return { ok: false, reason: 'block' };
    const placed = getBlockDefinition(blockId);
    if (placed.solid !== false && player.controller.intersectsBlock(x, y, z)) {
      return { ok: false, reason: 'collision' };
    }
    const event = this.events.createBlockPlace(player.id, x, y, z, blockId);
    this.events.emit('blockPlace', event);
    if (event.cancelled) return { ok: false, reason: 'cancelled' };
    if (!this.world.setBlock(x, y, z, blockId)) return { ok: false, reason: 'rejected' };
    if (player.gamemode === 'survival') {
      const stack = player.inventory.getSlot(player.selectedSlot);
      if (!stack) {
        this.world.setBlock(x, y, z, existing);
        return { ok: false, reason: 'inventory' };
      }
      player.inventory.setSlot(player.selectedSlot, stack.count <= 1 ? null : { ...stack, count: stack.count - 1 });
      this.sendTo(player, {
        type: 'inventory',
        inventory: player.inventory.serialize(),
        selectedSlot: player.selectedSlot,
        gamemode: player.gamemode,
      });
    }
    this.dirty = true;
    this.broadcast({ type: 'block_update', x, y, z, blockId });
    netDebug('place accepted', `${player.name} ${x},${y},${z} -> ${blockId}`);
    return { ok: true };
  }

  handleChat(player: ServerPlayer, text: string): void {
    if (text.startsWith('/')) {
      const dispatched = this.commands.dispatch(text, player.commandSender());
      const kind = dispatched.result?.ok ? 'command' : 'error';
      this.sendTo(player, {
        type: 'chat',
        from: 'server',
        playerId: 'server',
        text,
        kind,
      });
      for (const line of dispatched.result?.lines ?? []) {
        this.sendTo(player, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text: line,
          kind: dispatched.result?.ok ? 'system' : 'error',
        });
      }
      return;
    }
    this.broadcastChat('player', player.id, text, player.name);
  }

  setView(player: ServerPlayer, cx: number, cz: number, radius: number): void {
    player.viewCx = cx;
    player.viewCz = cz;
    player.viewRadius = radius;
    this.syncChunksFor(player);
  }

  setGameMode(player: ServerPlayer, mode: GameMode): void {
    player.gamemode = mode;
    player.controller.creativeFlightAllowed = mode === 'creative';
    if (mode !== 'creative') player.controller.isFlying = false;
    this.sendTo(player, {
      type: 'inventory',
      inventory: player.inventory.serialize(),
      selectedSlot: player.selectedSlot,
      gamemode: mode,
    });
    this.dirty = true;
  }

  broadcast(payload: unknown, exceptId?: string): void {
    for (const player of this.players.values()) {
      if (!player.connected || player.id === exceptId) continue;
      player.sink?.send(payload);
    }
  }

  sendTo(player: ServerPlayer, payload: unknown): void {
    player.sink?.send(payload);
  }

  modifications(): WorldModifications {
    return this.world.serializeModifications();
  }

  blockStates(): WorldBlockStates {
    return this.world.serializeBlockStates();
  }

  tick(): void {
    this.tickNumber += 1;
    const dt = this.dt;
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      const input = player.lastInput;
      const before = player.controller.position.clone();
      player.controller.creativeFlightAllowed = player.gamemode === 'creative';
      player.controller.tick(this.world, {
        yaw: input.yaw,
        pitch: input.pitch,
        movement: () => ({
          forward: input.forward,
          right: input.right,
          jump: input.jump,
          sneak: input.sneak,
          sprint: input.sprint,
          descend: input.descend,
          flySprint: input.flySprint,
        }),
      }, dt, (amount, cause) => {
        if (player.gamemode !== 'survival') return;
        const event = this.events.createPlayerDamage(player.id, amount, cause);
        this.events.emit('playerDamage', event);
        if (event.cancelled) return;
        player.health = Math.max(0, player.health - amount);
        if (player.health <= 0) {
          player.health = 20;
          player.controller.teleport(this.spawn);
        }
      });
      const moved = player.controller.position.distanceTo(before);
      if (moved > 1e-4) {
        const event = this.events.createPlayerMove(
          player.id,
          player.controller.position.x,
          player.controller.position.y,
          player.controller.position.z,
        );
        this.events.emit('playerMove', event);
        if (event.cancelled) {
          player.controller.teleport(before);
        }
      }
    }
    const snapshots = this.connectedPlayers().map((player) => player.snapshot());
    if (snapshots.length > 0) {
      this.broadcast({ type: 'player_state', tick: this.tickNumber, players: snapshots });
    }
    this.sweepDisconnected();
  }

  private sweepDisconnected(): void {
    const now = Date.now();
    for (const player of [...this.players.values()]) {
      if (player.connected) continue;
      if (now - player.disconnectedAt < 5 * 60_000) continue;
      this.tokens.delete(player.sessionToken);
      this.storedPlayers[player.id] = this.toStored(player);
      this.players.delete(player.id);
    }
  }

  private inReach(player: ServerPlayer, x: number, y: number, z: number): boolean {
    const eye = player.controller.eyePosition();
    const dx = eye.x - (x + 0.5);
    const dy = eye.y - (y + 0.5);
    const dz = eye.z - (z + 0.5);
    const limit = PLAYER_NET_REACH;
    return dx * dx + dy * dy + dz * dz <= limit * limit;
  }

  private preloadSpawnChunks(): void {
    const cx = floorDiv(Math.floor(this.spawn[0]), 16);
    const cz = floorDiv(Math.floor(this.spawn[2]), 16);
    const radius = this.config.chunkViewRadius;
    let count = 0;
    for (let z = cz - radius; z <= cz + radius; z += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        this.ensureChunk(x, z, false);
        count += 1;
      }
    }
    serverLog(`chunk loaded: ${count} around spawn`);
  }

  private ensureChunk(cx: number, cz: number, announce = true): void {
    const key = chunkKey(cx, cz);
    const already = this.generatedChunks.has(key);
    this.world.getChunk(cx, cz, true);
    if (already) return;
    this.generatedChunks.add(key);
    if (announce) serverLog(`chunk loaded ${key}`);
  }

  private syncChunksFor(player: ServerPlayer): void {
    const radius = player.viewRadius;
    const wanted = new Set<string>();
    for (let z = player.viewCz - radius; z <= player.viewCz + radius; z += 1) {
      for (let x = player.viewCx - radius; x <= player.viewCx + radius; x += 1) {
        const key = chunkKey(x, z);
        wanted.add(key);
        this.ensureChunk(x, z);
        if (!player.knownChunks.has(key)) {
          player.knownChunks.add(key);
          const mods = this.world.serializeModifications()[key] ?? {};
          this.sendTo(player, { type: 'chunk_data', cx: x, cz: z, modifications: mods });
        }
      }
    }
    for (const key of [...player.knownChunks]) {
      if (wanted.has(key)) continue;
      player.knownChunks.delete(key);
      const [cxRaw, czRaw] = key.split(',');
      const cx = Number(cxRaw);
      const cz = Number(czRaw);
      if (!Number.isInteger(cx) || !Number.isInteger(cz)) continue;
      this.sendTo(player, { type: 'unload_chunk', cx, cz });
    }
  }

  private createWorldView(): WorldView {
    const instance = this;
    return Object.freeze({
      get seed() { return instance.seed; },
      get worldId() { return instance.worldId; },
      spawn: (): [number, number, number] => instance.spawn,
      getBlock: (x: number, y: number, z: number) => instance.world.getBlock(x, y, z),
      setBlock: (x: number, y: number, z: number, blockId: number) => {
        if (!isKnownBlockId(blockId) || !isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) {
          return false;
        }
        if (!instance.world.setBlock(x, y, z, blockId)) return false;
        instance.dirty = true;
        instance.broadcast({ type: 'block_update', x, y, z, blockId });
        return true;
      },
    });
  }

  private materializeStoredPlayer(stored: StoredPlayer, sink: ConnectedSink, name?: string): ServerPlayer {
    const controller = new PlayerController({
      position: [stored.x, stored.y, stored.z],
      yaw: stored.yaw,
      pitch: stored.pitch,
    });
    const token = stored.sessionToken ?? crypto.randomUUID();
    const player = new ServerPlayer(
      stored.id,
      token,
      name ?? stored.name,
      controller,
      this.restoreInventory(stored.inventory),
      stored.health,
      isGameMode(stored.gamemode) ? stored.gamemode : 'survival',
      stored.selectedSlot,
    );
    player.controller.creativeFlightAllowed = player.gamemode === 'creative';
    player.sink = sink;
    this.players.set(player.id, player);
    this.tokens.set(token, player.id);
    player.viewCx = floorDiv(Math.floor(player.controller.position.x), 16);
    player.viewCz = floorDiv(Math.floor(player.controller.position.z), 16);
    player.viewRadius = this.config.chunkViewRadius;
    this.syncChunksFor(player);
    return player;
  }

  private restoreInventory(raw: unknown): Inventory {
    try {
      if (raw) return Inventory.deserialize(raw);
    } catch {
      serverLog('player inventory save was invalid; using starter kit', 'warn');
    }
    return createStarterInventory();
  }

  private toStored(player: ServerPlayer): StoredPlayer {
    const snap = player.snapshot();
    return {
      id: player.id,
      name: player.name,
      x: snap.x,
      y: snap.y,
      z: snap.z,
      yaw: snap.yaw,
      pitch: snap.pitch,
      health: snap.health,
      gamemode: snap.gamemode,
      selectedSlot: snap.selectedSlot,
      inventory: player.inventory.serialize(),
      sessionToken: player.sessionToken,
      updatedAt: Date.now(),
    };
  }

  private broadcastChat(kind: 'player' | 'system', playerId: string, text: string, from?: string): void {
    this.broadcast({
      type: 'chat',
      from: from ?? (kind === 'system' ? 'server' : playerId),
      playerId,
      text,
      kind,
    });
  }

  private registerBuiltinCommands(): void {
    this.commands.register({
      name: 'help',
      usage: '/help [command]',
      description: 'List server commands',
      execute: (args) => {
        if (args[0]) {
          const command = this.commands.find(args[0]);
          if (!command) return fail(`Unknown command '${args[0]}'.`);
          return ok(`${command.usage} — ${command.description}`);
        }
        return ok(this.commands.list().map((command) => `${command.usage} — ${command.description}`));
      },
    });
    this.commands.register({
      name: 'gamemode',
      aliases: ['gm'],
      usage: '/gamemode <survival|creative>',
      description: 'Set authoritative game mode',
      execute: (args, sender) => {
        const key = args[0]?.toLowerCase();
        const mode: GameMode | undefined = key === 'survival' || key === 's' || key === '0'
          ? 'survival'
          : key === 'creative' || key === 'c' || key === '1'
            ? 'creative'
            : undefined;
        if (!mode) return fail('Usage: /gamemode <survival|creative|s|c|0|1>');
        const player = this.players.get(sender.playerId);
        if (!player) return fail('Player not found.');
        this.setGameMode(player, mode);
        return ok(`Set game mode to ${mode}`);
      },
    });
    this.commands.register({
      name: 'seed',
      usage: '/seed',
      description: 'Show the Anarchy world seed',
      execute: () => ok(`Seed: ${this.seed}`),
    });
    this.commands.register({
      name: 'spawn',
      usage: '/spawn',
      description: 'Teleport to the server spawn',
      execute: (_args, sender) => {
        const player = this.players.get(sender.playerId);
        if (!player) return fail('Player not found.');
        player.controller.teleport(this.spawn);
        return ok('Teleported to spawn.');
      },
    });
  }
}

export function createStarterInventory(): Inventory {
  const inventory = new Inventory();
  inventory.addItem('dirt', 64);
  inventory.addItem('cobblestone', 64);
  inventory.addItem('oak_planks', 64);
  inventory.addItem('stone', 64);
  inventory.addItem('oak_log', 32);
  inventory.addItem('apple', 8);
  return inventory;
}

export { ANARCHY_WORLD_ID, TICK_RATE };
