import { join } from 'node:path';
import { BlockId, getBlockDefinition, isKnownBlockId } from '../src/blocks';
import { CombatSystem } from '../src/combat';
import { TIME_PRESETS, resolveItemId } from '../src/chat/commands';
import { TICK_RATE, chunkKey, floorDiv, isValidWorldY } from '../src/core/constants';
import { inputSeqAfterReconnect } from '../src/core/onlineSession';
import { Inventory, createItemStack, type ItemStack } from '../src/inventory';
import { sameSharedContainerWindow, type InventoryWindow } from '../src/inventory/inventoryUiAction';
import { isKnownItemId } from '../src/items';
import { PlayerController } from '../src/player';
import {
  compareLatestInputCoalesce,
  compareLockstepModes,
  dumpControllerTicks,
  formatLatestInputCoalesce,
  formatPoseDump,
} from '../src/player/moveSimCompare';
import { SurvivalSystem, getArmorPoints } from '../src/survival';
import { VoxelWorld } from '../src/world/World';
import { ANARCHY_IMPORT_VERSION, ANARCHY_SERVER_ID, ANARCHY_WORLD_ID } from '../src/world/import/anarchy';
import { estimateWorldSpawn, isGameMode } from '../src/world/spawn';
import type {
  AppliedInputTick,
  AppliedMovementStep,
  ClientInputMessage,
  ClientInventoryActionMessage,
  ClientVehicleInputMessage,
  GameMode,
  PlayerSnapshot,
  RemotePlayerInfo,
  WorldBlockStates,
  WorldModifications,
} from '../shared/protocol';
import type { BlockTargetIntent, BowReleaseAction } from '../shared/playerActions';
import type { ActionPoseSample } from '../shared/actionPoseHistory';
import { recordActionPose } from '../shared/actionPoseHistory';
import type { PlayerCommand } from '../shared/playerCommand';
import { APPLIED_STEPS_MAX } from '../shared/playerCommand';
import { PlayerCommandQueue } from './playerCommandQueue';
import type { ServerConfig } from './config';
import {
  CommandRegistry,
  createConsoleCommandSender,
  fail,
  isConsoleSender,
  normalizeConsoleCommand,
  ok,
  type CommandResult,
  type CommandSender,
} from './commands';
import { gameplayTicksDue, scheduleNextTickSlot } from './tickScheduler';
import { EventBus } from './events';
import { PluginManager, PLUGIN_API_VERSION, type PlayerView, type PluginEntityView, type PluginHost, type WorldView } from './PluginManager';
import { createBuiltinPlugins } from './builtin-plugins';
import { JsonFileStore } from './services/jsonStore';
import { PermissionService } from './services/permissions';
import { PluginConfigService } from './services/pluginConfig';
import { PlayerSelectionService } from './services/selection';
import { RtpService, RtpSessionManager } from './services/rtp';
import { TeleportHistoryService, TeleportService } from './services/teleport';
import { HologramNetwork } from './services/holograms';
import { ClaimBoundaryNetwork } from './services/claimBoundaries';
import { ServerGameplay, type GameplayPlayer } from './gameplay';
import { formatGameplayKernelTrace } from '../src/gameplay';
import { FsWorldStore } from './FsWorldStore';
import type { WorldReadyState } from './persistence';
import type { SerializedPersistedPlayer, WorldSnapshot } from '../src/save/types';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { placeholderPlayer } from '../src/save/snapshot';
import { netDebug, serverLog } from './log';
import { sessionTokenFingerprint } from '../shared/sessionFingerprint';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/** New terrain columns generated inside one `syncChunksFor`. Already-known columns still stream. */
const MAX_NEW_CHUNK_GENERATES_PER_SYNC = 2;

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
  use: false,
  mining: false,
};

export class ServerPlayer implements GameplayPlayer {
  connected = true;
  disconnectedAt = 0;
  lastInput: ClientInputMessage = { ...IDLE_INPUT };
  /** Highest received command seq (packet filter). Snapshot uses appliedCommandSeq. */
  lastInputSeq = -1;
  appliedCommandSeq = -1;
  readonly commandQueue = new PlayerCommandQueue();
  lastActionSeq = -1;
  lastBowReleaseSeq = -1;
  readonly appliedStepsThisLoop: AppliedMovementStep[] = [];
  readonly actionPoseHistory: ActionPoseSample[] = [];
  lastClientSentAt: number | undefined;
  lastServerRecvAt: number | undefined;
  lastServerSimAt: number | undefined;
  lastInputGapMs = 0;
  inputPacketsThisLoop = 0;
  /** Last server physics ticks with the input seq that was actually applied. */
  readonly appliedInputTrace: AppliedInputTick[] = [];
  viewCx = 0;
  viewCz = 0;
  viewRadius = 4;
  knownChunks = new Set<string>();
  sink: ConnectedSink | null = null;
  connectionId = crypto.randomUUID();
  joinCount = 1;
  resumeCount = 0;
  activeSocketCount = 1;
  lastInputConnectionId = '';
  readonly survival: SurvivalSystem;
  readonly combat = new CombatSystem();
  cursor: ItemStack | null = null;
  craftSlots: Array<ItemStack | null> = [null, null, null, null];
  window: InventoryWindow = { kind: 'inventory' };
  ridingCartId?: string;
  miningTarget?: { x: number; y: number; z: number };
  miningProgress = 0;
  bowUseTicks = 0;
  foodUseTicks = 0;
  lastUse = false;
  lastSprint = false;
  vehicleForward = 0;
  inventoryDirty = false;
  healthSignature = '';
  effectSignature = '';

  constructor(
    readonly id: string,
    readonly sessionToken: string,
    public name: string,
    readonly controller: PlayerController,
    readonly inventory: Inventory,
    public gamemode: GameMode,
    public selectedSlot: number,
    survival?: SurvivalSystem,
  ) {
    this.survival = survival ?? new SurvivalSystem({ health: 20 });
  }

  get health(): number {
    return this.survival.health;
  }

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
      health: this.survival.health,
      gamemode: this.gamemode,
      sneaking: this.controller.sneaking,
      sprinting: this.controller.sprinting,
      onGround: this.controller.onGround,
      selectedSlot: this.selectedSlot,
      invisible: this.survival.invisible,
      onFire: this.survival.isOnFire,
      hunger: this.survival.hunger,
      armor: getArmorPoints(this.inventory),
      ridingEntityId: this.ridingCartId,
      dead: this.survival.dead,
      inputSeq: this.appliedCommandSeq >= 0 ? this.appliedCommandSeq : this.lastInputSeq,
      ackCommandSeq: this.appliedCommandSeq >= 0 ? this.appliedCommandSeq : this.lastInputSeq,
      flying: this.controller.isFlying,
      appliedTicks: this.appliedInputTrace.slice(),
      appliedSteps: this.appliedStepsThisLoop.slice(),
      ...(this.commandQueue.lastCompacted ? { queueCompacted: this.commandQueue.lastCompacted } : {}),
      session: {
        tokenFp: sessionTokenFingerprint(this.sessionToken),
        connectionId: this.connectionId,
        joinCount: this.joinCount,
        resumeCount: this.resumeCount,
        activeSockets: this.activeSocketCount,
        lastInputConn: this.lastInputConnectionId || this.connectionId,
        inputGapMs: this.lastServerRecvAt !== undefined
          ? Math.round(performance.now() - this.lastServerRecvAt)
          : undefined,
        inputPackets: this.inputPacketsThisLoop,
      },
      ...(this.lastServerRecvAt !== undefined || this.lastClientSentAt !== undefined ? {
        netTiming: {
          ...(this.lastClientSentAt !== undefined ? { clientSentAt: this.lastClientSentAt } : {}),
          ...(this.lastServerRecvAt !== undefined ? { serverRecvAt: this.lastServerRecvAt } : {}),
          ...(this.lastServerSimAt !== undefined ? { serverSimAt: this.lastServerSimAt } : {}),
          serverSentAt: performance.now(),
        },
      } : {}),
    };
  }

  recordAppliedInput(tick: number, applied: {
    readonly seq: number;
    readonly forward: number;
    readonly right: number;
    readonly jump: boolean;
    readonly sneak: boolean;
    readonly descend: boolean;
    readonly flySprint: boolean;
  }): void {
    this.appliedInputTrace.push({
      tick,
      seq: applied.seq,
      forward: applied.forward,
      right: applied.right,
      jump: applied.jump,
      sneak: applied.sneak,
      descend: applied.descend,
      flySprint: applied.flySprint,
      y: this.controller.position.y,
      vy: this.controller.velocity.y,
      flying: this.controller.isFlying,
      onGround: this.controller.onGround,
    });
    const extra = this.appliedInputTrace.length - 8;
    if (extra > 0) this.appliedInputTrace.splice(0, extra);
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
      kind: 'player',
      playerId: this.id,
      name: this.name,
      gamemode: this.gamemode,
    };
  }
}

