import { join } from 'node:path';
import { BlockId, getBlockDefinition, isKnownBlockId } from '../src/blocks';
import { CombatSystem } from '../src/combat';
import { TIME_PRESETS, resolveItemId } from '../src/chat/commands';
import { TICK_RATE, PLAYER_NET_REACH, WORLDGEN_VERSION, chunkKey, floorDiv, isValidWorldY } from '../src/core/constants';
import { inputSeqAfterReconnect } from '../src/core/onlineSession';
import {
  Inventory,
  createItemStack,
  createPortalChestInventory,
  normalizePortalChestSlots,
  playerEquipmentFromInventory,
  type ItemStack,
  type PortalChestInventory,
} from '../src/inventory';
import { sameSharedContainerWindow, type InventoryWindow } from '../src/inventory/inventoryUiAction';
import { isKnownItemId, ItemId, readBookContent, sanitizeBookDraft, tryGetItemDefinition, writeBookInSlot } from '../src/items';
import { equippedArmorFromInventory, type PlayerPresentationState } from '../shared/playerPresentation';
import { PlayerController } from '../src/player';
import {
  DEFAULT_PLAYER_APPEARANCE,
  appearancesEqual,
  sanitizeRegisteredAppearance,
  toNetworkAppearance,
  type PlayerAppearance,
} from '../src/player/appearance/PlayerAppearance';
import {
  compareLatestInputCoalesce,
  compareLockstepModes,
  dumpControllerTicks,
  formatLatestInputCoalesce,
  formatPoseDump,
} from '../src/player/moveSimCompare';
import { SurvivalSystem, getArmorPoints } from '../src/survival';
import {
  listenerHearsWorldSound,
  worldSoundMaxDistance,
} from '../src/audio/worldSoundPlayback';
import { VoxelWorld } from '../src/world/World';
import { bedExitPosition, isBedRestValid, type BedRestState } from '../src/world/bed';
import { collectMinecartPassengers } from '../src/entities/minecartOccupancy';
import { EMPTY_SIGN_LINES, sanitizeSignLines } from '../src/world/sign';
import { consumeOffhandTotem } from '../src/gameplay/totemDeathProtection';
import { TOTEM_PRESENTATION_DISTANCE } from '../src/gameplay/totemBurst';
import { ANARCHY_IMPORT_VERSION, ANARCHY_SERVER_ID, ANARCHY_WORLD_ID } from '../src/world/import/anarchy';
import { estimateWorldSpawn, isGameMode } from '../src/world/spawn';
import type {
  AppliedInputTick,
  AppliedMovementStep,
  ClientHologramUpdateMessage,
  ClientInputMessage,
  ClientInventoryActionMessage,
  ClientAuctionActionMessage,
  ClientClanActionMessage,
  ClientBuyerActionMessage,
  ClientMenuActionMessage,
  ClientTradeActionMessage,
  GameMenuScreenKind,
  ClientBookUpdateMessage,
  ClientSignUpdateMessage,
  ClientVehicleInputMessage,
  GameMode,
  PlayerSnapshot,
  RemotePlayerInfo,
  WorldBlockStates,
  WorldModifications,
  ServerChatMessage,
} from '../shared/protocol';
import { MAX_CHAT_LENGTH } from '../shared/config';
import {
  CHAT_NO_CLAN_HINT,
  CHAT_TOO_LONG_ERROR,
  isWithinNearbyChatRange,
  type ChatChannel,
} from '../shared/chat';
import type { ActionResult, AttackAction, BlockTargetIntent, BowActionDiagnostics, BowReleaseAction } from '../shared/playerActions';
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
import { AutoMineManager } from './services/autoMine';
import { AuctionService, auctionPriceError, parseAuctionPrice, type AuctionView } from './services/auction';
import { ClanService, type ClanResult, type ClanView } from './services/clan';
import { BuyerService, type BuyerRecord } from './services/buyer';
import { EconomyService, formatMegacoinAmount, formatMegacoins } from './services/economy';
import { HomeService } from './services/home';
import { FriendsService } from './services/friends';
import { TradeService } from './services/trade';
import { NotificationService } from './services/notifications';
import {
  buildRankingSnapshot,
  buildTradeMessage,
  closedMenuMessage,
  createMenuSession,
  menuTitle,
  toMenuClaim,
  type GameMenuSession,
} from './services/gameMenu';
import { FRIENDS_MAX } from '../shared/friends';
import { HOME_MAX_DEFAULT, HOME_MAX_PREMIUM, HOME_MAX_VIP, HOME_MISSING_ERROR } from '../shared/homes';
import { GAME_MENU_MAX_CLAIMS } from '../shared/gameMenu';
import {
  applyGameMenuAction,
  type MenuActionHost,
  type MenuPlayer,
} from './services/gameMenuActions';
import { RtpService, RtpSessionManager } from './services/rtp';
import { TeleportHistoryService, TeleportService } from './services/teleport';
import { HologramNetwork, toNetworkHologram } from './services/holograms';
import { ClaimBoundaryNetwork } from './services/claimBoundaries';
import { migrateClaimStore, type Claim } from './services/claims';
import { ServerGameplay, type GameplayPlayer } from './gameplay';
import { clearMiningLock, shouldKeepMiningLock } from './miningLock';
import { formatGameplayKernelTrace, movementDuringItemUse, playerCanReachHologram } from '../src/gameplay';
import { isBuyerHologramName, playerCanReachBuyer } from '../shared/buyers';
import { FsWorldStore } from './FsWorldStore';
import type { WorldReadyState } from './persistence';
import type { SerializedPersistedPlayer, WorldSnapshot } from '../src/save/types';
import { WORLD_SCHEMA_VERSION } from '../src/save/types';
import { placeholderPlayer } from '../src/save/snapshot';
import { netDebug, serverLog } from './log';
import { logBreakAttempt } from './breakDiagnostics';
import { sessionTokenFingerprint } from '../shared/sessionFingerprint';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import {
  combatPoseForCommand,
  MAX_PENDING_BOW_ACTIONS,
  MAX_PENDING_BOW_TICKS,
  MAX_PENDING_MELEE_ACTIONS,
  MAX_PENDING_MELEE_TICKS,
  MAX_PVP_REWIND_TICKS,
  recordCombatPose,
  rewindCombatPose,
  type CombatPoseSample,
  type RewoundCombatPose,
} from './combatPoseHistory';

/** New terrain columns generated inside one `syncChunksFor`. Already-known columns still stream. */
const MAX_NEW_CHUNK_GENERATES_PER_SYNC = 2;

export interface ConnectedSink {
  send(payload: unknown): void;
}

export interface PendingMeleeAttack {
  readonly action: AttackAction;
  readonly receivedServerTick: number;
  readonly target?: {
    readonly playerId: string;
    readonly requestedRenderTick: number;
    readonly pose: RewoundCombatPose;
  };
}

export interface PendingBowRelease {
  readonly action: BowReleaseAction;
  readonly receivedServerTick: number;
  readonly validatedRenderTick?: number;
  readonly receiveRewindTicks?: number;
  /** Server-owned draw state at action receipt; covers release between input ticks. */
  readonly receivedBowState?: ReceivedBowReleaseState;
}

export interface ReceivedBowReleaseState {
  readonly selectedSlot: number;
  readonly itemId: string;
  readonly drawTicks: number;
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
  readonly combatPoseHistory: CombatPoseSample[] = [];
  readonly pendingAttacks: PendingMeleeAttack[] = [];
  readonly pendingBowReleases: PendingBowRelease[] = [];
  readonly bowReleaseCommandStates = new Map<number, ReceivedBowReleaseState>();
  bowReleaseBoundaryThisTick?: ReceivedBowReleaseState;
  appliedCommandBoundaryThisTick = false;
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
  restingBed?: BedRestState;
  miningTarget?: { x: number; y: number; z: number; blockId?: BlockId };
  private presentationSwingSeq = 0;
  private presentationHurtSeq = 0;
  miningProgress = 0;
  miningStartCommandSeq?: number;
  bowUseTicks = 0;
  foodUseTicks = 0;
  useStartCommandSeq: number | undefined;
  useSelectedSlot: number | undefined;
  useItemId: string | undefined;
  foodUseBoundaryCommandConfirmed: boolean | undefined;
  bowUseBoundaryCommandConfirmed: boolean | undefined;
  lastUse = false;
  lastSprint = false;
  vehicleForward = 0;
  inventoryDirty = false;
  totemActivated = false;
  pendingSignEdit?: { x: number; y: number; z: number };
  deathLootDropped = false;
  readonly portalChest: PortalChestInventory = createPortalChestInventory();
  healthSignature = '';
  effectSignature = '';
  appearance: PlayerAppearance = DEFAULT_PLAYER_APPEARANCE;
  /**
   * Interact/use can advertise a newer hotbar slot than the command snapshot
   * captured before the 1–9 key. Keep that slot when the matching command applies.
   */
  actionSelectedSlot?: { commandSeq: number; slot: number };

  constructor(
    readonly id: string,
    readonly sessionToken: string,
    public name: string,
    readonly controller: PlayerController,
    readonly inventory: Inventory,
    public gamemode: GameMode,
    public selectedSlot: number,
    survival?: SurvivalSystem,
    appearance?: PlayerAppearance,
  ) {
    this.survival = survival ?? new SurvivalSystem({ health: 20 });
    this.survival.setDeathProtection(() => {
      if (this.gamemode !== 'survival') return false;
      if (!consumeOffhandTotem(this.inventory)) return false;
      this.inventoryDirty = true;
      this.totemActivated = true;
      return true;
    });
    this.appearance = appearance ?? DEFAULT_PLAYER_APPEARANCE;
    this.survival.addDamageListener((result) => {
      if (result.fullHurt) this.presentHurt();
      if (result.armorWorn) this.inventoryDirty = true;
      if (this.survival.dead) this.restingBed = undefined;
    });
  }

  get health(): number {
    return this.survival.health;
  }

  /** Called only by authoritative gameplay outcomes; independent of actionSeq. */
  presentSwing(): void {
    if (this.connected && !this.survival.dead) this.presentationSwingSeq += 1;
  }

  /** Called from SurvivalSystem on authoritative fullHurt, including the killing blow. */
  presentHurt(): void {
    if (this.connected) this.presentationHurtSeq += 1;
  }

  presentation(): PlayerPresentationState {
    const alive = this.connected && !this.survival.dead;
    const heldItemId = this.inventory.getSlot(this.selectedSlot)?.itemId ?? null;
    const target = this.miningTarget;
    return {
      mining: alive && target?.blockId !== undefined && this.miningProgress < 1
        ? { ...target, blockId: target.blockId, progress: Math.max(0, this.miningProgress) }
        : null,
      heldItemId,
      offhandItemId: this.inventory.offhand?.itemId ?? null,
      bowCharge: alive && heldItemId === ItemId.Bow && this.bowUseTicks > 0
        ? this.combat.bowCharge(this.bowUseTicks).power : 0,
      foodUseProgress: alive && heldItemId && tryGetItemDefinition(heldItemId)?.kind === 'food'
        ? Math.min(1, Math.max(0, this.foodUseTicks / 32)) : 0,
      swordBlocking: alive && this.combat.swordBlocking,
      bedRest: alive ? this.restingBed ?? null : null,
      swingSeq: this.presentationSwingSeq,
      armor: equippedArmorFromInventory(this.inventory),
      hurtSeq: this.presentationHurtSeq,
    };
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
      presentation: this.presentation(),
      equipment: playerEquipmentFromInventory(this.inventory),
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
      presentation: snap.presentation,
      equipment: snap.equipment,
      appearance: toNetworkAppearance(this.appearance),
      health: snap.health,
      onFire: snap.onFire === true,
      ...(snap.dead ? { dead: true } : {}),
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
  readonly autoMine: AutoMineManager;
  readonly economy: EconomyService;
  readonly auction: AuctionService;
  readonly clan: ClanService;
  readonly buyer: BuyerService;
  readonly homes: HomeService;
  readonly friends: FriendsService;
  readonly trade: TradeService;
  readonly notifications: NotificationService;
  readonly holograms: HologramNetwork;
  readonly claimBoundaries: ClaimBoundaryNetwork;
  readonly selection = new PlayerSelectionService();
  private readonly menuSessions = new Map<string, GameMenuSession>();
  private readonly menuReturn = new Map<string, GameMenuScreenKind>();
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
    }, () => this.spawn, (x, y, z) => {
      for (const player of this.players.values()) {
        const target = player.miningTarget;
        if (target?.x === x && target.y === y && target.z === z) this.abortMining(player);
      }
    });
    this.gameplay.listPlayers = () => this.players.values();
    this.spawn = [0.5, 70, 0.5];
    this.dt = 1 / config.tickRate;
    this.worldView = this.createWorldView();
    this.pluginStore = new JsonFileStore(join(this.worldStore.directoryFor(config.worldId), 'plugin-data'));
    this.economy = new EconomyService(this.pluginStore);
    this.auction = new AuctionService(this.pluginStore, this.economy);
    this.clan = new ClanService(this.pluginStore, this.economy);
    this.homes = new HomeService(this.pluginStore);
    this.friends = new FriendsService(this.pluginStore);
    this.trade = new TradeService(this.economy);
    this.notifications = new NotificationService(this.pluginStore);
    const notifyUnread = (playerId: string, category: 'friends' | 'clans' | 'auction' | 'trade') => {
      this.notifyUnread(playerId, category);
    };
    this.auction.setRuntime({ notifyUnread });
    this.clan.setRuntime({
      onlinePlayers: () => this.connectedPlayers().map((player) => ({ id: player.id, name: player.name })),
      isOnline: (playerId) => this.players.get(playerId)?.connected === true,
      displayName: (playerId) => {
        const live = this.players.get(playerId);
        if (live) return live.name;
        const stored = this.storedPlayers[playerId];
        if (stored) return stored.name;
        return this.economy.displayName(playerId);
      },
      sendMessage: (playerId, text, extra) => {
        const target = this.players.get(playerId);
        if (!target?.connected) return;
        this.sendTo(target, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text,
          kind: 'system',
          ...(extra?.channel ? { channel: extra.channel } : {}),
          ...(extra?.style ? { style: extra.style } : {}),
        });
      },
      lookupPlayer: (idOrName) => this.findPlayerIdentity(idOrName),
      friendRelation: (viewerId, targetId) => this.friends.relation(viewerId, targetId),
      requestFriend: (fromId, targetId) => this.friends.request(fromId, targetId),
      cancelFriendRequest: (fromId, targetId) => this.friends.cancelOutgoing(fromId, targetId),
      notifyUnread,
      playerPosition: (playerId) => {
        const live = this.players.get(playerId);
        if (!live) return undefined;
        const pos = live.controller.position;
        return { x: pos.x, y: pos.y, z: pos.z };
      },
      worldId: () => this.worldId,
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      setBlock: (x, y, z, blockId) => this.worldView.setBlock(x, y, z, blockId),
      loadClaims: () => this.loadClaimStore(),
      saveClaims: (store) => this.saveClaimStore(store),
      teleportNow: (playerId, dest) => this.teleports.now(playerId, dest, 'clan', { silent: true }),
      showClaim: (playerId, claim) => this.claimBoundaries.show(playerId, claim),
    });
    this.friends.setRuntime({
      isOnline: (playerId) => this.players.get(playerId)?.connected === true,
      displayName: (playerId) => this.economy.displayName(playerId) === playerId.slice(0, 8)
        ? (this.players.get(playerId)?.name ?? this.storedPlayers[playerId]?.name ?? playerId.slice(0, 8))
        : this.economy.displayName(playerId),
      lookupPlayer: (idOrName) => this.findPlayerIdentity(idOrName),
      sendMessage: (playerId, text) => {
        const target = this.players.get(playerId);
        if (!target?.connected) return;
        this.sendTo(target, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text,
          kind: 'system',
        });
      },
      notifyUnread,
    });
    this.trade.setRuntime({
      isOnline: (playerId) => this.players.get(playerId)?.connected === true,
      displayName: (playerId) => this.players.get(playerId)?.name
        ?? this.storedPlayers[playerId]?.name
        ?? this.economy.displayName(playerId),
      lookupPlayer: (idOrName) => this.findPlayerIdentity(idOrName),
      inventory: (playerId) => this.players.get(playerId)?.inventory,
      balance: (playerId) => this.economy.getBalance(playerId),
      sendMessage: (playerId, text) => {
        const target = this.players.get(playerId);
        if (!target?.connected) return;
        this.sendTo(target, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text,
          kind: 'system',
        });
      },
      notifyUnread,
    });
    this.gameplay.loadRegularClaimVolumes = () => {
      const store = migrateClaimStore(this.pluginStore.load('claims/claims', { claims: [] }));
      return store.claims
        .filter((claim) => !claim.anchor && claim.worldId === this.worldId)
        .map((claim) => claim.volume);
    };
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
          yaw: player.controller.yaw,
          pitch: player.controller.pitch,
        }),
        teleport: (x, y, z, look) => {
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !isValidWorldY(Math.floor(y))) {
            return false;
          }
          player.restingBed = undefined;
          player.controller.teleport([x, y, z]);
          if (look?.yaw !== undefined && Number.isFinite(look.yaw)) player.controller.yaw = look.yaw;
          if (look?.pitch !== undefined && Number.isFinite(look.pitch)) player.controller.pitch = look.pitch;
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
    this.autoMine = new AutoMineManager({
      world: this.world,
      worldId: () => this.worldId,
      now: () => Date.now(),
      random: () => Math.random(),
      loadStore: () => this.pluginStore.load('automine/automines', { mines: [] }),
      saveStore: (store) => this.pluginStore.save('automine/automines', store),
      loadOriginals: (name) => this.pluginStore.load(`automine/originals/${name}`, undefined),
      saveOriginals: (name, blocks) => this.pluginStore.save(`automine/originals/${name}`, { blocks }),
      players: () => this.connectedPlayers().map((player) => ({
        id: player.id,
        position: () => ({
          x: player.controller.position.x,
          y: player.controller.position.y,
          z: player.controller.position.z,
        }),
        snapshot: () => ({ yaw: player.controller.yaw, pitch: player.controller.pitch }),
      })),
      teleport: (playerId, dest) => this.teleports.now(playerId, dest, 'automine', { silent: true }),
      send: (playerId, text) => {
        const player = this.players.get(playerId);
        if (!player) return;
        this.sendTo(player, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text,
          kind: 'system',
        });
      },
      notifyAdmins: (text) => {
        serverLog(`plugin automine ${text}`);
        for (const player of this.connectedPlayers()) {
          if (!this.permissions.has(player.name, 'automine.manage') && !this.permissions.isOperator(player.name)) {
            continue;
          }
          this.sendTo(player, {
            type: 'chat',
            from: 'server',
            playerId: 'server',
            text,
            kind: 'system',
          });
        }
      },
      log: (message) => serverLog(`plugin automine ${message}`),
      onBlocksWritten: (cells) => this.economy.clearPlacedCells(cells),
    });
    this.holograms = new HologramNetwork((list) => {
      this.broadcast({ type: 'holograms', holograms: [...list] });
    });
    this.buyer = new BuyerService(this.pluginStore, this.economy, this.holograms, () => this.worldId);
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
        signs: existing.signs,
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
      this.economy.load();
      this.auction.load();
      this.clan.load();
      this.homes.load();
      this.friends.load();
      this.notifications.load();
      this.buyer.load();
      this.preloadSpawnChunks();
      this.readyState = 'READY';
      serverLog(`world loaded: ${this.worldId} from ${this.worldStore.directoryFor(this.worldId)}`);
      return;
    }
    this.spawn = estimateWorldSpawn(this.world);
    this.createdAt = Date.now();
    this.permissions.load();
    this.economy.load();
    this.auction.load();
    this.clan.load();
    this.homes.load();
    this.friends.load();
    this.notifications.load();
    this.buyer.load();
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
        autoMine: this.autoMine,
        economy: this.economy,
        auction: this.auction,
        clan: this.clan,
        buyer: this.buyer,
        homes: this.homes,
        friends: this.friends,
        trade: this.trade,
        openAuction: (playerId, view) => this.openAuction(playerId, view),
        openClan: (playerId, view, extra) => this.openClan(playerId, view, extra),
        openBuyerAdmin: (playerId, buyerId) => this.openBuyerAdmin(playerId, buyerId),
        openGameMenu: (playerId, screen) => this.openGameMenu(playerId, (screen as GameMenuScreenKind | undefined) ?? 'root'),
        broadcastBuyers: () => this.broadcastBuyers(),
        lookupPlayer: (idOrName) => this.findPlayerIdentity(idOrName),
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
      worldgenVersion: WORLDGEN_VERSION,
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
    this.economy.persist();
    this.auction.persist();
    this.clan.persist();
    this.notifications.persist();
    this.buyer.persist();
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

  private listTradeNearby(player: ServerPlayer): Array<{ playerId: string; name: string; distance: number }> {
    const origin = player.controller.position;
    return this.connectedPlayers()
      .filter((other) => other.id !== player.id)
      .map((other) => {
        const pos = other.controller.position;
        const dx = origin.x - pos.x;
        const dy = origin.y - pos.y;
        const dz = origin.z - pos.z;
        return {
          playerId: other.id,
          name: other.name,
          distance: Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz)),
          inRange: isWithinNearbyChatRange(origin.x, origin.y, origin.z, pos.x, pos.y, pos.z),
        };
      })
      .filter((row) => row.inRange)
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'ru'))
      .map(({ playerId, name, distance }) => ({ playerId, name, distance }));
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
    appearance?: PlayerAppearance;
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
        const joinedAppearance = sanitizeRegisteredAppearance(options.appearance);
        if (joinedAppearance) existing.appearance = joinedAppearance;
        this.resetConnectionInput(existing);
        const fp = sessionTokenFingerprint(existing.sessionToken);
        serverLog(
          `player joined: ${existing.name} (${existing.id}, resume) `
          + `conn=${existing.connectionId.slice(0, 8)} prev=${previousConnectionId.slice(0, 8)} fp=${fp} `
          + `resumeCount=${existing.resumeCount}`,
        );
        this.events.emit('playerJoin', { playerId: existing.id, name: existing.name });
        this.buyer.restoreOverflow(existing.id, existing.inventory);
        return { player: existing, resumed: true, previousConnectionId };
      }
      const stored = existingId ? this.storedPlayers[existingId] : undefined;
      if (stored) {
        const restored = this.materializeStoredPlayer(stored, options.sink, options.name);
        const joinedAppearance = sanitizeRegisteredAppearance(options.appearance);
        if (joinedAppearance) restored.appearance = joinedAppearance;
        restored.joinCount += 1;
        restored.resumeCount += 1;
        serverLog(
          `player joined: ${restored.name} (${restored.id}, resume) `
          + `conn=${restored.connectionId.slice(0, 8)} fp=${sessionTokenFingerprint(restored.sessionToken)}`,
        );
        this.events.emit('playerJoin', { playerId: restored.id, name: restored.name });
        this.buyer.restoreOverflow(restored.id, restored.inventory);
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
      undefined,
      sanitizeRegisteredAppearance(options.appearance) ?? DEFAULT_PLAYER_APPEARANCE,
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
    this.buyer.restoreOverflow(player.id, player.inventory);
    this.dirty = true;
    return { player, resumed: false };
  }

  findPlayerIdentity(idOrName: string): { id: string; name: string; connected: boolean } | undefined {
    const direct = this.players.get(idOrName);
    if (direct) return { id: direct.id, name: direct.name, connected: direct.connected };
    const lower = idOrName.toLowerCase();
    for (const player of this.players.values()) {
      if (player.name.toLowerCase() === lower) {
        return { id: player.id, name: player.name, connected: player.connected };
      }
    }
    const storedDirect = this.storedPlayers[idOrName];
    if (storedDirect) return { id: storedDirect.id, name: storedDirect.name, connected: false };
    for (const stored of Object.values(this.storedPlayers)) {
      if (stored.name.toLowerCase() === lower) {
        return { id: stored.id, name: stored.name, connected: false };
      }
    }
    return undefined;
  }

  openAuction(playerId: string, view: AuctionView): void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;
    if (view === 'browse') this.auction.openBrowse(playerId);
    else if (view === 'sell') this.auction.openSell(playerId);
    else this.auction.openMine(playerId);
    this.flushAuction(player);
  }

  handleAuctionAction(player: ServerPlayer, message: ClientAuctionActionMessage): void {
    if (!this.hasAuctionPermission(player, message.action)) {
      this.sendTo(player, {
        type: 'auction',
        screen: 'closed',
        title: '',
        search: '',
        page: 1,
        totalPages: 1,
        totalCount: 0,
        listings: [],
        message: 'You do not have permission.',
      });
      return;
    }
    this.auction.expireDue();
    const session = this.auction.session(player.id);
    session.message = undefined;
    const action = message.action;
    if (action === 'close') {
      this.auction.closeSession(player.id);
      this.menuReturn.delete(player.id);
      this.flushAuction(player);
      return;
    }
    if (action === 'search') {
      this.auction.setSearch(player.id, message.search ?? '');
      this.flushAuction(player);
      return;
    }
    if (action === 'page') {
      this.auction.setPage(player.id, message.page ?? session.page);
      this.flushAuction(player);
      return;
    }
    if (action === 'refresh') {
      session.message = undefined;
      this.flushAuction(player);
      return;
    }
    if (action === 'back') {
      if (session.screen === 'buy') this.auction.openBrowse(player.id, session.search);
      else if (session.screen === 'sell-confirm') this.auction.openSell(player.id);
      else if (session.screen === 'manage' || session.screen === 'claim' || session.screen === 'relist') {
        this.auction.openMine(player.id);
      } else {
        this.auction.closeSession(player.id);
      }
      if (this.auction.session(player.id).screen === 'closed') {
        this.tryRestoreMenu(player);
        if (this.menuSessions.has(player.id)) return;
      }
      this.flushAuction(player);
      return;
    }
    if (action === 'select' && message.listingId) {
      const listing = this.auction.getListing(message.listingId);
      const fromMine = session.screen === 'mine'
        || session.screen === 'manage'
        || session.screen === 'claim'
        || session.screen === 'relist';
      if (!listing) {
        if (fromMine) this.auction.openMine(player.id);
        else this.auction.openBrowse(player.id, session.search);
        this.auction.session(player.id).message = 'Этот товар уже продан.';
        this.flushAuction(player);
        return;
      }
      if (fromMine) {
        session.listingId = listing.listingId;
        session.screen = listing.status === 'ACTIVE' ? 'manage' : 'claim';
        session.priceText = String(listing.price);
      } else if (listing.sellerPlayerId === player.id) {
        session.message = 'Нельзя купить собственный товар.';
        this.flushAuction(player);
        return;
      } else {
        session.listingId = listing.listingId;
        session.screen = 'buy';
      }
      this.flushAuction(player);
      return;
    }
    if (action === 'buy' && (message.listingId || session.listingId)) {
      const listingId = message.listingId ?? session.listingId!;
      const result = this.auction.buyListing(player.id, player.name, player.inventory, listingId);
      if (!result.ok) {
        session.message = result.error;
        if (result.error === 'Этот товар уже продан.' || result.error === 'Срок продажи этого товара истёк.') {
          session.screen = 'browse';
          session.listingId = undefined;
        }
        this.flushAuction(player);
        return;
      }
      player.inventoryDirty = true;
      this.flushPlayerInventory(player);
      const search = session.search;
      const page = session.page;
      this.auction.openBrowse(player.id, search);
      this.auction.session(player.id).page = page;
      const seller = this.players.get(result.listing!.sellerPlayerId);
      if (seller?.connected) {
        this.sendTo(seller, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text: `${player.name} купил ваш лот за ${formatMegacoins(result.listing!.price)}.`,
          kind: 'system',
        });
      }
      this.flushAuction(player);
      return;
    }
    if (action === 'select_slot' && message.slot !== undefined) {
      const result = this.auction.selectSellSlot(player.id, player.inventory, message.slot);
      if (!result.ok) this.auction.session(player.id).message = result.error;
      this.flushAuction(player);
      return;
    }
    if (action === 'set_amount' && message.amount !== undefined) {
      const current = session.slot !== undefined ? player.inventory.getSlot(session.slot) : undefined;
      const max = current?.count ?? session.expectedItem?.count ?? 1;
      session.amount = Math.max(1, Math.min(message.amount, max));
      this.flushAuction(player);
      return;
    }
    if (action === 'set_price') {
      session.priceText = typeof message.price === 'string' || typeof message.price === 'number'
        ? String(message.price)
        : '';
      return;
    }
    if (action === 'create') {
      const amount = message.amount ?? session.amount;
      const slot = message.slot ?? session.slot;
      const priceRaw = message.price ?? session.priceText;
      const priceError = auctionPriceError(priceRaw);
      if (slot === undefined || amount === undefined) {
        session.message = 'Предмет больше недоступен для продажи.';
        this.flushAuction(player);
        return;
      }
      if (priceError) {
        session.message = priceError;
        this.flushAuction(player);
        return;
      }
      const parsedPrice = parseAuctionPrice(priceRaw)!;
      const result = this.auction.createListing(
        player.id,
        player.name,
        player.inventory,
        slot,
        amount,
        parsedPrice,
        session.expectedItem,
      );
      if (!result.ok) {
        session.message = result.error;
        this.flushAuction(player);
        return;
      }
      player.inventoryDirty = true;
      this.flushPlayerInventory(player);
      this.auction.openSell(player.id);
      this.auction.session(player.id).message = 'Товар выставлен на аукцион.';
      this.flushAuction(player);
      return;
    }
    if (action === 'cancel' && (message.listingId || session.listingId)) {
      const result = this.auction.cancelListing(player.id, message.listingId ?? session.listingId!);
      this.auction.openMine(player.id);
      this.auction.session(player.id).message = result.ok
        ? 'Товар снят с продажи. Заберите его в списке лотов.'
        : result.error;
      this.flushAuction(player);
      return;
    }
    if (action === 'relist' && (message.listingId || session.listingId)) {
      const listingId = message.listingId ?? session.listingId!;
      if (session.screen !== 'relist' && !message.price) {
        const listing = this.auction.getListing(listingId);
        if (!listing || listing.sellerPlayerId !== player.id || listing.status !== 'ACTIVE') {
          session.message = 'Этот товар уже продан.';
          this.auction.openMine(player.id);
          this.flushAuction(player);
          return;
        }
        session.listingId = listingId;
        session.screen = 'relist';
        session.priceText = String(listing.price);
        this.flushAuction(player);
        return;
      }
      const priceError = auctionPriceError(message.price ?? session.priceText);
      if (priceError) {
        session.message = priceError;
        this.flushAuction(player);
        return;
      }
      const parsedPrice = parseAuctionPrice(message.price ?? session.priceText)!;
      const result = this.auction.relist(
        player.id,
        listingId,
        parsedPrice,
      );
      if (!result.ok) {
        session.message = result.error;
        this.flushAuction(player);
        return;
      }
      this.auction.openMine(player.id);
      this.auction.session(player.id).message = 'Товар выставлен заново.';
      this.flushAuction(player);
      return;
    }
    if (action === 'claim' && (message.listingId || session.listingId)) {
      const result = this.auction.claimListing(
        player.id,
        player.inventory,
        message.listingId ?? session.listingId!,
      );
      if (!result.ok) {
        session.message = result.error;
        this.flushAuction(player);
        return;
      }
      player.inventoryDirty = true;
      this.flushPlayerInventory(player);
      this.auction.openMine(player.id);
      this.auction.session(player.id).message = 'Предмет возвращён в инвентарь.';
      this.flushAuction(player);
      return;
    }
    this.flushAuction(player);
  }

  private hasAuctionPermission(player: ServerPlayer, action: ClientAuctionActionMessage['action']): boolean {
    const node = action === 'buy' || action === 'select' ? 'auction.buy'
      : action === 'select_slot' || action === 'set_amount' || action === 'set_price' || action === 'create'
        ? 'auction.sell'
        : action === 'cancel' || action === 'relist' || action === 'claim' ? 'auction.list'
          : 'auction.use';
    return this.permissions.has(player.id, node) || this.permissions.has(player.name, node);
  }

  private flushAuction(player: ServerPlayer): void {
    this.sendTo(player, this.auction.buildMessage(player.id, player.inventory));
  }

  openClan(playerId: string, view: ClanView, extra?: string): ClanResult | void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return { ok: false, error: 'Игрок не в сети.' };
    this.economy.rememberName(player.id, player.name);
    this.clan.purgeExpired();
    let result: ClanResult = { ok: true };
    if (view === 'ranking') this.clan.openRanking(playerId);
    else if (view === 'create') result = this.clan.openCreate(playerId);
    else if (view === 'delete') result = this.clan.openDelete(playerId);
    else if (view === 'add') result = this.clan.openAdd(playerId);
    else if (view === 'accept') result = this.clan.openAccept(playerId, {
      allowInClan: this.clan.session(playerId).openedFromMenu === true,
    });
    else if (view === 'leave') result = this.clan.openLeave(playerId);
    else if (view === 'makeleader') result = this.clan.openMakeLeader(playerId);
    else if (view === 'mine') result = this.clan.openMyClan(playerId);
    else result = this.clan.openKick(playerId, extra ?? '');
    if (!result.ok) return result;
    this.flushClan(player);
    return result;
  }

  handleClanAction(player: ServerPlayer, message: ClientClanActionMessage): void {
    if (!this.hasClanPermission(player, message.action)) {
      const session = this.clan.session(player.id);
      if (session.screen !== 'closed') {
        session.message = 'You do not have permission.';
        this.flushClan(player);
        return;
      }
      this.sendTo(player, {
        type: 'clan',
        screen: 'closed',
        title: '',
        search: '',
        page: 1,
        totalPages: 1,
        totalCount: 0,
        clans: [],
        message: 'You do not have permission.',
      });
      return;
    }
    this.economy.rememberName(player.id, player.name);
    const beforeIds = new Set(this.clan.playerClan(player.id)?.memberIds ?? []);
    const isClose = message.action === 'close';
    this.clan.handleAction(player.id, message);
    if (isClose) this.menuReturn.delete(player.id);
    const afterIds = new Set(this.clan.playerClan(player.id)?.memberIds ?? []);
    const notify = new Set<string>([...beforeIds, ...afterIds, player.id]);
    const restoring = !isClose && this.clan.session(player.id).screen === 'closed' && this.menuReturn.has(player.id);
    for (const playerId of notify) {
      if (restoring && playerId === player.id) continue;
      const other = this.players.get(playerId);
      if (other?.connected) this.flushClan(other);
    }
    if (restoring) this.tryRestoreMenu(player);
  }

  private hasClanPermission(player: ServerPlayer, action: ClientClanActionMessage['action']): boolean {
    const node = action === 'confirm_create' || action === 'create' || action === 'select_icon' || action === 'set_name' || action === 'cancel_create'
      ? 'clan.create'
      : action === 'confirm_delete' || action === 'cancel_delete'
        ? 'clan.delete'
        : action === 'select_player' || action === 'confirm_invite' || action === 'cancel_invite'
          || action === 'set_invite_name' || action === 'invite_by_name'
          ? 'clan.add'
          : action === 'select_invitation' || action === 'confirm_accept' || action === 'cancel_accept'
            || action === 'reject_invitation'
            ? 'clan.accept'
            : action === 'confirm_leave' || action === 'cancel_leave'
              ? 'clan.leave'
              : action === 'confirm_makeleader' || action === 'cancel_makeleader'
                || action === 'promote_veteran' || action === 'demote_veteran'
                || action === 'transfer_leader' || action === 'confirm_transfer_leader' || action === 'cancel_transfer_leader'
                ? 'clan.makeleader'
                : action === 'kick' || action === 'confirm_kick' || action === 'cancel_kick'
                  ? 'clan.kick'
                  : action === 'open_requests' || action === 'select_request' || action === 'confirm_accept_request' || action === 'cancel_accept_request'
                    ? 'clan.add'
                    : 'clan.use';
    return this.permissions.has(player.id, node) || this.permissions.has(player.name, node);
  }

  private flushClan(player: ServerPlayer): void {
    this.sendTo(player, this.clan.buildMessage(player.id));
  }

  broadcastBuyers(): void {
    this.broadcast({ type: 'buyers', buyers: this.buyer.networkBuyers() });
    this.flushAffectedBuyers();
  }

  private flushAffectedBuyers(): void {
    for (const playerId of this.buyer.takeAffectedPlayers()) {
      const player = this.players.get(playerId);
      if (!player?.connected) continue;
      this.buyer.restoreOverflow(player.id, player.inventory);
      this.flushPlayerInventory(player);
      this.flushBuyer(player);
    }
  }

  openBuyerAdmin(playerId: string, buyerId: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;
    if (!this.hasBuyerPermission(player, 'buyer.edit')) return;
    this.buyer.openAdmin(playerId, buyerId, player.inventory);
    this.flushBuyer(player);
  }

  interactBuyer(player: ServerPlayer, buyerId: string): void {
    const buyer = this.buyer.get(buyerId) ?? this.buyer.findByHologram(buyerId);
    if (!buyer) return;
    const eye = player.controller.eyePosition();
    if (!playerCanReachBuyer(eye, buyer, PLAYER_NET_REACH)) return;
    const canEdit = this.hasBuyerPermission(player, 'buyer.edit');
    const canUse = this.hasBuyerPermission(player, 'buyer.use');
    if (canEdit) {
      this.buyer.openAdmin(player.id, buyer.id, player.inventory);
      this.flushBuyer(player);
      return;
    }
    if (!canUse) {
      this.sendTo(player, {
        type: 'chat',
        from: 'server',
        playerId: 'server',
        text: 'You do not have permission.',
        kind: 'error',
      });
      return;
    }
    this.buyer.openTrade(player.id, buyer.id, player.inventory);
    this.flushBuyer(player);
  }

  handleBuyerAction(player: ServerPlayer, message: ClientBuyerActionMessage): void {
    const can = {
      edit: this.hasBuyerPermission(player, 'buyer.edit'),
      delete: this.hasBuyerPermission(player, 'buyer.delete'),
      use: this.hasBuyerPermission(player, 'buyer.use'),
    };
    if (message.action !== 'close' && !can.use && !can.edit) {
      this.sendTo(player, {
        type: 'buyer',
        screen: 'closed',
        title: '',
        buyerId: '',
        name: '',
        hologramText: '',
        priceText: '',
        quantity: 0,
        maxQuantity: 0,
        total: 0,
        totalLabel: '',
        configured: false,
        message: 'You do not have permission.',
      });
      return;
    }
    const result = this.buyer.handleAction(player.id, player.inventory, message, can);
    if (result.inventoryDirty) this.flushPlayerInventory(player);
    if (result.broadcast) this.broadcastBuyers();
    if (result.chat) {
      this.sendTo(player, {
        type: 'chat',
        from: 'server',
        playerId: 'server',
        text: result.chat,
        kind: 'system',
      });
    }
    if (result.openHologramEditor && result.buyer) {
      this.openBuyerHologramEditor(player, result.buyer.hologramName);
      return;
    }
    this.flushBuyer(player);
  }

  private openBuyerHologramEditor(player: ServerPlayer, hologramName: string): void {
    const hologram = this.holograms.get(hologramName);
    const owner = this.buyer.findByHologram(hologramName);
    if (!hologram || !hologram.enabled || !owner) {
      this.flushBuyer(player);
      return;
    }
    if (!this.hasBuyerPermission(player, 'buyer.edit')) {
      this.sendHologramPermissionDenied(player);
      this.flushBuyer(player);
      return;
    }
    this.sendTo(player, { type: 'hologram_editor', hologram: toNetworkHologram(hologram) });
  }

  private hasBuyerPermission(player: ServerPlayer, node: string): boolean {
    return this.permissions.has(player.id, node) || this.permissions.has(player.name, node);
  }

  private flushBuyer(player: ServerPlayer): void {
    this.sendTo(player, this.buyer.buildMessage(player.id, player.inventory));
  }

  openGameMenu(playerId: string, screen: GameMenuScreenKind = 'root'): void {
    const player = this.players.get(playerId);
    if (!player?.connected) return;
    const session = this.menuSessions.get(playerId) ?? createMenuSession();
    session.screen = screen === 'closed' ? 'root' : screen;
    session.message = undefined;
    this.menuSessions.set(playerId, session);
    this.flushMenu(player);
  }

  handleMenuAction(player: ServerPlayer, message: ClientMenuActionMessage): void {
    this.economy.rememberName(player.id, player.name);
    if (message.action === 'close') {
      this.menuSessions.delete(player.id);
      this.menuReturn.delete(player.id);
      this.sendTo(player, closedMenuMessage());
      return;
    }
    const session = this.menuSessions.get(player.id) ?? createMenuSession();
    this.menuSessions.set(player.id, session);
    session.message = undefined;
    this.applyMenuOutcome(player, session, applyGameMenuAction(this.menuHost(), this.menuPlayer(player), session, message));
  }

  handleTradeAction(player: ServerPlayer, message: ClientTradeActionMessage): void {
    if (message.action === 'close' || message.action === 'cancel') {
      const result = this.trade.cancel(player.id);
      this.flushTradeResult(result);
      return;
    }
    const result = message.action === 'put_item'
      ? this.trade.putItem(player.id, message.slot ?? -1, message.tradeSlot)
      : message.action === 'return_item'
        ? this.trade.returnItem(player.id, message.tradeSlot ?? -1)
        : message.action === 'set_money'
          ? this.trade.setMoney(player.id, message.money ?? 0)
          : message.action === 'ready'
            ? this.trade.ready(player.id)
            : this.trade.accept(player.id);
    this.flushTradeResult(result, result.ok ? undefined : result.error);
  }

  private menuPlayer(player: ServerPlayer): MenuPlayer {
    return {
      id: player.id,
      name: player.name,
      x: player.controller.position.x,
      y: player.controller.position.y,
      z: player.controller.position.z,
      yaw: player.controller.yaw,
      pitch: player.controller.pitch,
    };
  }

  private menuHost(): MenuActionHost {
    return {
      homes: this.homes,
      friends: this.friends,
      trade: this.trade,
      clan: this.clan,
      notifications: this.notifications,
      worldId: this.worldId,
      maxHomesFor: (entry) => {
        const live = this.players.get(entry.id);
        return live ? this.maxHomesFor(live) : HOME_MAX_DEFAULT;
      },
      loadClaims: () => this.loadClaimStore(),
      saveClaims: (store) => this.saveClaimStore(store),
      findOwnedClaim: (entry, claimId) => {
        const live = this.players.get(entry.id);
        return live ? this.findOwnedClaim(live, claimId) : undefined;
      },
    };
  }

  private applyMenuOutcome(
    player: ServerPlayer,
    session: GameMenuSession,
    outcome: ReturnType<typeof applyGameMenuAction>,
  ): void {
    if (outcome.kind === 'flush') {
      this.flushMenu(player);
      return;
    }
    if (outcome.kind === 'close') {
      this.menuSessions.delete(player.id);
      this.sendTo(player, closedMenuMessage());
      return;
    }
    if (outcome.kind === 'spawn') {
      const spawn = this.worldView.spawn();
      const result = this.teleports.schedule(player.id, { x: spawn[0], y: spawn[1], z: spawn[2] }, 'spawn', {
        warmupMs: Number(this.pluginConfig.get('spawn', 'warmupSeconds', 0)) * 1000,
        cooldownMs: Number(this.pluginConfig.get('spawn', 'cooldownSeconds', 5)) * 1000,
        cancelOnMove: Boolean(this.pluginConfig.get('spawn', 'cancelOnMove', true)),
        cancelOnDamage: Boolean(this.pluginConfig.get('spawn', 'cancelOnDamage', true)),
      });
      if (!result.ok) {
        session.message = result.error ?? 'Teleport failed.';
        this.flushMenu(player);
        return;
      }
      this.menuSessions.delete(player.id);
      this.sendTo(player, closedMenuMessage());
      return;
    }
    if (outcome.kind === 'home-teleport') {
      const dest = this.homes.get(player.name, outcome.name);
      if (!dest) {
        session.message = HOME_MISSING_ERROR;
        this.flushMenu(player);
        return;
      }
      const result = this.teleports.schedule(player.id, {
        x: dest.x, y: dest.y, z: dest.z, yaw: dest.yaw, pitch: dest.pitch,
      }, 'home', {
        warmupMs: Number(this.pluginConfig.get('home', 'warmupSeconds', 0)) * 1000,
        cooldownMs: Number(this.pluginConfig.get('home', 'cooldownSeconds', 5)) * 1000,
        cancelOnMove: Boolean(this.pluginConfig.get('home', 'cancelOnMove', true)),
        cancelOnDamage: Boolean(this.pluginConfig.get('home', 'cancelOnDamage', true)),
      });
      if (!result.ok) {
        session.message = result.error ?? 'Teleport failed.';
        this.flushMenu(player);
        return;
      }
      this.menuSessions.delete(player.id);
      this.sendTo(player, closedMenuMessage());
      return;
    }
    if (outcome.kind === 'friend-teleport') {
      const target = this.players.get(outcome.playerId);
      if (!target?.connected) {
        session.message = 'Игрок не в сети.';
        this.flushMenu(player);
        return;
      }
      const result = this.teleports.schedule(player.id, {
        x: target.controller.position.x,
        y: target.controller.position.y,
        z: target.controller.position.z,
        yaw: target.controller.yaw,
        pitch: target.controller.pitch,
      }, 'friends', { warmupMs: 0, cooldownMs: 0, cancelOnMove: false, cancelOnDamage: false });
      if (!result.ok) {
        session.message = result.error ?? 'Teleport failed.';
        this.flushMenu(player);
        return;
      }
      this.menuSessions.delete(player.id);
      this.sendTo(player, closedMenuMessage());
      return;
    }
    if (outcome.kind === 'open-clan') {
      this.clan.markOpenedFromMenu(player.id, outcome.view);
      const result = this.openClan(player.id, outcome.view);
      if (!result || result.ok === false) {
        const clanSession = this.clan.session(player.id);
        clanSession.openedFromMenu = undefined;
        clanSession.menuEntry = undefined;
        session.message = result && 'error' in result ? (result.error ?? 'Не удалось открыть клан.') : 'Не удалось открыть клан.';
        this.flushMenu(player);
        return;
      }
      this.menuReturn.set(player.id, 'clans');
      this.menuSessions.delete(player.id);
      return;
    }
    if (outcome.kind === 'open-auction') {
      this.menuReturn.set(player.id, 'auction');
      this.menuSessions.delete(player.id);
      this.openAuction(player.id, outcome.view);
      this.auction.markOpenedFromMenu(player.id);
      this.flushAuction(player);
      return;
    }
    if (outcome.kind === 'trade-session') {
      this.menuSessions.delete(player.id);
      this.flushActiveTrades(outcome.affected);
      return;
    }
    if (outcome.kind === 'refresh-players') {
      this.flushMenuPlayers([...new Set([player.id, ...outcome.affected])]);
      return;
    }
    this.flushMenuPlayers(outcome.affected);
    this.flushActiveTrades(outcome.affected);
  }

  private tryRestoreMenu(player: ServerPlayer): void {
    const screen = this.menuReturn.get(player.id);
    if (!screen) return;
    this.menuReturn.delete(player.id);
    this.openGameMenu(player.id, screen);
  }

  private maxHomesFor(player: ServerPlayer): number {
    const def = Number(this.pluginConfig.get('home', 'maxHomesDefault', HOME_MAX_DEFAULT));
    const vip = Number(this.pluginConfig.get('home', 'maxHomesVip', HOME_MAX_VIP));
    const premium = Number(this.pluginConfig.get('home', 'maxHomesPremium', HOME_MAX_PREMIUM));
    if (this.permissions.isOperator(player.id) || this.permissions.has(player.id, 'home.*')) {
      return Math.max(premium, vip, def);
    }
    let max = def;
    if (this.permissions.has(player.id, 'home.multiple') || this.permissions.has(player.name, 'home.multiple')) {
      max = Math.max(max, vip);
    }
    if (this.permissions.has(player.id, 'home.limit.premium') || this.permissions.has(player.name, 'home.limit.premium')) {
      max = Math.max(max, premium);
    }
    return max;
  }

  private loadClaimStore() {
    return migrateClaimStore(this.pluginStore.load('claims/claims', { claims: [] }));
  }

  private saveClaimStore(store: ReturnType<WorldInstance['loadClaimStore']>): void {
    this.pluginStore.save('claims/claims', store);
    this.dirty = true;
  }

  private findOwnedClaim(player: ServerPlayer, claimId: string) {
    const key = player.name.toLowerCase();
    return this.loadClaimStore().claims.find((claim) => claim.id === claimId && (
      claim.owner === key || this.permissions.has(player.id, 'claim.admin') || this.permissions.isOperator(player.id)
    ));
  }

  private flushMenu(player: ServerPlayer): void {
    this.sendTo(player, this.buildMenuMessage(player));
  }

  private flushMenuPlayers(ids: readonly string[]): void {
    for (const id of ids) {
      const other = this.players.get(id);
      if (other?.connected && this.menuSessions.has(id)) this.flushMenu(other);
    }
  }

  private flushActiveTrades(ids: readonly string[]): void {
    for (const id of ids) {
      const other = this.players.get(id);
      if (!other?.connected) continue;
      if (this.trade.sessionFor(id)) {
        this.menuSessions.delete(id);
        this.flushTrade(other);
      } else if (this.menuSessions.has(id)) {
        this.flushMenu(other);
      }
    }
  }

  private flushTradeResult(result: { affected?: readonly string[]; closed?: boolean }, error?: string): void {
    for (const id of result.affected ?? []) {
      const other = this.players.get(id);
      if (!other?.connected) continue;
      this.flushPlayerInventory(other);
      this.flushTrade(other, error ? { message: error } : undefined);
    }
  }

  private flushTrade(player: ServerPlayer, extra?: { message?: string }): void {
    const session = this.trade.sessionFor(player.id);
    const payload = buildTradeMessage(this.trade, player.id, player.inventory.slots, extra);
    if (session) {
      const partnerId = session.playerA === player.id ? session.playerB : session.playerA;
      this.sendTo(player, {
        ...payload,
        partnerName: this.players.get(partnerId)?.name
          ?? this.storedPlayers[partnerId]?.name
          ?? this.economy.displayName(partnerId),
        balance: this.economy.getBalance(player.id),
      });
      return;
    }
    this.sendTo(player, payload);
  }

  private buildMenuMessage(player: ServerPlayer): import('../shared/protocol').ServerMenuMessage {
    const session = this.menuSessions.get(player.id);
    if (!session || session.screen === 'closed') return closedMenuMessage();
    const inClan = Boolean(this.clan.playerClan(player.id));
    const balance = this.economy.getBalance(player.id);
    const notifications = this.notifications.counts(player.id);
    const base = {
      type: 'menu' as const,
      screen: session.screen as GameMenuScreenKind,
      title: menuTitle(session.screen as GameMenuScreenKind),
      balance,
      balanceLabel: formatMegacoinAmount(balance),
      inClan,
      notifications,
      ...(session.message ? { message: session.message } : {}),
    };
    if (session.screen === 'homes' || session.screen === 'home-delete-confirm') {
      const homes = this.homes.list(player.name);
      return {
        ...base,
        homeNameText: session.homeNameText,
        homes: homes.map((home) => ({ name: home.name, x: home.x, y: home.y, z: home.z })),
        homeCount: homes.length,
        homeMax: this.maxHomesFor(player),
        ...(session.pendingHomeName ? { pendingHomeName: session.pendingHomeName } : {}),
      };
    }
    if (session.screen === 'friends' || session.screen === 'friend-delete-confirm') {
      const state = this.friends.state(player.id);
      const friends = this.friends.sortedFriends(player.id);
      const requests = this.friends.incomingRequests(player.id).map((request) => ({
        playerId: request.fromPlayerId,
        name: this.players.get(request.fromPlayerId)?.name
          ?? this.storedPlayers[request.fromPlayerId]?.name
          ?? this.economy.displayName(request.fromPlayerId),
        online: this.players.get(request.fromPlayerId)?.connected === true,
        canTeleport: false,
        requestId: request.requestId,
      }));
      return {
        ...base,
        allowFriendTeleport: state.allowFriendTeleport,
        friendNameText: session.friendNameText,
        friendRequests: requests,
        friends,
        friendCount: friends.length,
        friendMax: FRIENDS_MAX,
        ...(session.pendingFriendId ? {
          pendingFriendId: session.pendingFriendId,
          pendingFriendName: session.pendingFriendName,
        } : {}),
      };
    }
    if (session.screen === 'claims' || session.screen === 'claim-settings' || session.screen === 'claim-delete-confirm') {
      const owner = player.name.toLowerCase();
      const mine = this.loadClaimStore().claims.filter((claim) => claim.owner === owner);
      const selected = session.claimId ? mine.find((claim) => claim.id === session.claimId) : undefined;
      return {
        ...base,
        claims: mine.map(toMenuClaim),
        claimCount: mine.length,
        claimMax: GAME_MENU_MAX_CLAIMS,
        ...(selected ? {
          claimId: selected.id,
          claimNameText: session.claimNameText,
          claimPvp: selected.flags.pvp === true,
          claimMembers: selected.members.map((name) => ({ name })),
          claimMemberText: session.claimMemberText,
        } : {}),
        ...(session.pendingClaimName ? { pendingClaimName: session.pendingClaimName } : {}),
      };
    }
    if (session.screen === 'trade') {
      return {
        ...base,
        tradeNameText: session.tradeNameText,
        tradeNearby: this.listTradeNearby(player),
        tradeIncoming: this.trade.incomingRequests(player.id).map((request) => ({
          playerId: request.fromPlayerId,
          name: this.players.get(request.fromPlayerId)?.name
            ?? this.storedPlayers[request.fromPlayerId]?.name
            ?? this.economy.displayName(request.fromPlayerId),
          requestId: request.requestId,
        })),
        tradeOutgoing: this.trade.outgoingRequests(player.id).map((request) => ({
          playerId: request.toPlayerId,
          name: this.players.get(request.toPlayerId)?.name
            ?? this.storedPlayers[request.toPlayerId]?.name
            ?? this.economy.displayName(request.toPlayerId),
        })),
      };
    }
    if (session.screen === 'rating') {
      return {
        ...base,
        ...buildRankingSnapshot(this.clan, this.economy, player.id, session.ratingKind, session.ratingPage),
      };
    }
    if (session.screen === 'auction-history') {
      return {
        ...base,
        auctionHistory: this.auction.historyRows(player.id),
      };
    }
    return base;
  }

  private notifyUnread(playerId: string, category: 'friends' | 'clans' | 'auction' | 'trade'): void {
    this.notifications.notify(playerId, category);
    const player = this.players.get(playerId);
    if (player?.connected && this.menuSessions.has(playerId)) this.flushMenu(player);
  }

  disconnect(playerId: string, persist = true, connectionId?: string): void {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return;
    if (connectionId && player.connectionId !== connectionId) {
      netDebug('disconnect ignored', `stale conn ${connectionId.slice(0, 8)} live=${player.connectionId.slice(0, 8)}`);
      return;
    }
    player.connected = false;
    this.gameplay.forceReleaseVehicle(player, false);
    player.restingBed = undefined;
    this.gameplay.whMarks.clearPlayer(player.id);
    player.disconnectedAt = Date.now();
    player.sink = null;
    player.activeSocketCount = 0;
    this.auction.closeSession(player.id);
    this.clan.closeSession(player.id);
    this.buyer.closeSession(player.id, player.inventory);
    const tradeResult = this.trade.disconnect(player.id);
    this.menuSessions.delete(player.id);
    this.menuReturn.delete(player.id);
    if (tradeResult.affected) {
      for (const id of tradeResult.affected) {
        const other = this.players.get(id);
        if (other?.connected) {
          this.flushPlayerInventory(other);
          this.flushTrade(other, { message: tradeResult.error });
        }
      }
    }
    this.flushPlayerInventory(player);
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
    if (input.use !== true
      && player.bowUseTicks > 0
      && (player.useStartCommandSeq === undefined || input.seq > player.useStartCommandSeq)) {
      const activeSlot = player.useSelectedSlot ?? input.selectedSlot;
      const itemId = player.inventory.getSlot(activeSlot)?.itemId;
      if (itemId === ItemId.Bow) {
        player.bowReleaseCommandStates.set(input.seq, {
          selectedSlot: activeSlot,
          itemId,
          drawTicks: player.bowUseTicks,
        });
        while (player.bowReleaseCommandStates.size > MAX_PENDING_BOW_ACTIONS) {
          const oldest = player.bowReleaseCommandStates.keys().next().value;
          if (oldest === undefined) break;
          player.bowReleaseCommandStates.delete(oldest);
        }
      }
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
    const before = this.world.getBlock(x, y, z);
    const fail = (stage: string, reason: string, extra?: { eventCancelled?: boolean }) => {
      this.noteBreakAttempt(player, x, y, z, commandSeq, stage, { ok: false, reason }, before, extra);
      return { ok: false as const, reason };
    };
    if (intent && (intent.targetX !== x || intent.targetY !== y || intent.targetZ !== z)) {
      return fail('tryBreak.intentMismatch', 'invalid');
    }
    const creative = player.gamemode === 'creative';
    if (!creative
      && player.miningTarget
      && (player.miningTarget.x !== x || player.miningTarget.y !== y || player.miningTarget.z !== z)) {
      return fail('tryBreak.miningLock', 'mining');
    }
    if (intent) {
      const lockedToThis = Boolean(
        player.miningTarget
        && player.miningTarget.x === x
        && player.miningTarget.y === y
        && player.miningTarget.z === z,
      );
      if (lockedToThis) {
        if (before === BlockId.Air) return fail('tryBreak.lockedEmpty', 'empty');
        if (before !== intent.targetBlockId) return fail('tryBreak.lockedStale', 'stale');
      } else {
        const validated = this.gameplay.validatePlayerIntent(player, intent, commandSeq, {
          requireMatchingFace: false,
        });
        if (!validated.ok) return fail('tryBreak.intent', validated.reason);
      }
    }
    const result = this.gameplay.breakBlock(player, x, y, z);
    const after = this.world.getBlock(x, y, z);
    this.noteBreakAttempt(player, x, y, z, commandSeq, 'tryBreak.breakBlock', result, before, {
      eventCancelled: result.ok === false && result.reason === 'cancelled',
      blockAfter: after,
      mutated: result.ok,
    });
    if (result.ok) {
      this.dirty = true;
      this.flushBlockChanges();
      this.flushPlayerInventory(player);
    }
    return result;
  }

  private noteBreakAttempt(
    player: ServerPlayer,
    x: number,
    y: number,
    z: number,
    commandSeq: number | undefined,
    stage: string,
    result: { ok: true } | { ok: false; reason: string },
    blockId: number,
    extra?: { eventCancelled?: boolean; blockAfter?: number; mutated?: boolean },
  ): void {
    logBreakAttempt({
      playerId: player.id,
      playerName: player.name,
      gamemode: player.gamemode,
      x, y, z,
      blockId,
      miningTarget: player.miningTarget,
      miningProgress: player.miningProgress,
      miningStartCommandSeq: player.miningStartCommandSeq,
      appliedCommandSeq: player.appliedCommandSeq,
      commandSeq,
      queueDepth: player.commandQueue.length,
      inputMining: player.lastInput.mining === true,
      stage,
      reason: result.ok ? undefined : result.reason,
      eventCancelled: extra?.eventCancelled,
      blockAfter: extra?.blockAfter,
      mutated: extra?.mutated === true,
    });
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
    const before = this.world.getBlock(intent.targetX, intent.targetY, intent.targetZ);
    if (!this.acceptActionSeq(player, actionSeq)) {
      this.noteBreakAttempt(
        player, intent.targetX, intent.targetY, intent.targetZ, commandSeq,
        'beginMining.duplicate', { ok: false, reason: 'duplicate' }, before,
      );
      return { ok: false, reason: 'duplicate' };
    }
    const result = this.gameplay.beginMining(player, intent, commandSeq);
    this.noteBreakAttempt(
      player, intent.targetX, intent.targetY, intent.targetZ, commandSeq,
      'beginMining', result, before, { mutated: false },
    );
    return result;
  }

  abortMining(player: ServerPlayer): void {
    clearMiningLock(player);
  }

  /** Legacy direct gameplay helper; network bow releases use handleSequencedBowRelease. */
  releaseBow(player: ServerPlayer, action: Pick<BowReleaseAction, 'yaw' | 'pitch' | 'actionSeq' | 'commandSeq'>): { ok: true } | { ok: false; reason: string } {
    if (!this.acceptActionSeq(player, action.actionSeq)) return { ok: false, reason: 'duplicate' };
    if (action.actionSeq <= player.lastBowReleaseSeq) return { ok: false, reason: 'duplicate' };
    player.lastBowReleaseSeq = action.actionSeq;
    const result = this.gameplay.releaseBowWithAim(player, action.yaw, action.pitch);
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    return result;
  }

  handleSequencedBowRelease(player: ServerPlayer, action: BowReleaseAction): void {
    const resolution = this.bowReleaseSequenced(player, action);
    if (resolution.status === 'resolved') this.sendBowActionResult(player, action, resolution.result);
  }

  bowReleaseSequenced(
    player: ServerPlayer,
    action: BowReleaseAction,
  ): { status: 'pending' } | { status: 'resolved'; result: ActionResult } {
    const receivedServerTick = this.tickNumber;
    const activeSlot = player.useSelectedSlot ?? player.selectedSlot;
    const activeItemId = player.inventory.getSlot(activeSlot)?.itemId;
    const receivedBowState = action.commandSeq === player.appliedCommandSeq
      && player.bowUseTicks > 0 && activeItemId === ItemId.Bow
      ? { selectedSlot: activeSlot, itemId: activeItemId, drawTicks: player.bowUseTicks }
      : undefined;
    const base: PendingBowRelease = {
      action,
      receivedServerTick,
      ...(receivedBowState ? { receivedBowState } : {}),
    };
    if (!this.acceptActionSeq(player, action.actionSeq) || action.actionSeq <= player.lastBowReleaseSeq) {
      return { status: 'resolved', result: this.bowFailure(base, 'duplicate', 'duplicate') };
    }
    player.lastBowReleaseSeq = action.actionSeq;
    if (!player.connected || player.survival.dead) {
      return { status: 'resolved', result: this.bowFailure(base, 'dead', 'dead') };
    }
    if (!Number.isInteger(action.commandSeq) || action.commandSeq < 0
      || !Number.isInteger(action.selectedSlot) || action.selectedSlot < 0 || action.selectedSlot >= Inventory.HOTBAR_SIZE
      || !Number.isFinite(action.yaw) || !Number.isFinite(action.pitch)
      || (action.renderTick !== undefined && !Number.isFinite(action.renderTick))) {
      return { status: 'resolved', result: this.bowFailure(base, 'invalid', 'invalid') };
    }
    let pending = base;
    if (action.renderTick !== undefined) {
      const rewind = receivedServerTick - action.renderTick;
      if (rewind < 0) return { status: 'resolved', result: this.bowFailure(base, 'invalid', 'future') };
      if (rewind > MAX_PVP_REWIND_TICKS) {
        return { status: 'resolved', result: this.bowFailure(base, 'stale', 'too_old') };
      }
      pending = { ...base, validatedRenderTick: action.renderTick, receiveRewindTicks: rewind };
    }
    const pose = combatPoseForCommand(player.combatPoseHistory, action.commandSeq);
    if (pose) return { status: 'resolved', result: this.resolveSequencedBowRelease(player, pending, pose) };
    if (action.commandSeq > player.appliedCommandSeq) {
      if (player.pendingBowReleases.length >= MAX_PENDING_BOW_ACTIONS) {
        return { status: 'resolved', result: this.bowFailure(pending, 'stale', 'pending_full') };
      }
      player.pendingBowReleases.push(pending);
      return { status: 'pending' };
    }
    return { status: 'resolved', result: this.bowFailure(pending, 'stale', 'boundary_missing') };
  }

  private resolveSequencedBowRelease(
    player: ServerPlayer,
    pending: PendingBowRelease,
    pose: CombatPoseSample,
  ): ActionResult {
    const { action } = pending;
    const boundary = pose.bowRelease ?? pending.receivedBowState;
    if (pose.dead || !boundary || action.selectedSlot !== pose.selectedSlot
      || boundary.selectedSlot !== pose.selectedSlot || boundary.itemId !== ItemId.Bow) {
      return this.bowFailure(
        pending,
        pose.dead ? 'dead' : action.selectedSlot !== pose.selectedSlot ? 'slot' : 'no-draw',
        pose.dead ? 'dead' : action.selectedSlot !== pose.selectedSlot ? 'slot' : 'boundary_state',
        pose,
      );
    }
    const pendingTicks = Math.max(0, this.tickNumber - pending.receivedServerTick);
    const fired = this.gameplay.releaseBowAtBoundary(
      player,
      {
        eyeX: pose.eyeX,
        eyeY: pose.eyeY,
        eyeZ: pose.eyeZ,
        selectedSlot: pose.selectedSlot,
        itemId: boundary.itemId,
        drawTicks: boundary.drawTicks,
      },
      action.yaw,
      action.pitch,
      [...this.players.values()],
      pending.validatedRenderTick,
      pendingTicks,
      pose.bowRelease === undefined && pending.receivedBowState !== undefined,
    );
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    if (!fired.ok) return this.bowFailure(pending, fired.reason, fired.reason, pose);
    return {
      ok: true,
      actionSeq: action.actionSeq,
      kind: 'bow_release',
      yaw: action.yaw,
      pitch: action.pitch,
      bow: this.bowDiagnostics(pending, pose, {
        authoritativeDrawTicks: fired.drawTicks,
        charge: fired.charge,
        spawned: fired.spawned,
      }),
    };
  }

  private bowFailure(
    pending: PendingBowRelease,
    reason: string,
    rejectReason: string,
    pose?: CombatPoseSample,
  ): ActionResult {
    return {
      ok: false,
      actionSeq: pending.action.actionSeq,
      kind: 'bow_release',
      reason,
      yaw: pending.action.yaw,
      pitch: pending.action.pitch,
      bow: this.bowDiagnostics(pending, pose, { spawned: false, rejectReason }),
    };
  }

  private bowDiagnostics(
    pending: PendingBowRelease,
    pose: CombatPoseSample | undefined,
    outcome: Pick<BowActionDiagnostics, 'spawned'> & Partial<Pick<BowActionDiagnostics, 'authoritativeDrawTicks' | 'charge' | 'rejectReason'>>,
  ): BowActionDiagnostics {
    return {
      receivedServerTick: pending.receivedServerTick,
      ...(pose ? { boundaryServerTick: pose.serverTick } : {}),
      pendingTicks: Math.max(0, this.tickNumber - pending.receivedServerTick),
      ...(pending.action.renderTick !== undefined ? { requestedRenderTick: pending.action.renderTick } : {}),
      ...(pending.validatedRenderTick !== undefined ? { validatedRenderTick: pending.validatedRenderTick } : {}),
      ...(pending.receiveRewindTicks !== undefined ? { receiveRewindTicks: pending.receiveRewindTicks } : {}),
      catchUpTicks: pose ? Math.max(0, this.tickNumber - pending.receivedServerTick) : 0,
      selectedSlot: pending.action.selectedSlot,
      capturedYaw: pending.action.yaw,
      capturedPitch: pending.action.pitch,
      ...(pose ? {
        boundaryYaw: pose.yaw,
        boundaryPitch: pose.pitch,
        boundaryEyeX: pose.eyeX,
        boundaryEyeY: pose.eyeY,
        boundaryEyeZ: pose.eyeZ,
      } : {}),
      ...outcome,
    };
  }

  private sendBowActionResult(player: ServerPlayer, action: BowReleaseAction, result: ActionResult): void {
    this.sendTo(player, {
      type: 'action_result',
      actionSeq: action.actionSeq,
      kind: 'bow_release',
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      yaw: action.yaw,
      pitch: action.pitch,
      ...(result.bow ? { bow: result.bow } : {}),
    });
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

  handleSequencedAttack(player: ServerPlayer, action: AttackAction): void {
    const resolution = this.attackSequenced(player, action);
    if (resolution.status === 'resolved') this.sendAttackActionResult(player, action, resolution.result);
  }

  attackSequenced(
    player: ServerPlayer,
    action: AttackAction,
  ): { status: 'pending' } | { status: 'resolved'; result: ActionResult } {
    if (!this.acceptActionSeq(player, action.actionSeq)) {
      return { status: 'resolved', result: { ok: false, actionSeq: action.actionSeq, kind: 'attack', reason: 'duplicate' } };
    }
    if (!player.connected || player.survival.dead) {
      return { status: 'resolved', result: { ok: false, actionSeq: action.actionSeq, kind: 'attack', reason: 'dead' } };
    }
    if (!Number.isInteger(action.commandSeq) || action.commandSeq < 0
      || !Number.isInteger(action.selectedSlot) || action.selectedSlot < 0 || action.selectedSlot >= Inventory.HOTBAR_SIZE
      || (action.yaw !== undefined && !Number.isFinite(action.yaw))
      || (action.pitch !== undefined && !Number.isFinite(action.pitch))
      || (action.targetId === undefined) !== (action.targetRenderTick === undefined)
      || (action.targetRenderTick !== undefined && !Number.isFinite(action.targetRenderTick))
      || action.targetId === player.id) {
      return { status: 'resolved', result: { ok: false, actionSeq: action.actionSeq, kind: 'attack', reason: 'invalid' } };
    }
    const pending = this.capturePendingMeleeAttack(player, action);
    if ('ok' in pending) return { status: 'resolved', result: pending };
    const pose = combatPoseForCommand(player.combatPoseHistory, action.commandSeq);
    if (pose) return { status: 'resolved', result: this.resolveSequencedAttack(player, pending, pose) };
    if (action.commandSeq > player.appliedCommandSeq && player.commandQueue.find(action.commandSeq)) {
      if (player.pendingAttacks.length >= MAX_PENDING_MELEE_ACTIONS) {
        return {
          status: 'resolved',
          result: {
            ok: false,
            actionSeq: action.actionSeq,
            kind: 'attack',
            reason: 'stale',
            combat: this.combatStatus(pending, 'stale'),
          },
        };
      }
      player.pendingAttacks.push(pending);
      return { status: 'pending' };
    }
    return {
      status: 'resolved',
      result: {
        ok: false,
        actionSeq: action.actionSeq,
        kind: 'attack',
        reason: 'stale',
        combat: this.combatStatus(pending, 'stale'),
      },
    };
  }

  /** Validate and freeze the server-owned target pose at packet receive time. */
  private capturePendingMeleeAttack(
    player: ServerPlayer,
    action: AttackAction,
  ): PendingMeleeAttack | ActionResult {
    const pending: PendingMeleeAttack = {
      action,
      receivedServerTick: this.tickNumber,
    };
    if (action.targetId === undefined || action.targetRenderTick === undefined) return pending;
    const target = this.players.get(action.targetId);
    const pose = target
      ? rewindCombatPose(target.combatPoseHistory, action.targetRenderTick, pending.receivedServerTick)
      : undefined;
    if (!target || target.id === player.id || !target.connected || target.survival.dead
      || target.gamemode !== 'survival' || !pose || pose.dead) {
      return {
        ok: false,
        actionSeq: action.actionSeq,
        kind: 'attack',
        reason: 'stale',
        combat: this.combatStatus(pending, 'stale'),
      };
    }
    return {
      ...pending,
      target: {
        playerId: target.id,
        requestedRenderTick: action.targetRenderTick,
        pose,
      },
    };
  }

  private resolveSequencedAttack(
    player: ServerPlayer,
    pending: PendingMeleeAttack,
    attackerPose: CombatPoseSample,
  ): ActionResult {
    const { action } = pending;
    if (attackerPose.dead || action.selectedSlot !== attackerPose.selectedSlot) {
      return {
        ok: false,
        actionSeq: action.actionSeq,
        kind: 'attack',
        reason: attackerPose.dead ? 'dead' : 'slot',
        combat: this.combatStatus(pending, 'stale'),
      };
    }
    if (pending.target) {
      const target = this.players.get(pending.target.playerId);
      if (!target || target.id === player.id || !target.connected || target.survival.dead
        || target.gamemode !== 'survival') {
        return {
          ok: true,
          actionSeq: action.actionSeq,
          kind: 'attack',
          combat: this.combatStatus(pending, 'stale'),
        };
      }
      const combat = this.gameplay.attack(player, [...this.players.values()], {
        attackerPose,
        target: {
          player: target,
          pose: pending.target.pose,
          requestedRenderTick: pending.target.requestedRenderTick,
        },
      });
      this.flushBlockChanges();
      this.flushPlayerInventory(player);
      return {
        ok: true,
        actionSeq: action.actionSeq,
        kind: 'attack',
        combat: { ...combat, ...this.combatTiming(pending) },
      };
    }
    const combat = this.gameplay.attack(player, [...this.players.values()], {
      attackerPose,
      allowCurrentPlayerTargets: false,
    });
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    return {
      ok: true,
      actionSeq: action.actionSeq,
      kind: 'attack',
      combat: { ...combat, ...this.combatTiming(pending) },
    };
  }

  private combatTiming(pending: PendingMeleeAttack) {
    return {
      receivedServerTick: pending.receivedServerTick,
      pendingTicks: Math.max(0, this.tickNumber - pending.receivedServerTick),
    };
  }

  private combatStatus(
    pending: PendingMeleeAttack,
    result: 'stale' | 'pending_timeout',
  ) {
    const { action } = pending;
    return {
      result,
      ...(action.targetId !== undefined ? { targetId: action.targetId } : {}),
      ...(action.targetRenderTick !== undefined ? { requestedRenderTick: action.targetRenderTick } : {}),
      ...(pending.target ? {
        resolvedRenderTick: pending.target.pose.resolvedTick,
        rewindTicks: pending.target.pose.rewindTicks,
      } : {}),
      ...this.combatTiming(pending),
    };
  }

  private sendAttackActionResult(player: ServerPlayer, action: AttackAction, result: ActionResult): void {
    this.sendTo(player, {
      type: 'action_result',
      actionSeq: action.actionSeq,
      kind: 'attack',
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(action.yaw !== undefined ? { yaw: action.yaw } : {}),
      ...(action.pitch !== undefined ? { pitch: action.pitch } : {}),
      ...(result.combat ? { combat: result.combat } : {}),
    });
  }

  interact(
    player: ServerPlayer,
    intent?: BlockTargetIntent,
    actionSeq?: number,
    commandSeq?: number,
    selectedSlot?: number,
  ): { ok: true } | { ok: false; reason: string } {
    if (!this.acceptActionSeq(player, actionSeq)) return { ok: false, reason: 'duplicate' };
    const slot = this.resolveActionSlot(player, commandSeq, selectedSlot);
    if (!slot.ok) return slot;
    this.commitActionSelectedSlot(player, slot.value, commandSeq);
    const result = this.gameplay.useHeld(
      player,
      intent,
      commandSeq,
      slot.value,
      slot.boundaryCommandConfirmsUse,
    );
    this.dirty = true;
    this.flushBlockChanges();
    this.flushPlayerInventory(player);
    if (player.pendingSignEdit) {
      const { x, y, z } = player.pendingSignEdit;
      player.pendingSignEdit = undefined;
      if (this.world.getBlock(x, y, z, false) === BlockId.OakSign) {
        this.sendTo(player, { type: 'sign_editor', x, y, z, lines: this.world.signText(x, y, z) ?? EMPTY_SIGN_LINES });
      }
    }
    return result;
  }

  updateBook(player: ServerPlayer, message: ClientBookUpdateMessage): void {
    const draft = sanitizeBookDraft(message);
    const selected = player.inventory.getSlot(message.slot);
    if (!player.connected || player.survival.dead || player.selectedSlot !== message.slot
      || selected?.itemId !== ItemId.Book || readBookContent(selected)?.locked || !draft) {
      this.sendTo(player, { type: 'error', code: 'book_invalid', message: 'Не удалось сохранить книгу' });
      return;
    }
    const overflow = writeBookInSlot(player.inventory, message.slot, draft, message.sign ? player.name : undefined);
    if (overflow === undefined) {
      this.sendTo(player, { type: 'error', code: 'book_invalid', message: 'Не удалось сохранить книгу' });
      return;
    }
    if (overflow) this.gameplay.dropFromPlayer(player, overflow);
    player.inventoryDirty = true;
    this.dirty = true;
    this.flushPlayerInventory(player);
  }

  updateSign(player: ServerPlayer, message: ClientSignUpdateMessage): void {
    const { x, y, z } = message;
    const lines = sanitizeSignLines(message.lines);
    const eye = player.controller.eyePosition();
    const reach = Math.hypot(eye.x - x - 0.5, eye.y - y - 0.5, eye.z - z - 0.5) <= PLAYER_NET_REACH;
    if (!player.connected || player.survival.dead || !reach || !isValidWorldY(y)
      || this.world.getBlock(x, y, z, false) !== BlockId.OakSign || !lines) {
      this.sendTo(player, { type: 'error', code: 'sign_invalid', message: 'Не удалось сохранить табличку' });
      return;
    }
    const use = this.events.createPlayerInteract(player.id, x, y, z, BlockId.OakSign);
    this.events.emit('playerInteract', use);
    if (use.cancelled || !this.world.setSignText(x, y, z, lines)) return;
    this.dirty = true;
    const key = chunkKey(floorDiv(x, 16), floorDiv(z, 16));
    for (const viewer of this.connectedPlayers()) if (viewer.knownChunks.has(key)) {
      this.sendTo(viewer, { type: 'sign_data', x, y, z, lines });
    }
  }

  pickup(player: ServerPlayer): void {
    this.gameplay.collectFor(player);
    this.flushPlayerInventory(player);
  }

  vehicleInput(player: ServerPlayer, message: ClientVehicleInputMessage): void {
    if (message.action === 'exit') this.gameplay.exitVehicle(player);
    else if (message.action === 'enter' && message.entityId) {
      if (this.gameplay.enterVehicle(player, message.entityId)) return;
      const reason = this.gameplay.consumeVehicleEnterReject();
      const text = reason === 'already_riding'
        ? 'Сначала выйдите из текущей вагонетки.'
        : reason === 'vehicle_occupied'
          ? 'Вагонетка занята.'
          : undefined;
      if (text) {
        this.sendTo(player, {
          type: 'chat',
          from: 'server',
          playerId: 'server',
          text,
          kind: 'system',
        });
      }
    } else if (message.action === 'steer' && message.forward !== undefined) {
      player.vehicleForward = Math.max(-1, Math.min(1, message.forward));
    }
  }

  interactHologram(player: ServerPlayer, name: string): void {
    const hologram = this.holograms.get(name);
    if (!hologram || !hologram.enabled) return;
    const owned = this.buyer.findByHologram(name);
    if (owned) {
      this.interactBuyer(player, owned.id);
      return;
    }
    const eye = player.controller.eyePosition();
    if (!playerCanReachHologram(eye, hologram, PLAYER_NET_REACH)) return;
    if (!this.canEditHolograms(player)) {
      this.sendHologramPermissionDenied(player);
      return;
    }
    this.sendTo(player, { type: 'hologram_editor', hologram: toNetworkHologram(hologram) });
  }

  updateHologramAppearance(player: ServerPlayer, message: ClientHologramUpdateMessage): void {
    const owner = this.buyer.findByHologram(message.name);
    if (owner || isBuyerHologramName(message.name)) {
      this.updateBuyerHologramAppearance(player, message, owner);
      return;
    }
    const hologram = this.holograms.get(message.name);
    if (!hologram || !hologram.enabled) {
      this.sendTo(player, {
        type: 'command_result',
        ok: false,
        name: 'holograms',
        lines: [`Hologram '${message.name}' not found.`],
      });
      this.sendTo(player, {
        type: 'chat',
        from: 'server',
        playerId: 'server',
        text: `Hologram '${message.name}' not found.`,
        kind: 'error',
      });
      return;
    }
    const eye = player.controller.eyePosition();
    if (!playerCanReachHologram(eye, hologram, PLAYER_NET_REACH)) return;
    if (!this.canEditHolograms(player)) {
      this.sendHologramPermissionDenied(player);
      return;
    }
    this.holograms.updateAppearance(message.name, message, {
      playerYaw: player.controller.yaw,
      nowMs: Date.now(),
    });
  }

  private updateBuyerHologramAppearance(
    player: ServerPlayer,
    message: ClientHologramUpdateMessage,
    owner: BuyerRecord | undefined,
  ): void {
    if (!owner || owner.hologramName !== message.name.trim().toLowerCase()) {
      this.sendBuyerHologramDenied(player);
      return;
    }
    if (!this.hasBuyerPermission(player, 'buyer.edit')) {
      this.sendBuyerHologramDenied(player);
      return;
    }
    const hologram = this.holograms.get(owner.hologramName);
    if (!hologram || !hologram.enabled) {
      this.sendBuyerHologramDenied(player);
      return;
    }
    const eye = player.controller.eyePosition();
    if (!playerCanReachBuyer(eye, owner, PLAYER_NET_REACH)) return;
    this.holograms.updateAppearance(owner.hologramName, message, {
      playerYaw: player.controller.yaw,
      nowMs: Date.now(),
    });
    this.buyer.captureHologramText(owner.id);
  }

  private sendBuyerHologramDenied(player: ServerPlayer): void {
    this.sendTo(player, {
      type: 'command_result',
      ok: false,
      name: 'holograms',
      lines: ['Эта голограмма принадлежит скупщику.'],
    });
    this.sendTo(player, {
      type: 'chat',
      from: 'server',
      playerId: 'server',
      text: 'Эта голограмма принадлежит скупщику.',
      kind: 'error',
    });
  }

  private canEditHolograms(player: ServerPlayer): boolean {
    return this.isOperator(player)
      || this.permissions.has(player.id, 'holograms.create')
      || this.permissions.has(player.name, 'holograms.create');
  }

  private sendHologramPermissionDenied(player: ServerPlayer): void {
    this.sendTo(player, {
      type: 'command_result',
      ok: false,
      name: 'holograms',
      lines: ['You do not have permission.'],
    });
    this.sendTo(player, {
      type: 'chat',
      from: 'server',
      playerId: 'server',
      text: 'You do not have permission.',
      kind: 'error',
    });
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

  handleChat(player: ServerPlayer, text: string, channel: ChatChannel = 'global'): void {
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
    const trimmed = text.replace(/\s+$/g, '');
    if (!trimmed) return;
    if (trimmed.length > MAX_CHAT_LENGTH) {
      this.sendChatError(player, CHAT_TOO_LONG_ERROR);
      return;
    }
    const recipients = this.chatRecipients(player, channel);
    if (!recipients) return;
    this.deliverPlayerChat(player, trimmed, channel, recipients);
  }

  sendChatError(player: ServerPlayer, text: string): void {
    this.sendTo(player, {
      type: 'chat',
      from: 'server',
      playerId: 'server',
      text,
      kind: 'error',
    });
  }

  private chatRecipients(sender: ServerPlayer, channel: ChatChannel): ServerPlayer[] | undefined {
    if (channel === 'global') return this.connectedPlayers();
    if (channel === 'nearby') {
      const origin = sender.controller.position;
      return this.connectedPlayers().filter((other) => isWithinNearbyChatRange(
        origin.x,
        origin.y,
        origin.z,
        other.controller.position.x,
        other.controller.position.y,
        other.controller.position.z,
      ));
    }
    const clan = this.clan.playerClan(sender.id);
    if (!clan) {
      this.sendChatError(sender, CHAT_NO_CLAN_HINT);
      return undefined;
    }
    const members = new Set(clan.memberIds);
    return this.connectedPlayers().filter((other) => members.has(other.id));
  }

  private deliverPlayerChat(
    sender: ServerPlayer,
    text: string,
    channel: ChatChannel,
    recipients: ServerPlayer[],
  ): void {
    const payload: ServerChatMessage = {
      type: 'chat',
      messageId: crypto.randomUUID(),
      from: sender.name,
      playerId: sender.id,
      text,
      kind: 'player',
      channel,
    };
    const seen = new Set<string>();
    for (const target of recipients) {
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      this.sendTo(target, payload);
    }
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
      player.appliedCommandBoundaryThisTick = false;
      player.bowReleaseBoundaryThisTick = undefined;
    }
    if (this.debugTickOrder) this.kernelTrace.length = 0;
    const metrics = this.gameplay.tick([...this.players.values()], dt, {
      tickPlayers: () => this.tickConnectedPlayers(dt),
      trace: this.debugTickOrder ? this.kernelTrace : undefined,
    });
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      this.gameplay.updateRiding(player, player.lastInput.sneak);
    }
    this.recordCombatPoses();
    this.processPendingBowReleases();
    this.processPendingAttacks();
    this.lastTickMs = performance.now() - started;
    this.maxTickMs = Math.max(this.maxTickMs, this.lastTickMs, metrics.maxTickMs);
    this.autoMine.tick();
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
    const passengers = collectMinecartPassengers(this.connectedPlayers());
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
    for (const player of this.players.values()) {
      if (player.totemActivated) {
        this.gameplay.whMarks.clearTarget(player.id);
        const position = player.controller.position;
        const x = position.x;
        const y = position.y + 1;
        const z = position.z;
        this.gameplay.emitWorldSound('totem.activate', x, y, z);
        const packet = { type: 'totem_activate' as const, playerId: player.id, x, y, z };
        for (const listener of this.connectedPlayers()) {
          if (listenerHearsWorldSound(listener.controller.position, packet, TOTEM_PRESENTATION_DISTANCE)) {
            this.sendTo(listener, packet);
          }
        }
        player.totemActivated = false;
      }
      if (!player.connected || player.survival.dead) this.gameplay.whMarks.clearPlayer(player.id);
    }
    for (const player of this.connectedPlayers()) {
      this.sendTo(player, {
        type: 'wh_marks',
        targetIds: this.gameplay.whMarks.forViewer(player.id, this.world.tickNumber)
          .filter((id) => {
            const target = this.players.get(id);
            return target?.connected && !target.survival.dead;
          }),
      });
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
    const worldSounds = this.gameplay.consumeWorldSounds();
    if (worldSounds.length > 0) {
      for (const player of this.connectedPlayers()) {
        const listener = player.controller.position;
        const hearable = worldSounds.filter((sound) => listenerHearsWorldSound(
          listener,
          sound,
          worldSoundMaxDistance(sound.event),
        ));
        if (hearable.length > 0) {
          this.sendTo(player, { type: 'world_sound', sounds: hearable });
        }
      }
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

  private resolveActionSlot(
    player: ServerPlayer,
    commandSeq: number | undefined,
    selectedSlot: number | undefined,
  ): { ok: true; value: number; boundaryCommandConfirmsUse: boolean } | { ok: false; reason: string } {
    if (selectedSlot === undefined) {
      return {
        ok: true,
        value: player.selectedSlot,
        boundaryCommandConfirmsUse: player.lastInput.use === true,
      };
    }
    if (!Number.isInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= Inventory.HOTBAR_SIZE) {
      return { ok: false, reason: 'slot' };
    }
    if (commandSeq === undefined) {
      return {
        ok: true,
        value: selectedSlot,
        boundaryCommandConfirmsUse: player.lastInput.use === true && player.selectedSlot === selectedSlot,
      };
    }
    const historical = player.actionPoseHistory.find((sample) => sample.commandSeq === commandSeq);
    const command = player.commandQueue.find(commandSeq);
    const commandState = command ?? historical;
    if (!commandState) {
      if (commandSeq === player.appliedCommandSeq && selectedSlot === player.selectedSlot) {
        return {
          ok: true,
          value: selectedSlot,
          boundaryCommandConfirmsUse: player.lastInput.use === true,
        };
      }
      return { ok: false, reason: 'stale' };
    }
    const slotChangedAfterBoundary = commandState.selectedSlot !== selectedSlot;
    // Reject only truly stale packets: an older command after a newer input
    // already applied. A 1–9 press after the last sent input uses the same
    // commandSeq with a newer selectedSlot and must still succeed.
    if (slotChangedAfterBoundary && commandSeq < player.lastInputSeq) {
      return { ok: false, reason: 'slot' };
    }
    return {
      ok: true,
      value: selectedSlot,
      boundaryCommandConfirmsUse: command?.use === true && !slotChangedAfterBoundary,
    };
  }

  private commitActionSelectedSlot(
    player: ServerPlayer,
    slot: number,
    commandSeq: number | undefined,
  ): void {
    player.selectedSlot = slot;
    if (commandSeq === undefined || !Number.isInteger(commandSeq)) return;
    player.actionSelectedSlot = { commandSeq, slot };
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
    player.combatPoseHistory.length = 0;
    player.pendingAttacks.length = 0;
    player.pendingBowReleases.length = 0;
    player.bowReleaseCommandStates.clear();
    player.bowReleaseBoundaryThisTick = undefined;
    clearMiningLock(player);
    player.bowUseTicks = 0;
    player.foodUseTicks = 0;
    player.useStartCommandSeq = undefined;
    player.useSelectedSlot = undefined;
    player.useItemId = undefined;
    player.foodUseBoundaryCommandConfirmed = undefined;
    player.bowUseBoundaryCommandConfirmed = undefined;
    player.lastUse = false;
    player.lastSprint = false;
    player.vehicleForward = 0;
    player.actionSelectedSlot = undefined;
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
      const queuedCommand = player.commandQueue.peek();
      const command = player.commandQueue.takeForTick();
      player.appliedCommandBoundaryThisTick = command !== null && command === queuedCommand;
      if (command) {
        player.lastInput = inputFromCommand(command);
        player.appliedCommandSeq = command.commandSeq;
        const override = player.actionSelectedSlot;
        if (override && command.commandSeq <= override.commandSeq) {
          player.selectedSlot = override.slot;
        } else {
          player.selectedSlot = command.selectedSlot;
          player.actionSelectedSlot = undefined;
        }
        player.controller.yaw = command.yaw;
        player.controller.pitch = command.pitch;
        player.vehicleForward = command.vehicleForward
          ?? (player.ridingCartId ? command.forward : 0);
        if (command.use !== true) {
          player.bowReleaseBoundaryThisTick = player.bowReleaseCommandStates.get(command.commandSeq);
          player.bowReleaseCommandStates.delete(command.commandSeq);
        }
      }
      if (player.survival.dead) {
        player.restingBed = undefined;
        player.controller.velocity.set(0, 0, 0);
        this.flushHealthIfDeadThenRespawn(player);
        const position = player.controller.position;
        player.appliedStepsThisLoop.push({
          serverTick: this.tickNumber,
          commandSeq: player.appliedCommandSeq >= 0 ? player.appliedCommandSeq : 0,
          x: position.x,
          y: position.y,
          z: position.z,
          vx: 0,
          vy: 0,
          vz: 0,
          onGround: player.controller.onGround,
          flying: player.controller.isFlying,
          sneaking: player.controller.sneaking,
          sprinting: false,
        });
        continue;
      }
      const input = player.lastInput;
      let exitedRest = false;
      if (player.restingBed) {
        const rest = player.restingBed;
        if (!isBedRestValid(this.world, rest) || command?.jump === true) {
          player.restingBed = undefined;
          player.controller.teleport(bedExitPosition(this.world, rest));
          exitedRest = true;
          player.lastInput = { ...player.lastInput, jump: false };
        } else {
          player.controller.velocity.set(0, 0, 0);
        }
      }
      const jump = input.jump && !exitedRest;
      const using = input.use === true;
      const heldItemId = player.inventory.getSlot(player.selectedSlot)?.itemId;
      const movement = movementDuringItemUse({
        forward: input.forward,
        right: input.right,
        jump,
        sneak: input.sneak,
        sprint: input.sprint,
        descend: input.descend,
        flySprint: input.flySprint,
      }, heldItemId, using);
      const before = player.controller.position.clone();
      player.controller.creativeFlightAllowed = player.gamemode === 'creative';
      const riding = Boolean(player.ridingCartId);
      if (!player.restingBed) player.controller.tick(this.world, {
        yaw: input.yaw,
        pitch: input.pitch,
        locomotion: !riding,
        movement: () => ({
          forward: riding ? 0 : movement.forward,
          right: riding ? 0 : movement.right,
          jump: riding ? false : movement.jump,
          sneak: movement.sneak,
          sprint: movement.sprint,
          descend: movement.descend,
          flySprint: movement.flySprint,
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
      if (shouldKeepMiningLock({
        mining: input.mining,
        appliedCommandSeq: player.appliedCommandSeq,
        miningStartCommandSeq: player.miningStartCommandSeq,
      })) {
        const before = player.miningProgress;
        const target = player.miningTarget;
        this.gameplay.advanceMining(player);
        if (process.env.FC_DEBUG_MINING === '1' && target) {
          serverLog(
            `mine progress ${player.name} target=${target.x},${target.y},${target.z}`
            + ` ${before.toFixed(3)}→${player.miningProgress.toFixed(3)}`
            + ` startCmd=${player.miningStartCommandSeq ?? '—'} applied=${player.appliedCommandSeq}`
            + ` input.mining=${input.mining === true ? 1 : 0} queue=${player.commandQueue.length}`,
          );
        }
      }
      else clearMiningLock(player);
      this.gameplay.advanceUseHold(player, using, player.appliedCommandSeq, player.selectedSlot);
      player.recordAppliedInput(this.tickNumber, {
        seq: player.appliedCommandSeq >= 0 ? player.appliedCommandSeq : player.lastInputSeq,
        forward: riding || player.restingBed ? 0 : input.forward,
        right: riding || player.restingBed ? 0 : input.right,
        jump: riding || player.restingBed ? false : jump,
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

  /** Snapshot combat state only after the complete authoritative physics/gameplay tick. */
  private recordCombatPoses(): void {
    for (const player of this.players.values()) {
      if (!player.connected) continue;
      const eye = player.controller.eyePosition();
      const aabb = player.controller.aabb;
      const position = player.controller.position;
      recordCombatPose(player.combatPoseHistory, {
        serverTick: this.tickNumber,
        commandSeq: player.appliedCommandSeq >= 0 ? player.appliedCommandSeq : 0,
        commandBoundary: player.appliedCommandBoundaryThisTick,
        eyeX: eye.x,
        eyeY: eye.y,
        eyeZ: eye.z,
        positionX: position.x,
        positionY: position.y,
        positionZ: position.z,
        yaw: player.controller.yaw,
        pitch: player.controller.pitch,
        selectedSlot: player.selectedSlot,
        ...(player.bowReleaseBoundaryThisTick ? { bowRelease: player.bowReleaseBoundaryThisTick } : {}),
        aabb: { ...aabb },
        dead: player.survival.dead,
        fallDistance: player.controller.fallDistance,
        onGround: player.controller.onGround,
        sprinting: player.controller.sprinting,
        inWater: player.controller.inWater,
        onLadder: player.controller.onLadder,
        riding: Boolean(player.ridingCartId),
      });
    }
  }

  private processPendingBowReleases(): void {
    for (const player of this.players.values()) {
      if (player.pendingBowReleases.length === 0) continue;
      const keep: PendingBowRelease[] = [];
      for (const pending of player.pendingBowReleases) {
        const { action } = pending;
        const pendingTicks = this.tickNumber - pending.receivedServerTick;
        if (pendingTicks > MAX_PENDING_BOW_TICKS) {
          this.sendBowActionResult(player, action, this.bowFailure(pending, 'stale', 'pending_timeout'));
          continue;
        }
        const pose = combatPoseForCommand(player.combatPoseHistory, action.commandSeq);
        if (pose) {
          this.sendBowActionResult(player, action, this.resolveSequencedBowRelease(player, pending, pose));
          continue;
        }
        if (action.commandSeq > player.appliedCommandSeq) {
          keep.push(pending);
          continue;
        }
        this.sendBowActionResult(player, action, this.bowFailure(pending, 'stale', 'boundary_missing'));
      }
      player.pendingBowReleases.length = 0;
      player.pendingBowReleases.push(...keep);
    }
  }

  private processPendingAttacks(): void {
    for (const player of this.players.values()) {
      if (player.pendingAttacks.length === 0) continue;
      const keep: PendingMeleeAttack[] = [];
      for (const pending of player.pendingAttacks) {
        const { action } = pending;
        const pendingTicks = this.tickNumber - pending.receivedServerTick;
        if (pendingTicks > MAX_PENDING_MELEE_TICKS) {
          this.sendAttackActionResult(player, action, {
            ok: false,
            actionSeq: action.actionSeq,
            kind: 'attack',
            reason: 'stale',
            combat: this.combatStatus(pending, 'pending_timeout'),
          });
          continue;
        }
        const pose = combatPoseForCommand(player.combatPoseHistory, action.commandSeq);
        if (pose) {
          this.sendAttackActionResult(player, action, this.resolveSequencedAttack(player, pending, pose));
          continue;
        }
        if (action.commandSeq > player.appliedCommandSeq && player.commandQueue.find(action.commandSeq)) {
          keep.push(pending);
          continue;
        }
        this.sendAttackActionResult(player, action, {
          ok: false,
          actionSeq: action.actionSeq,
          kind: 'attack',
          reason: 'stale',
          combat: this.combatStatus(pending, 'stale'),
        });
      }
      player.pendingAttacks.length = 0;
      player.pendingAttacks.push(...keep);
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
    const chest = player.window.kind === 'portal-chest'
      ? player.portalChest
      : player.window.kind === 'chest' && player.window.x !== undefined
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

  respawn(player: ServerPlayer): boolean {
    const respawned = this.gameplay.respawnPlayer(player);
    if (respawned) player.restingBed = undefined;
    return respawned;
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
          this.sendTo(player, { type: 'chunk_data', cx: x, cz: z, modifications: mods, signs: this.world.signsForChunk(x, z) });
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
        yaw: player.controller.yaw,
        pitch: player.controller.pitch,
      }),
      snapshot: () => player.snapshot(),
      teleport: (x: number, y: number, z: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !isValidWorldY(y)) return false;
        player.restingBed = undefined;
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
      sanitizeRegisteredAppearance(stored.appearance) ?? DEFAULT_PLAYER_APPEARANCE,
    );
    if (stored.cursor) {
      try {
        player.cursor = stored.cursor as ItemStack;
      } catch {
        player.cursor = null;
      }
    }
    player.portalChest.slots = normalizePortalChestSlots(stored.portalChest);
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
      portalChest: player.portalChest.slots,
      appearance: toNetworkAppearance(player.appearance),
    };
  }

  setAppearance(
    player: ServerPlayer,
    raw: unknown,
  ): { ok: true; appearance: PlayerAppearance } | { ok: false; reason: 'invalid' } {
    const allowed = sanitizeRegisteredAppearance(raw);
    if (!allowed) {
      this.sendTo(player, {
        type: 'player_appearance',
        playerId: player.id,
        appearance: toNetworkAppearance(player.appearance),
      });
      return { ok: false, reason: 'invalid' };
    }
    if (!appearancesEqual(player.appearance, allowed)) {
      player.appearance = allowed;
      this.storedPlayers[player.id] = this.toStored(player);
      this.dirty = true;
    }
    this.broadcast({
      type: 'player_appearance',
      playerId: player.id,
      appearance: toNetworkAppearance(player.appearance),
    });
    return { ok: true, appearance: player.appearance };
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