function commandFromInput(input: ClientInputMessage): PlayerCommand {
  return {
    commandSeq: input.seq,
    clientTick: input.clientTick ?? input.seq,
    forward: input.forward,
    right: input.right,
    jump: input.jump,
    sneak: input.sneak,
    sprint: input.sprint,
    descend: input.descend,
    flySprint: input.flySprint,
    yaw: input.yaw,
    pitch: input.pitch,
    selectedSlot: input.selectedSlot,
    ...(input.mining === true ? { mining: true } : {}),
    ...(input.use === true ? { use: true } : {}),
    ...(input.vehicleForward !== undefined ? { vehicleForward: input.vehicleForward } : {}),
  };
}

function inputFromCommand(command: PlayerCommand): ClientInputMessage {
  return {
    type: 'input',
    seq: command.commandSeq,
    clientTick: command.clientTick,
    forward: command.forward,
    right: command.right,
    jump: command.jump,
    sneak: command.sneak,
    sprint: command.sprint,
    descend: command.descend,
    flySprint: command.flySprint,
    yaw: command.yaw,
    pitch: command.pitch,
    selectedSlot: command.selectedSlot,
    ...(command.mining === true ? { mining: true } : {}),
    ...(command.use === true ? { use: true } : {}),
    ...(command.vehicleForward !== undefined ? { vehicleForward: command.vehicleForward } : {}),
  };
}

export class WorldInstance {
  readyState: WorldReadyState = 'UNINITIALIZED';
  readonly world: VoxelWorld;
  readonly events = new EventBus();
  readonly commands = new CommandRegistry();
  readonly plugins = new PluginManager(this.events, this.commands);
  readonly pluginStore: JsonFileStore;
  readonly permissions: PermissionService;
  readonly teleports: TeleportService;
  readonly teleportHistory: TeleportHistoryService;
  readonly pluginConfig: PluginConfigService;
  readonly rtp: RtpService;
  readonly rtpSessions: RtpSessionManager;
  readonly holograms: HologramNetwork;
  readonly claimBoundaries: ClaimBoundaryNetwork;
  readonly selection = new PlayerSelectionService();
  readonly players = new Map<string, ServerPlayer>();
  readonly tokens = new Map<string, string>();
  readonly gameplay: ServerGameplay;
  tickNumber = 0;
  spawn: [number, number, number];
  lastTickMs = 0;
  maxTickMs = 0;
  private dirty = false;
  private readonly worldStore: FsWorldStore;
  private storedPlayers: Record<string, SerializedPersistedPlayer> = {};
  private createdAt = Date.now();
  private readonly generatedChunks = new Set<string>();
  private persistTimer: ReturnType<typeof setInterval> | undefined;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly dt: number;
  private tickAccumulator = 0;
  private lastTickWall = 0;
  private nextTickSlotAt = 0;
  private snapshotsGenerated = 0;
  private snapshotsSent = 0;
  private tpsWindowStart = 0;
  private tpsWindowTicks = 0;
  lastMeasuredTps = 0;
  lastMeasuredSnapGen = 0;
  lastMeasuredSnapSent = 0;
  lastPhysicsTicksThisLoop = 0;
  lastLoopElapsedMs = 0;
  lastLoopAccumulatorMs = 0;
  lastLoopLatenessMs = 0;
  lastCallbackMs = 0;
  lastChunkSends = 0;
  lastChunkGens = 0;
  lastEldMean = 0;
  lastEldP95 = 0;
  lastEldP99 = 0;
  lastEldMax = 0;
  droppedTicksTotal = 0;
  private eventLoopDelay?: IntervalHistogram;
  private lastTickMetrics: { blockChanges: number; entities: number; maxTickMs: number } = {
    blockChanges: 0,
    entities: 0,
    maxTickMs: 0,
  };
  private worldView: WorldView;
  private readonly debugTickOrder = process.env.FC_DEBUG_TICK === '1';
  /** DEV-only slow-tick wall log. Not a production profiler. */
  private readonly debugTickMs = process.env.FC_DEBUG_TICK_MS === '1';
  private readonly debugSnap = process.env.FC_DEBUG_SNAP === '1';
  private readonly kernelTrace: string[] = [];

  constructor(readonly config: ServerConfig) {
    this.worldStore = new FsWorldStore(config.dataDir);
    this.world = new VoxelWorld(config.worldSeed);
    this.gameplay = new ServerGameplay(this.world, this.events, (player) => {
      this.flushHealth(player as ServerPlayer);
    }, () => this.spawn);
    this.spawn = [0.5, 70, 0.5];
    this.dt = 1 / config.tickRate;
    this.worldView = this.createWorldView();
    this.pluginStore = new JsonFileStore(join(this.worldStore.directoryFor(config.worldId), 'plugin-data'));
    this.permissions = new PermissionService(this.pluginStore, config.operators, (idOrName) => {
      const direct = this.players.get(idOrName);
      if (direct) return direct.name;
      const lower = idOrName.toLowerCase();
      const named = [...this.players.values()].find((player) => player.name.toLowerCase() === lower);
      return named?.name ?? idOrName;
    });
    this.teleportHistory = new TeleportHistoryService();
    this.teleports = new TeleportService(config.worldId, this.teleportHistory, (playerId) => {
      const player = this.players.get(playerId);
      if (!player) return undefined;
      return {
        id: player.id,
        position: () => ({
          x: player.controller.position.x,
          y: player.controller.position.y,
          z: player.controller.position.z,
        }),
        teleport: (x, y, z) => {
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !isValidWorldY(Math.floor(y))) {
            return false;
          }
          player.controller.teleport([x, y, z]);
          return true;
        },
        sendMessage: (text) => {
          this.sendTo(player, {
            type: 'chat',
            from: 'server',
            playerId: 'server',
            text,
            kind: 'system',
          });
        },
      };
    });
    this.teleports.attach(this.events);
    this.pluginConfig = new PluginConfigService(this.pluginStore);
    this.rtp = new RtpService(this.world);
    this.rtpSessions = new RtpSessionManager(this.rtp);
    this.holograms = new HologramNetwork((list) => {
      this.broadcast({ type: 'holograms', holograms: [...list] });
    });
    this.claimBoundaries = new ClaimBoundaryNetwork((playerId, message) => {
      const player = this.players.get(playerId);
      if (player) this.sendTo(player, message);
    });
    this.commands.setPermissionCheck((sender, permission) => {
      if (isConsoleSender(sender) || sender.hasPermission?.(permission) === true) return true;
      if (permission === 'operator') {
        return this.permissions.isOperator(sender.name) || this.permissions.isOperator(sender.playerId);
      }
      return this.permissions.has(sender.playerId, permission) || this.permissions.has(sender.name, permission);
    });
    this.registerBuiltinCommands();
    this.plugins.attachHost(this.createPluginHost());
  }

  get worldId(): string {
    return this.config.worldId;
  }

  get seed(): string {
    return this.world.seed;
  }

  async initialize(): Promise<void> {
    this.readyState = 'INITIALIZING';
    const existing = await this.worldStore.load(this.worldId);
    if (existing) {
      this.createdAt = existing.summary.createdAt;
      this.world.restore({
        timeOfDay: existing.timeOfDay,
        modifications: existing.modifications,
        chests: (existing.chests ?? {}) as never,
        furnaces: (existing.furnaces ?? {}) as never,
        blockStates: existing.blockStates,
      });
      const spawn = existing.serverWorld?.spawn ?? existing.player.spawnPoint ?? existing.player.position;
      this.spawn = [spawn[0], spawn[1], spawn[2]];
      this.storedPlayers = existing.players ?? {};
      for (const stored of Object.values(this.storedPlayers)) {
        if (stored.sessionToken) this.tokens.set(stored.sessionToken, stored.id);
      }
      this.gameplay.restoreEntities(existing);
      this.permissions.load();
      this.preloadSpawnChunks();
      this.readyState = 'READY';
      serverLog(`world loaded: ${this.worldId} from ${this.worldStore.directoryFor(this.worldId)}`);
      return;
    }
    this.spawn = estimateWorldSpawn(this.world);
    this.createdAt = Date.now();
    this.permissions.load();
    this.preloadSpawnChunks();
    this.dirty = true;
    await this.save();
    this.readyState = 'READY';
    serverLog(`world created: ${this.worldId} at ${this.worldStore.directoryFor(this.worldId)}`);
    serverLog(
      'Fresh procedural Anarchy world. Browser IndexedDB is not imported. To bake frontier_spawn2.schem: npm run server:import -- --schem --force',
    );
  }

  async loadPlugins(): Promise<void> {
    await this.plugins.discover(this.config.pluginDir);
    if (this.config.loadBuiltinPlugins !== false) {
      const builtins = createBuiltinPlugins({
        permissions: this.permissions,
        teleports: this.teleports,
        history: this.teleportHistory,
        rtp: this.rtp,
        rtpSessions: this.rtpSessions,
        selection: this.selection,
        config: this.pluginConfig,
        plugins: this.plugins,
        world: this.world,
        worldId: () => this.worldId,
        markDirty: () => { this.dirty = true; },
        holograms: this.holograms,
        claimBoundaries: this.claimBoundaries,
      });
      for (const plugin of builtins) {
        if (this.plugins.list().some((entry) => entry.name === plugin.name)) continue;
        this.plugins.register(plugin, { source: 'builtin' });
      }
    }
    if (this.config.loadExamplePlugin) await this.plugins.loadBundledExample();
    await this.plugins.loadAll();
  }

  startLoops(): void {
    const tickMs = 1000 / this.config.tickRate;
    const now = performance.now();
    this.lastTickWall = now;
    this.nextTickSlotAt = now + tickMs;
    this.tpsWindowStart = now;
    this.eventLoopDelay?.disable();
    this.eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
    this.eventLoopDelay.enable();
    const loop = (): void => {
      const started = performance.now();
      this.lastLoopLatenessMs = started - this.nextTickSlotAt;
      this.lastChunkSends = 0;
      this.lastChunkGens = 0;
      const due = gameplayTicksDue(this.tickAccumulator, (started - this.lastTickWall) / 1000, this.dt);
      this.lastTickWall = started;
      this.tickAccumulator = due.nextAccumulator;
      this.lastLoopElapsedMs = due.elapsed * 1000;
      this.lastLoopAccumulatorMs = due.nextAccumulator * 1000;
      this.lastPhysicsTicksThisLoop = due.ticks;
      this.droppedTicksTotal += due.droppedTicks;
      if (due.ticks === 1) this.tick();
      else if (due.ticks > 1) this.tickCatchUp(due.ticks);
      else {
        for (const player of this.connectedPlayers()) this.syncChunksFor(player);
      }
      this.noteTpsWindow(due.ticks, started);
      this.lastCallbackMs = performance.now() - started;
      if (this.debugSnap && (this.lastCallbackMs >= 16 || this.lastLoopLatenessMs >= 16)) {
        serverLog(
          `loop late=${this.lastLoopLatenessMs.toFixed(1)}ms cb=${this.lastCallbackMs.toFixed(1)}ms `
          + `phys=${this.lastPhysicsTicksThisLoop} chunks send=${this.lastChunkSends} gen=${this.lastChunkGens} `
          + `eldMean=${this.lastEldMean.toFixed(1)} eldP99=${this.lastEldP99.toFixed(1)}`,
        );
      }
      const planned = scheduleNextTickSlot(this.nextTickSlotAt, performance.now(), tickMs);
      this.nextTickSlotAt = planned.nextSlotAt;
      this.tickTimer = setTimeout(loop, planned.waitMs);
    };
    this.tickTimer = setTimeout(loop, tickMs);
    this.persistTimer = setInterval(() => {
      if (this.dirty) void this.save();
    }, this.config.persistIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.eventLoopDelay?.disable();
    this.eventLoopDelay = undefined;
    await this.plugins.disableAll();
    await this.save();
  }

  async save(): Promise<void> {
    const players: Record<string, SerializedPersistedPlayer> = { ...this.storedPlayers };
    for (const player of this.players.values()) {
      players[player.id] = this.toStored(player);
    }
    this.storedPlayers = players;
    const entities = this.gameplay.persistEntities();
    const snapshot: WorldSnapshot = {
      schemaVersion: WORLD_SCHEMA_VERSION,
      summary: {
        id: this.worldId,
        name: this.worldId === ANARCHY_WORLD_ID ? 'Анархия' : this.worldId,
        seed: this.seed,
        mode: 'survival',
        kind: 'server',
        ...(this.worldId === ANARCHY_WORLD_ID ? { serverId: ANARCHY_SERVER_ID } : {}),
        createdAt: this.createdAt,
        updatedAt: Date.now(),
        playTimeSeconds: 0,
      },
      timeOfDay: this.world.timeOfDay,
      weather: 'clear',
      player: placeholderPlayer(this.spawn),
      players,
      modifications: this.world.serializeModifications(),
      blockStates: this.world.serializeBlockStates(),
      ...entities,
      serverWorld: {
        id: this.worldId,
        initialized: true,
        spawnImported: true,
        importVersion: ANARCHY_IMPORT_VERSION,
        spawn: this.spawn,
      },
    };
    await this.worldStore.save(snapshot);
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

  private maxInputGapMs(now = performance.now()): number {
    let maxGap = 0;
    for (const player of this.connectedPlayers()) {
      if (player.lastServerRecvAt === undefined) continue;
      maxGap = Math.max(maxGap, now - player.lastServerRecvAt, player.lastInputGapMs);
    }
    return Math.round(maxGap);
  }

  private maxInputPacketsThisLoop(): number {
    let maxPackets = 0;
    for (const player of this.connectedPlayers()) {
      maxPackets = Math.max(maxPackets, player.inputPacketsThisLoop);
    }
    return maxPackets;
  }

  private resetInputPacketCounters(): void {
    for (const player of this.players.values()) player.inputPacketsThisLoop = 0;
  }

  join(options: {
    sink: ConnectedSink;
    name?: string;
    sessionToken?: string;
  }): { player: ServerPlayer; resumed: boolean; previousConnectionId?: string } | { error: string } {
    if (this.readyState !== 'READY') return { error: 'world not ready' };
    if (this.onlineCount() >= this.config.maxPlayers) return { error: 'server full' };

    if (options.sessionToken) {
      const existingId = this.tokens.get(options.sessionToken);
      const existing = existingId ? this.players.get(existingId) : undefined;
      if (existing) {
        const previousConnectionId = existing.connectionId;
        existing.connected = true;
        existing.disconnectedAt = 0;
        existing.sink = options.sink;
        existing.connectionId = crypto.randomUUID();
        existing.joinCount += 1;
        existing.resumeCount += 1;
        existing.lastInputConnectionId = existing.connectionId;
        if (options.name) existing.name = options.name;
        this.resetConnectionInput(existing);
        const fp = sessionTokenFingerprint(existing.sessionToken);
        serverLog(
          `player joined: ${existing.name} (${existing.id}, resume) `
          + `conn=${existing.connectionId.slice(0, 8)} prev=${previousConnectionId.slice(0, 8)} fp=${fp} `
          + `resumeCount=${existing.resumeCount}`,
        );
        this.events.emit('playerJoin', { playerId: existing.id, name: existing.name });
        return { player: existing, resumed: true, previousConnectionId };
      }
      const stored = existingId ? this.storedPlayers[existingId] : undefined;
      if (stored) {
        const restored = this.materializeStoredPlayer(stored, options.sink, options.name);
        restored.joinCount += 1;
        restored.resumeCount += 1;
        serverLog(
          `player joined: ${restored.name} (${restored.id}, resume) `
          + `conn=${restored.connectionId.slice(0, 8)} fp=${sessionTokenFingerprint(restored.sessionToken)}`,
        );
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
      'survival',
      0,
    );
    player.controller.creativeFlightAllowed = player.gamemode === 'creative';
    player.sink = options.sink;
    player.lastInputConnectionId = player.connectionId;
    this.players.set(id, player);
    this.tokens.set(sessionToken, id);
    const spawnChunkX = floorDiv(Math.floor(player.controller.position.x), 16);
    const spawnChunkZ = floorDiv(Math.floor(player.controller.position.z), 16);
    player.viewCx = spawnChunkX;
    player.viewCz = spawnChunkZ;
    player.viewRadius = this.config.chunkViewRadius;
    this.syncChunksFor(player, { maxNewGenerates: Number.POSITIVE_INFINITY });
    serverLog(
      `player joined: ${player.name} (${player.id}) conn=${player.connectionId.slice(0, 8)} `
      + `fp=${sessionTokenFingerprint(player.sessionToken)}`,
    );
    this.events.emit('playerJoin', { playerId: player.id, name: player.name });
    this.dirty = true;
    return { player, resumed: false };
  }

  disconnect(playerId: string, persist = true, connectionId?: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;
    if (connectionId && player.connectionId !== connectionId) {
      netDebug('disconnect ignored', `stale conn ${connectionId.slice(0, 8)} live=${player.connectionId.slice(0, 8)}`);
      return;
    }
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.sink = null;
    player.activeSocketCount = 0;
    this.resetConnectionInput(player);
    serverLog(`player disconnected: ${player.name} (${player.id})`);
    this.events.emit('playerQuit', { playerId: player.id, name: player.name });
    this.broadcast({ type: 'player_left', playerId: player.id }, playerId);
    if (persist) {
      this.storedPlayers[player.id] = this.toStored(player);
      this.dirty = true;
    }
  }

  applyInput(
    player: ServerPlayer,
    input: ClientInputMessage,
    source?: { readonly connectionId: string },
  ): boolean {
    if (source && source.connectionId !== player.connectionId) {
      netDebug(
        'player input',
        `stale socket ${source.connectionId.slice(0, 8)} live=${player.connectionId.slice(0, 8)} seq=${input.seq}`,
      );
      return false;
    }
    if (input.seq < player.lastInputSeq) {
      netDebug('player input', `stale seq ${input.seq} < ${player.lastInputSeq} for ${player.id}`);
      return false;
    }
    if (input.seq === player.lastInputSeq) {
      netDebug('player input', `duplicate seq ${input.seq} for ${player.id}`);
      return false;
    }
    player.lastInputSeq = input.seq;
    player.lastInputConnectionId = source?.connectionId ?? player.connectionId;
    player.lastClientSentAt = input.clientSentAt;
    const recvAt = performance.now();
    if (player.lastServerRecvAt !== undefined) {
      player.lastInputGapMs = recvAt - player.lastServerRecvAt;
    }
    player.lastServerRecvAt = recvAt;
    player.inputPacketsThisLoop += 1;
    const enqueued = player.commandQueue.enqueue(commandFromInput(input));
    if (enqueued === 'stale') {
      netDebug('player input', `stale seq ${input.seq} < queued for ${player.id}`);
      return false;
    }
    if (enqueued === 'duplicate') {
      netDebug('player input', `duplicate seq ${input.seq} for ${player.id}`);
      return false;
    }
    player.lastInput = input;
    return true;
  }

  tryBreak(
    player: ServerPlayer,
    x: number,
    y: number,
    z: number,
    intent?: BlockTargetIntent,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (intent && (intent.targetX !== x || intent.targetY !== y || intent.targetZ !== z)) {
      return { ok: false, reason: 'invalid' };
    }
    if (player.miningTarget
      && (player.miningTarget.x !== x || player.miningTarget.y !== y || player.miningTarget.z !== z)) {
      netDebug('break rejected', `${player.name} ${x},${y},${z} reason=mining locked=${player.miningTarget.x},${player.miningTarget.y},${player.miningTarget.z} mode=${player.gamemode}`);
      return { ok: false, reason: 'mining' };
    }
    if (intent) {
      const lockedToThis = Boolean(
        player.miningTarget
        && player.miningTarget.x === x
        && player.miningTarget.y === y
        && player.miningTarget.z === z,
      );
      if (lockedToThis) {
        const block = this.world.getBlock(x, y, z);
        if (block === BlockId.Air) {
          netDebug('break rejected', `${player.name} ${x},${y},${z} reason=empty locked=1 id=${block}`);
          return { ok: false, reason: 'empty' };
        }
        if (block !== intent.targetBlockId) {
          netDebug('break rejected', `${player.name} ${x},${y},${z} reason=stale locked=1 id=${block} intent=${intent.targetBlockId}`);
          return { ok: false, reason: 'stale' };
        }
      } else {
        const validated = this.gameplay.validatePlayerIntent(player, intent, commandSeq);
        if (!validated.ok) {
          netDebug(
            'break rejected',
            `${player.name} ${x},${y},${z} reason=${validated.reason} locked=0 id=${this.world.getBlock(x, y, z)} mode=${player.gamemode}`,
          );
          return validated;
        }
      }
    }
    const result = this.gameplay.breakBlock(player, x, y, z);
    if (result.ok) {
      this.dirty = true;
      this.flushBlockChanges();
      this.flushPlayerInventory(player);
      netDebug('break accepted', `${player.name} ${x},${y},${z}`);
    } else {
      netDebug(
        'break rejected',
        `${player.name} ${x},${y},${z} reason=${result.reason} id=${this.world.getBlock(x, y, z)} mine=${player.miningTarget ? `${player.miningTarget.x},${player.miningTarget.y},${player.miningTarget.z}` : '—'} progress=${player.miningProgress} mode=${player.gamemode}`,
      );
    }
    return result;
  }

  tryPlace(
    player: ServerPlayer,
    x: number,
    y: number,
    z: number,
    requestedBlock?: number,
    intent?: BlockTargetIntent,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    const result = this.gameplay.placeBlock(player, x, y, z, requestedBlock, intent, commandSeq);
    if (result.ok) {
      this.dirty = true;
      this.flushBlockChanges();
      this.flushPlayerInventory(player);
      netDebug('place accepted', `${player.name} ${x},${y},${z} -> ${requestedBlock ?? 'held'}`);
    }
    return result;
  }

  beginMining(
    player: ServerPlayer,
    intent: BlockTargetIntent,
    actionSeq?: number,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.acceptActionSeq(player, actionSeq)) return { ok: false, reason: 'duplicate' };
    return this.gameplay.beginMining(player, intent, commandSeq);
  }

  abortMining(player: ServerPlayer): void {
    player.miningProgress = 0;
    player.miningTarget = undefined;
  }

  releaseBow(player: ServerPlayer, action: Pick<BowReleaseAction, 'yaw' | 'pitch' | 'actionSeq' | 'commandSeq'>): { ok: true } | { ok: false; reason: string } {
    if (!this.acceptActionSeq(player, action.actionSeq)) return { ok: false, reason: 'duplicate' };
    if (action.actionSeq <= player.lastBowReleaseSeq) return { ok: false, reason: 'duplicate' };
    player.lastBowReleaseSeq = action.actionSeq;
    const result = this.gameplay.releaseBowWithAim(player, action.yaw, action.pitch);
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    return result;
  }

  applyInventoryAction(player: ServerPlayer, action: ClientInventoryActionMessage): void {
    this.gameplay.applyInventory(player, action);
    this.dirty = true;
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    this.flushSharedContainerViewers(player);
  }

  attack(player: ServerPlayer): void {
    this.gameplay.attack(player, [...this.players.values()]);
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
  }

  interact(
    player: ServerPlayer,
    intent?: BlockTargetIntent,
    actionSeq?: number,
    commandSeq?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.acceptActionSeq(player, actionSeq)) return { ok: false, reason: 'duplicate' };
    const result = this.gameplay.useHeld(player, intent, commandSeq);
    this.dirty = true;
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    return result;
  }

  pickup(player: ServerPlayer): void {
    this.gameplay.collectFor(player);
    this.flushPlayerInventory(player);
  }

  vehicleInput(player: ServerPlayer, message: ClientVehicleInputMessage): void {
    if (message.action === 'exit') this.gameplay.exitVehicle(player);
    else if (message.action === 'enter' && message.entityId) this.gameplay.enterVehicle(player, message.entityId);
    else if (message.action === 'steer' && message.forward !== undefined) {
      player.vehicleForward = Math.max(-1, Math.min(1, message.forward));
    }
  }

  dispatchConsole(raw: string): CommandResult {
    const command = normalizeConsoleCommand(raw);
    if (!command) return { ok: true, lines: [] };
    try {
      const dispatched = this.commands.dispatch(command, createConsoleCommandSender());
      return dispatched.result ?? { ok: false, lines: ['Empty command.'] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      serverLog(`console command failed: ${message}`, 'error');
      return { ok: false, lines: [`Command failed: ${message}`] };
    }
  }

  handleChat(player: ServerPlayer, text: string): void {
    if (text.startsWith('/')) {
      const commandEvent = this.events.createPlayerCommand(player.id, text);
      this.events.emit('playerCommand', commandEvent);
      if (commandEvent.cancelled) {
        this.sendTo(player, { type: 'command_result', ok: false, name: text.slice(1).split(/\s+/)[0] ?? '', lines: ['Command cancelled.'] });
        return;
      }
      const dispatched = this.commands.dispatch(text, {
        ...player.commandSender(),
        operator: this.isOperator(player),
      });
      this.events.emit('playerCommandExecuted', {
        playerId: player.id,
        command: text,
        ok: dispatched.result?.ok ?? false,
      });
      const kind = dispatched.result?.ok ? 'command' : 'error';
      const name = dispatched.parsed.kind === 'command' ? dispatched.parsed.name : text.slice(1);
      this.sendTo(player, {
        type: 'command_result',
        ok: dispatched.result?.ok ?? false,
        name,
        lines: dispatched.result?.lines ?? [],
      });
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
      this.flushPlayerInventory(player);
      this.flushBlockChanges();
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

  setActiveSocketCount(playerId: string, count: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.activeSocketCount = Math.max(0, Math.floor(count));
  }

  isActiveConnection(player: ServerPlayer, connectionId: string): boolean {
    return player.connected && player.connectionId === connectionId;
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
    this.lastPhysicsTicksThisLoop = 1;
    this.clearAppliedSteps();
    this.simulateGameplayTick();
    this.flushTickNetwork();
  }

  /**
   * Run N physics ticks but broadcast **one** player_state at the end.
   * Catch-up includes AppliedMovementStep[] so each tick remains named.
   */
  tickCatchUp(count: number): void {
    const n = Math.max(0, Math.floor(count));
    this.lastPhysicsTicksThisLoop = n;
    this.clearAppliedSteps();
    for (let i = 0; i < n; i += 1) this.simulateGameplayTick();
    if (n > 0) this.flushTickNetwork();
  }

  private clearAppliedSteps(): void {
    for (const player of this.players.values()) player.appliedStepsThisLoop.length = 0;
  }

  private noteTpsWindow(ticks: number, now: number): void {
    this.tpsWindowTicks += ticks;
    const elapsed = now - this.tpsWindowStart;
    if (elapsed < 1000) return;
    this.lastMeasuredTps = this.tpsWindowTicks * 1000 / elapsed;
    this.lastMeasuredSnapGen = this.snapshotsGenerated * 1000 / elapsed;
    this.lastMeasuredSnapSent = this.snapshotsSent * 1000 / elapsed;
    const histogram = this.eventLoopDelay;
    if (histogram) {
      this.lastEldMean = histogram.mean / 1e6;
      this.lastEldP95 = histogram.percentile(95) / 1e6;
      this.lastEldP99 = histogram.percentile(99) / 1e6;
      this.lastEldMax = histogram.max / 1e6;
      histogram.reset();
    }
    if (this.debugSnap) {
      serverLog(
        `snap/s gen=${this.lastMeasuredSnapGen.toFixed(1)} sent=${this.lastMeasuredSnapSent.toFixed(1)} `
        + `tps=${this.lastMeasuredTps.toFixed(1)} dropped=${this.droppedTicksTotal} `
        + `loop phys=${this.lastPhysicsTicksThisLoop} late=${this.lastLoopLatenessMs.toFixed(1)} `
        + `cb=${this.lastCallbackMs.toFixed(1)} eldMean=${this.lastEldMean.toFixed(1)} `
        + `eldP99=${this.lastEldP99.toFixed(1)} eldMax=${this.lastEldMax.toFixed(1)} `
        + `chunks send=${this.lastChunkSends} gen=${this.lastChunkGens}`,
      );
    }
    this.tpsWindowStart = now;
    this.tpsWindowTicks = 0;
    this.snapshotsGenerated = 0;
    this.snapshotsSent = 0;
  }

  private simulateGameplayTick(): void {
    const started = performance.now();
    this.tickNumber += 1;
    const dt = this.dt;
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      player.lastServerSimAt = started;
    }
    if (this.debugTickOrder) this.kernelTrace.length = 0;
    const metrics = this.gameplay.tick([...this.players.values()], dt, {
      tickPlayers: () => this.tickConnectedPlayers(dt),
      trace: this.debugTickOrder ? this.kernelTrace : undefined,
    });
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      this.gameplay.updateRiding(player, player.lastInput.sprint);
    }
    this.lastTickMs = performance.now() - started;
    this.maxTickMs = Math.max(this.maxTickMs, this.lastTickMs, metrics.maxTickMs);
    this.flushBlockChanges();
    const wallMs = performance.now() - started;
    if (this.debugTickMs && wallMs >= 16) {
      serverLog(
        `tick-ms n=${this.tickNumber} wall=${wallMs.toFixed(2)} gameplay=${this.lastTickMs.toFixed(2)} `
        + `blocks=${metrics.blockChanges} entities=${metrics.entities} online=${this.onlineCount()}`,
        'warn',
      );
    }
    this.lastTickMetrics = metrics;
    this.finishRtpSearches();
    this.teleports.tick(dt * 1000);
    if (this.connectedPlayers().length > 0) this.snapshotsGenerated += 1;
  }

  private finishRtpSearches(): void {
    for (const result of this.rtpSessions.tick()) {
      const player = this.players.get(result.playerId);
      if (result.dest) {
        const teleported = this.teleports.schedule(result.playerId, result.dest, result.request.reason, {
          warmupMs: result.request.warmupMs,
          cooldownMs: result.request.cooldownMs,
          cancelOnMove: result.request.cancelOnMove,
          cancelOnDamage: result.request.cancelOnDamage,
        });
        if (!teleported.ok && player) {
          this.sendTo(player, {
            type: 'chat',
            from: 'server',
            playerId: 'server',
            text: teleported.error ?? 'RTP failed.',
            kind: 'error',
          });
        } else if (player) {
          this.sendTo(player, {
            type: 'chat',
            from: 'server',
            playerId: 'server',
            text: 'Found a safe location.',
            kind: 'system',
          });
        }
      } else if (player) {
        this.sendTo(player, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text: 'Could not find a safe RTP location. Try again.',
          kind: 'error',
        });
      }
    }
  }

  private flushTickNetwork(): void {
    const passengers = new Map<string, string>();
    for (const player of this.players.values()) {
      if (player.ridingCartId) passengers.set(player.ridingCartId, player.id);
    }
    for (const player of this.connectedPlayers()) this.syncChunksFor(player);
    const snapshots = this.connectedPlayers().map((player) => player.snapshot());
    for (const player of this.connectedPlayers()) player.commandQueue.lastCompacted = undefined;
    if (snapshots.length > 0) {
      this.broadcast({
        type: 'player_state',
        tick: this.tickNumber,
        physicsTicks: Math.max(1, this.lastPhysicsTicksThisLoop),
        tickClock: {
          physicsTps: this.lastMeasuredTps,
          snapGen: this.lastMeasuredSnapGen,
          snapSent: this.lastMeasuredSnapSent,
          droppedTicks: this.droppedTicksTotal,
          elapsedMs: this.lastLoopElapsedMs,
          accumulatorMs: this.lastLoopAccumulatorMs,
          physicsTicksThisLoop: this.lastPhysicsTicksThisLoop,
          latenessMs: this.lastLoopLatenessMs,
          callbackMs: this.lastCallbackMs,
          eldMean: this.lastEldMean,
          eldP95: this.lastEldP95,
          eldP99: this.lastEldP99,
          eldMax: this.lastEldMax,
          tickWallMs: this.lastTickMs,
          entities: this.lastTickMetrics.entities,
          blockChanges: this.lastTickMetrics.blockChanges,
          chunkSends: this.lastChunkSends,
          chunkGens: this.lastChunkGens,
          inputGapMs: this.maxInputGapMs(),
          inputPackets: this.maxInputPacketsThisLoop(),
        },
        players: snapshots,
      });
      this.snapshotsSent += 1;
    }
    this.resetInputPacketCounters();
    for (const player of this.connectedPlayers()) {
      this.sendTo(player, {
        type: 'entity_snapshot',
        tick: this.tickNumber,
        entities: this.gameplay.snapshotsNear(player.controller.position, passengers),
      });
      this.flushPlayerInventory(player, false);
      this.flushHealth(player);
    }
    const entityEvents = this.gameplay.consumeEntityEvents();
    if (entityEvents.length > 0) {
      this.broadcast({ type: 'entity_event', tick: this.tickNumber, events: entityEvents });
    }
    if (this.tickNumber % 20 === 0) {
      this.broadcast({ type: 'time', timeOfDay: this.world.timeOfDay });
    }
    if (this.tickNumber % 200 === 0) {
      const kernel = this.debugTickOrder && this.kernelTrace.length > 0
        ? ` kernel ${formatGameplayKernelTrace(this.kernelTrace)}`
        : '';
      const metrics = this.lastTickMetrics;
      serverLog(
        `tick ${this.tickNumber} ${this.lastTickMs.toFixed(2)}ms max ${this.maxTickMs.toFixed(2)}ms `
        + `players ${this.onlineCount()} entities ${metrics.entities} blocks ${metrics.blockChanges}`
        + ` tps=${this.lastMeasuredTps.toFixed(1)} snapGen=${this.lastMeasuredSnapGen.toFixed(1)} `
        + `snapSent=${this.lastMeasuredSnapSent.toFixed(1)}${kernel}`,
      );
    }
    this.sweepDisconnected();
  }

  acceptClientActionSeq(player: ServerPlayer, actionSeq: number | undefined): boolean {
    return this.acceptActionSeq(player, actionSeq);
  }

  /**
   * A new browser client always starts input seq at 0. Keep lastInputSeq
   * only for the live socket; otherwise re-entry after Anarchy→SP→Anarchy
   * rejects every WASD packet as stale while look/chat still work.
   */
  private acceptActionSeq(player: ServerPlayer, actionSeq: number | undefined): boolean {
    if (actionSeq === undefined) return true;
    if (actionSeq < player.lastActionSeq) return false;
    if (actionSeq === player.lastActionSeq) return false;
    player.lastActionSeq = actionSeq;
    return true;
  }

  private resetConnectionInput(player: ServerPlayer): void {
    player.lastInputSeq = inputSeqAfterReconnect();
    player.appliedCommandSeq = -1;
    player.lastActionSeq = -1;
    player.lastBowReleaseSeq = -1;
    player.commandQueue.clear({
      yaw: player.controller.yaw,
      pitch: player.controller.pitch,
      selectedSlot: player.selectedSlot,
    });
    player.appliedStepsThisLoop.length = 0;
    player.actionPoseHistory.length = 0;
    player.miningTarget = undefined;
    player.miningProgress = 0;
    player.bowUseTicks = 0;
    player.foodUseTicks = 0;
    player.lastUse = false;
    player.lastSprint = false;
    player.vehicleForward = 0;
    player.lastInput = {
      ...IDLE_INPUT,
      yaw: player.controller.yaw,
      pitch: player.controller.pitch,
      selectedSlot: player.selectedSlot,
    };
  }

  /** Player physics + survival + mining/use hold. Invoked from GameplayKernel `players` step. */
  private tickConnectedPlayers(dt: number): void {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      const command = player.commandQueue.takeForTick();
      if (command) {
        player.lastInput = inputFromCommand(command);
        player.appliedCommandSeq = command.commandSeq;
        player.selectedSlot = command.selectedSlot;
        player.controller.yaw = command.yaw;
        player.controller.pitch = command.pitch;
        player.vehicleForward = command.vehicleForward
          ?? (player.ridingCartId ? command.forward : 0);
      }
      const input = player.lastInput;
      const jump = input.jump;
      const using = input.use === true;
      const before = player.controller.position.clone();
      player.controller.creativeFlightAllowed = player.gamemode === 'creative';
      const riding = Boolean(player.ridingCartId);
      player.controller.tick(this.world, {
        yaw: input.yaw,
        pitch: input.pitch,
        locomotion: !riding,
        movement: () => ({
          forward: riding ? 0 : input.forward,
          right: riding ? 0 : input.right,
          jump: riding ? false : jump,
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
        player.survival.damage(amount, cause === 'fall' ? 'fall' : 'generic', { armor: player.inventory });
        this.events.emit('playerDamaged', { playerId: player.id, amount, cause });
        if (player.survival.dead) {
          this.events.emit('entityDeath', { entityId: player.id, cause, playerId: player.id });
        }
        this.flushHealthIfDeadThenRespawn(player);
      });
      player.combat.setHeldItem(player.inventory.getSlot(player.selectedSlot)?.itemId);
      player.combat.setOffhand(player.inventory.offhand?.itemId);
      player.combat.updateUse(using, true, !player.survival.dead);
      if (player.gamemode === 'survival') {
        player.survival.tick(dt, {
          player: player.controller,
          world: this.world,
          armor: player.inventory,
          inFire: player.controller.inFire,
          sprinting: player.controller.sprinting,
          swimming: player.controller.inWater,
        });
        this.flushHealthIfDeadThenRespawn(player);
      }
      if (input.mining) this.gameplay.advanceMining(player);
      else {
        player.miningProgress = 0;
        player.miningTarget = undefined;
      }
      this.gameplay.advanceUseHold(player, using);
      player.recordAppliedInput(this.tickNumber, {
        seq: player.appliedCommandSeq >= 0 ? player.appliedCommandSeq : player.lastInputSeq,
        forward: riding ? 0 : input.forward,
        right: riding ? 0 : input.right,
        jump: riding ? false : jump,
        sneak: input.sneak,
        descend: input.descend === true,
        flySprint: input.flySprint === true,
      });
      const position = player.controller.position;
      const velocity = player.controller.velocity;
      player.appliedStepsThisLoop.push({
        serverTick: this.tickNumber,
        commandSeq: player.appliedCommandSeq >= 0 ? player.appliedCommandSeq : 0,
        x: position.x,
        y: position.y,
        z: position.z,
        vx: velocity.x,
        vy: velocity.y,
        vz: velocity.z,
        onGround: player.controller.onGround,
        flying: player.controller.isFlying,
        sneaking: player.controller.sneaking,
        sprinting: player.controller.sprinting,
      });
      if (player.appliedStepsThisLoop.length > APPLIED_STEPS_MAX) {
        player.appliedStepsThisLoop.splice(0, player.appliedStepsThisLoop.length - APPLIED_STEPS_MAX);
      }
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
      const eye = player.controller.eyePosition();
      recordActionPose(player.actionPoseHistory, {
        commandSeq: player.appliedCommandSeq >= 0 ? player.appliedCommandSeq : 0,
        eyeX: eye.x,
        eyeY: eye.y,
        eyeZ: eye.z,
        selectedSlot: player.selectedSlot,
      });
    }
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

  private flushBlockChanges(): void {
    const changes = this.gameplay.consumeBlockChanges();
    if (changes.length === 0) return;
    this.dirty = true;
    if (changes.length === 1) {
      this.broadcast({ type: 'block_update', ...changes[0] });
      return;
    }
    this.broadcast({ type: 'block_batch', changes });
  }

  private flushPlayerInventory(player: ServerPlayer, force = true): void {
    if (!force && !player.inventoryDirty) return;
    player.inventoryDirty = false;
    const chest = player.window.kind === 'chest' && player.window.x !== undefined
      ? this.world.getChest(player.window.x, player.window.y ?? 0, player.window.z ?? 0)
      : undefined;
    const furnace = player.window.kind === 'furnace' && player.window.x !== undefined
      ? this.world.getFurnace(player.window.x, player.window.y ?? 0, player.window.z ?? 0)
      : undefined;
    this.sendTo(player, {
      type: 'inventory',
      inventory: player.inventory.serialize(),
      selectedSlot: player.selectedSlot,
      gamemode: player.gamemode,
      cursor: player.cursor,
      craftSlots: player.craftSlots,
      window: {
        kind: player.window.kind,
        x: player.window.x,
        y: player.window.y,
        z: player.window.z,
        slots: chest?.slots ?? furnace?.slots,
      },
    });
  }

  /** Other clients with the same chest/furnace open must see the mutation immediately. */
  private flushSharedContainerViewers(actor: ServerPlayer): void {
    for (const other of this.players.values()) {
      if (other.id === actor.id || !other.connected) continue;
      if (!sameSharedContainerWindow(actor.window, other.window)) continue;
      this.flushPlayerInventory(other, true);
    }
  }

  private flushHealthIfDeadThenRespawn(player: ServerPlayer): void {
    this.gameplay.respawnIfDead(player);
  }

  private flushHealth(player: ServerPlayer): void {
    const health = {
      type: 'health' as const,
      health: player.survival.health,
      hunger: player.survival.hunger,
      saturation: player.survival.saturation,
      absorption: player.survival.absorption,
      air: player.survival.airTicks,
      armor: getArmorPoints(player.inventory),
      fire: player.survival.isOnFire,
      dead: player.survival.dead,
    };
    const signature = JSON.stringify(health);
    if (signature !== player.healthSignature) {
      player.healthSignature = signature;
      this.sendTo(player, health);
    }
    const effects = player.survival.activeEffects().map((effect) => ({
      id: effect.id,
      amplifier: effect.amplifier,
      remainingTicks: effect.ticks,
    }));
    const effectSignature = JSON.stringify(effects);
    if (effectSignature !== player.effectSignature) {
      player.effectSignature = effectSignature;
      this.sendTo(player, { type: 'effects', effects });
    }
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
    const chunk = this.world.getChunk(cx, cz, true);
    if (chunk && !chunk.lightingReady) this.world.ensureChunkLighting(chunk);
    if (already) return;
    this.generatedChunks.add(key);
    if (announce) serverLog(`chunk loaded ${key}`);
  }

  private syncChunksFor(
    player: ServerPlayer,
    options?: { readonly maxNewGenerates?: number },
  ): void {
    const radius = player.viewRadius;
    const maxNew = options?.maxNewGenerates ?? MAX_NEW_CHUNK_GENERATES_PER_SYNC;
    const wanted = new Set<string>();
    let generated = 0;
    for (let z = player.viewCz - radius; z <= player.viewCz + radius; z += 1) {
      for (let x = player.viewCx - radius; x <= player.viewCx + radius; x += 1) {
        const key = chunkKey(x, z);
        wanted.add(key);
        const alreadyGenerated = this.generatedChunks.has(key);
        if (!alreadyGenerated) {
          if (generated >= maxNew) continue;
          this.ensureChunk(x, z);
          generated += 1;
          this.lastChunkGens += 1;
        } else if (!player.knownChunks.has(key)) {
          this.ensureChunk(x, z, false);
        }
        if (!this.generatedChunks.has(key)) continue;
        if (!player.knownChunks.has(key)) {
          player.knownChunks.add(key);
          const mods = this.world.serializeChunkModifications(x, z);
          this.sendTo(player, { type: 'chunk_data', cx: x, cz: z, modifications: mods });
          this.lastChunkSends += 1;
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
      setSpawn: (x: number, y: number, z: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
        instance.spawn = [x, y, z];
        instance.dirty = true;
        return true;
      },
      getTimeOfDay: () => instance.world.timeOfDay,
      getBlock: (x: number, y: number, z: number) => instance.world.getBlock(x, y, z),
      setBlock: (x: number, y: number, z: number, blockId: number) => {
        if (!isKnownBlockId(blockId) || !isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) {
          return false;
        }
        if (!instance.world.setBlock(x, y, z, blockId)) return false;
        instance.dirty = true;
        instance.flushBlockChanges();
        return true;
      },
      breakBlock: (x: number, y: number, z: number) => {
        if (!isValidWorldY(y) || !Number.isInteger(x) || !Number.isInteger(z)) return false;
        if (instance.world.getBlock(x, y, z) === BlockId.Air) return false;
        return instance.worldView.setBlock(x, y, z, BlockId.Air);
      },
      getEntity: (id: string): PluginEntityView | undefined => {
        if (instance.players.has(id)) return { id, kind: 'player' };
        return instance.gameplay.lookupEntity(id);
      },
      surfaceY: (x: number, z: number) => instance.world.surfaceY(x, z),
      isSolid: (x: number, y: number, z: number) => getBlockDefinition(instance.world.getBlock(x, y, z)).solid,
      isLiquid: (x: number, y: number, z: number) => getBlockDefinition(instance.world.getBlock(x, y, z)).liquid === true,
    });
  }

  private isOperator(player: ServerPlayer): boolean {
    return this.permissions.isOperator(player.name) || this.permissions.isOperator(player.id);
  }

  private createPluginPlayer(player: ServerPlayer): PlayerView {
    const instance = this;
    return Object.freeze({
      id: player.id,
      get name() { return player.name; },
      get connected() { return player.connected; },
      get gamemode() { return player.gamemode; },
      health: () => player.survival.health,
      position: () => ({
        x: player.controller.position.x,
        y: player.controller.position.y,
        z: player.controller.position.z,
      }),
      snapshot: () => player.snapshot(),
      teleport: (x: number, y: number, z: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !isValidWorldY(y)) return false;
        player.controller.teleport([x, y, z]);
        return true;
      },
      sendMessage: (text: string) => {
        instance.sendTo(player, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text,
          kind: 'system',
        });
      },
      give: (itemId: string, count: number) => {
        if (!isKnownItemId(itemId) || !Number.isInteger(count) || count < 1) return { given: 0, leftover: count };
        const leftover = player.inventory.addItem(itemId, count);
        const given = count - leftover;
        player.inventoryDirty = true;
        if (leftover > 0) instance.gameplay.dropFromPlayer(player, createItemStack(itemId, leftover));
        instance.flushPlayerInventory(player);
        instance.flushBlockChanges();
        return { given, leftover };
      },
      removeItem: (itemId: string, count: number) => {
        const removed = player.inventory.remove(itemId, count);
        if (removed > 0) {
          player.inventoryDirty = true;
          instance.flushPlayerInventory(player);
        }
        return removed;
      },
      clearInventory: () => {
        let count = 0;
        for (const stack of player.inventory.slots) if (stack) count += stack.count;
        for (const stack of Object.values(player.inventory.armor)) if (stack) count += stack.count;
        if (player.inventory.offhand) count += player.inventory.offhand.count;
        player.inventory.clear();
        player.cursor = null;
        player.craftSlots = player.craftSlots.map(() => null);
        player.inventoryDirty = true;
        instance.flushPlayerInventory(player);
        return count;
      },
      hasItem: (itemId: string, count = 1) => player.inventory.has(itemId, count),
      kick: (reason?: string) => {
        if (reason) {
          instance.sendTo(player, {
            type: 'chat',
            from: 'server',
            playerId: 'server',
            text: reason,
            kind: 'error',
          });
        }
        instance.disconnect(player.id);
      },
    });
  }

  private createPluginHost(): PluginHost {
    const instance = this;
    return {
      status: () => ({
        worldId: instance.worldId,
        seed: instance.seed,
        readyState: instance.readyState,
        tickRate: instance.config.tickRate,
        tickNumber: instance.tickNumber,
        playerCount: instance.onlineCount(),
        pluginApiVersion: PLUGIN_API_VERSION,
      }),
      world: () => instance.worldView,
      players: () => instance.connectedPlayers().map((player) => instance.createPluginPlayer(player)),
      player: (idOrName) => {
        const lower = idOrName.toLowerCase();
        const found = instance.connectedPlayers().find((entry) => entry.id === idOrName || entry.name.toLowerCase() === lower);
        return found ? instance.createPluginPlayer(found) : undefined;
      },
      broadcast: (text) => instance.broadcastChat('system', 'server', text),
      permissions: () => instance.permissions,
      teleports: () => instance.teleports,
      history: () => instance.teleportHistory,
      config: () => instance.pluginConfig,
      dataLoad: (plugin, key, fallback) => instance.pluginStore.load(`${plugin}/${key}`, fallback),
      dataSave: (plugin, key, value) => instance.pluginStore.save(`${plugin}/${key}`, value),
    };
  }

  private materializeStoredPlayer(stored: SerializedPersistedPlayer, sink: ConnectedSink, name?: string): ServerPlayer {
    const controller = new PlayerController({
      position: [stored.x, stored.y, stored.z],
      yaw: stored.yaw,
      pitch: stored.pitch,
    });
    const token = stored.sessionToken ?? crypto.randomUUID();
    const survival = new SurvivalSystem({ health: stored.health });
    if (stored.survival) {
      try {
        survival.restore(stored.survival as never);
      } catch {
        survival.restore({ health: stored.health });
      }
    }
    const player = new ServerPlayer(
      stored.id,
      token,
      name ?? stored.name,
      controller,
      this.restoreInventory(stored.inventory),
      isGameMode(stored.gamemode) ? stored.gamemode : 'survival',
      stored.selectedSlot,
      survival,
    );
    if (stored.cursor) {
      try {
        player.cursor = stored.cursor as ItemStack;
      } catch {
        player.cursor = null;
      }
    }
    player.controller.creativeFlightAllowed = player.gamemode === 'creative';
    player.sink = sink;
    this.players.set(player.id, player);
    this.tokens.set(token, player.id);
    player.viewCx = floorDiv(Math.floor(player.controller.position.x), 16);
    player.viewCz = floorDiv(Math.floor(player.controller.position.z), 16);
    player.viewRadius = this.config.chunkViewRadius;
    this.syncChunksFor(player, { maxNewGenerates: Number.POSITIVE_INFINITY });
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

  private toStored(player: ServerPlayer): SerializedPersistedPlayer {
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
      survival: player.survival.serialize(),
      cursor: player.cursor,
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
      name: 'give',
      usage: '/give <item> [count]',
      description: 'Give an item to yourself',
      execute: (args, sender) => {
        const player = this.players.get(sender.playerId);
        if (!player) return fail('Player not found.');
        if (!args[0]) return fail('Usage: /give <item> [count]');
        const itemId = resolveItemId(args[0]);
        if (!itemId || !isKnownItemId(itemId)) return fail(`Unknown item '${args[0]}'.`);
        const rawCount = args[1] === undefined || args[1] === '' ? 1 : Number(args[1]);
        if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > 2304) {
          return fail('Count must be an integer from 1 to 2304.');
        }
        const leftover = player.inventory.addItem(itemId, rawCount);
        const given = rawCount - leftover;
        player.inventoryDirty = true;
        if (leftover > 0) {
          this.gameplay.dropFromPlayer(player, createItemStack(itemId, leftover));
        }
        this.flushPlayerInventory(player);
        if (given <= 0) return fail('Could not give item: inventory is full.');
        if (leftover > 0) return ok(`Gave ${given} ${itemId} (${leftover} dropped, inventory full)`);
        return ok(`Gave ${given} ${itemId}`);
      },
    });
    this.commands.register({
      name: 'time',
      usage: '/time <day|noon|night|midnight>',
      description: 'Set the time of day',
      execute: (args) => {
        const key = args[0]?.toLowerCase() as keyof typeof TIME_PRESETS | undefined;
        if (!key || TIME_PRESETS[key] === undefined) return fail('Usage: /time <day|noon|night|midnight>');
        this.world.timeOfDay = TIME_PRESETS[key];
        this.broadcast({ type: 'time', timeOfDay: this.world.timeOfDay });
        this.dirty = true;
        return ok(`Set time to ${key} (${TIME_PRESETS[key]})`);
      },
    });
    this.commands.register({
      name: 'tp',
      aliases: ['teleport'],
      usage: '/tp <x> <y> <z>',
      description: 'Teleport to coordinates',
      execute: (args, sender) => {
        const player = this.players.get(sender.playerId);
        if (!player) return fail('Player not found.');
        const x = Number(args[0]);
        const y = Number(args[1]);
        const z = Number(args[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return fail('Usage: /tp <x> <y> <z>');
        }
        if (!isValidWorldY(y)) return fail('Y is outside the world.');
        const result = this.teleports.now(player.id, { x, y, z }, 'command', { silent: true });
        if (!result.ok) return fail(result.error ?? 'Teleport failed.');
        return ok(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
      },
    });
    this.commands.register({
      name: 'clear',
      usage: '/clear',
      description: 'Clear your inventory',
      execute: (_args, sender) => {
        const player = this.players.get(sender.playerId);
        if (!player) return fail('Player not found.');
        let count = 0;
        for (const stack of player.inventory.slots) if (stack) count += stack.count;
        for (const stack of Object.values(player.inventory.armor)) if (stack) count += stack.count;
        if (player.inventory.offhand) count += player.inventory.offhand.count;
        player.inventory.clear();
        player.cursor = null;
        player.craftSlots = player.craftSlots.map(() => null);
        player.inventoryDirty = true;
        this.flushPlayerInventory(player);
        return ok(count > 0 ? `Cleared ${count} item(s) from inventory` : 'Inventory is already empty');
      },
    });
    this.commands.register({
      name: 'predsim',
      usage: '/predsim [ticks]',
      description: 'DEV: lockstep pose dump (walk/flight/stationary) and latest-input coalesce',
      execute: (args) => {
        const raw = args[0] === undefined || args[0] === '' ? 20 : Number(args[0]);
        const ticks = Number.isInteger(raw) && raw >= 1 && raw <= 40 ? raw : 20;
        const sampleAt = [1, 2, 3, 10, Math.min(20, ticks)].filter((tick, index, all) => all.indexOf(tick) === index && tick <= ticks);
        const modes = compareLockstepModes(ticks);
        const walkDump = dumpControllerTicks(sampleAt, { forward: 1 });
        const idleDump = dumpControllerTicks(sampleAt, {});
        const flyDump = dumpControllerTicks(sampleAt, {}, { flying: true, startY: 8 });
        const flyDownDump = dumpControllerTicks(sampleAt, { descend: true }, { flying: true, startY: 8 });
        const coalesce = compareLatestInputCoalesce(2, 1, { forward: 1 });
        const catchUp = compareLatestInputCoalesce(2, 2, { forward: 1 });
        const modeLines = Object.entries(modes).map(([name, result]) => (
          `${name} identical=${result.identical ? 'yes' : 'NO'} first=${result.firstDivergedTick ?? 'none'}`
        ));
        return ok([
          ...modeLines,
          ...formatPoseDump('walk', walkDump),
          ...formatPoseDump('idle', idleDump),
          ...formatPoseDump('flyHover', flyDump),
          ...formatPoseDump('flySHIFT', flyDownDump),
          ...formatLatestInputCoalesce(coalesce),
          `catch-up 2=2 ${formatLatestInputCoalesce(catchUp)[0]!.replace('coalesce ', '')}`,
          `server tps=${this.lastMeasuredTps.toFixed(1)} snapGen/s=${this.lastMeasuredSnapGen.toFixed(1)} snapSent/s=${this.lastMeasuredSnapSent.toFixed(1)}`,
        ]);
      },
    });
    this.commands.register({
      name: 'kill',
      usage: '/kill',
      description: 'Kill yourself',
      execute: (_args, sender) => {
        const player = this.players.get(sender.playerId);
        if (!player) return fail('Player not found.');
        player.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
        this.flushHealthIfDeadThenRespawn(player);
        return { ok: true, lines: [] };
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
