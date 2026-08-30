import * as THREE from 'three';
import {
  BlockId,
  canHarvestBlock,
  getBlockDefinition,
  isPressurePlateBlock,
  isSlabBlock,
  miningProgressPerTick,
  miningToolFromItemId,
} from '../blocks';
import { CombatSystem, PlayerArrowManager, completeMeleeAttack, flamingArrowBlockHit, resolvePlayerAttackTarget } from '../combat';
import {
  ChatLog,
  PLAYER_CHAT_NAME,
  chatLineOpacity,
  deathMessage,
  dispatchChatLine,
  type CommandContext,
} from '../chat';
import { AudioManager } from './AudioManager';
import {
  advanceFootsteps,
  blockUnderFeet,
  createExplosionLog,
  createFootstepState,
  createMiningSoundState,
  nextMiningSound,
  resetFootsteps,
  resetMiningSound,
  shouldPlayExplosion,
  consumableSoundEvent,
  type BlockSoundAction,
  type PlaySoundOptions,
  type SoundEventId,
} from '../audio';
import {
  AUTOSAVE_INTERVAL_SECONDS,
  DEFAULT_RENDER_DISTANCE_DESKTOP,
  DEFAULT_RENDER_DISTANCE_MOBILE,
  FIXED_DT,
  MAX_CATCH_UP_TICKS,
  MAX_FRAME_DELTA,
  PLAYER_HEIGHT,
  PLAYER_REACH,
  PLAYER_WIDTH,
  TICK_RATE,
    WORLD_HEIGHT,
    WORLD_JOB_BUDGET_MS,
  WORLD_LOADING_JOB_BUDGET_MS,
  WORLD_LIGHT_BUDGET_MS,
  WORLD_LOADING_LIGHT_BUDGET_MS,
  TARGET_FRAME_MS,
  SEA_LEVEL,
  blockKey,
  clamp,
  floorDiv,
} from './constants';
import { advanceFixedStep } from './fixedStep';
import { DevProfiler, isChunkOverlayQueryEnabled, isPerfQueryEnabled, isWorldgenDebugQueryEnabled, readPerfScenario, type FrameCostBreakdown } from './devProfiler';
import {
  chunksInSquareRadius,
  initialReadyChunkRadius,
  monotonicPercent,
  worldLoadPercent,
  worldLoadView,
  type WorldLoadPhase,
  type WorldLoadSnapshot,
} from './worldLoading';
import {
  openingPauseMenuPausesSimulation,
  playerGameplayAllowed,
  resolvePlayerMoveInput,
  worldSimulationActive,
} from './gameplayModal';
import { GameLifecycleManager } from './Lifecycle';
import { RollingTimingWindow } from './PerformanceStats';
import {
  DroppedItemManager,
  FallingBlockManager,
  MinecartManager,
  dropsForBrokenMinecart,
  minecartDismountFromSprint,
  MobManager,
  ThreeEntityHost,
  type MinecartEntity,
  type MobPlayerDamageEvent,
  type SerializedDroppedItem,
  type SerializedFallingBlock,
  type SerializedMinecart,
  type SerializedMob,
} from '../entities';
import { InputManager } from '../input/InputManager';
import {
  shouldOpenPauseOnUnlock,
  shouldShowPointerLockFallback,
  type PointerUnlockReason,
} from '../input/pointerLock';
import { Inventory, createItemStack, damageItem, type ItemStack } from '../inventory';
import { ItemId, getItemDefinition, tryGetItemDefinition } from '../items';
import { restoreBucketInventory } from '../items/bucketInteraction';
import { PlayerController } from '../player';
import { RedstoneSystem, type SerializedRedstoneState } from '../redstone';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { ItemIconRenderer } from '../rendering/ItemIconRenderer';
import { applyImmediateRenderLook } from '../rendering/cameraLook';
import { HurtFeedback, isPeriodicDamageSource } from '../rendering/hurtFeedback';
import { ArrowVisualFactory } from '../rendering/ArrowVisualFactory';
import { updateSharedFireAnimation } from '../rendering/fireTexture';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { ChunkGridOverlay } from '../rendering/ChunkGridOverlay';
import { setWorldLightDebug } from '../rendering/worldLighting';
import {
  categoryColor,
  chebyshev,
  chunkKey as inspectChunkKey,
  emptyJobFrameCounters,
  lightingIsActive,
  openReadyWantedWaitMs,
  parseChunkKey,
  pushSlowSnapshot,
  readyWantedToMeshSampleMs,
  shouldWarnReadyMeshWait,
  syncWantedPeriod,
  toggleInspectFreeze,
  wantedToVisibleSampleMs,
  type ChunkDebugCategory,
  type InspectFreeze,
  type JobFrameCounters,
  type SlowChunkSnapshot,
} from '../debug/chunkStreamingInspector';
import {
  captureStreamingSnapshot,
  collectStreamingQueues,
  formatStreamingHud,
  inspectStreamingChunk,
  maybeSlowSnapshot,
} from '../debug/chunkStreamingRuntime';
import { ChunkStreamingTrace } from '../debug/chunkStreamingTrace';
import { SaveService } from '../save/SaveService';
import type { GameMode, SerializedServerWorld, SerializedWorldState, WorldSummary } from '../save/types';
import { SurvivalSystem, getArmorPoints, type DamageResult, type DamageSource } from '../survival';
import { GameUI } from '../ui/GameUI';
import { potionHudEntries } from '../ui/effectHud';
import { LIGHT_FLOOD_ADD_EMITTER, LIGHT_FLOOD_REGION, disposeWorldLighting, lightFrameStats, lightingFloodOwner } from '../world/LightEngine';
import { stoneCapY } from '../world/Generator';
import { estimateWorldSpawn } from '../world/spawn';
import { VoxelWorld, type VoxelHit } from '../world/World';
import {
  ANARCHY_SERVER_ID,
  ANARCHY_WORLD_ID,
  createAnarchySummary,
  createCanonicalAnarchyServerWorld,
  isFiniteSpawn,
  resolveAnarchyStartup,
} from '../world/import';
import { AnarchyClient, RemotePlayerView, fetchAnarchyStatus } from '../net';
import {
  clientLookAfterSnapshot,
  ingestAuthoritativePosition,
  shouldAcceptSnapshot,
  splitPlayerSnapshots,
  stepTowardTarget,
} from '../net/authoritativeMotion';
import {
  applyEntitySnapshots,
  applyInterpolatedEntityVisuals,
  applyNetworkEntityEvents,
} from '../net/applyEntitySnapshots';
import { EntityInterpolationBuffer } from '../net/entitySnapshotInterpolation';
import { stepVisualBowUseTicks } from '../input/gameplayKeys';
import {
  planOnlineRespawnInputRestore,
  recordAliveSnapshotTick,
  shouldIgnoreStaleDeadSnapshot,
  shouldRestoreGameplayAfterRespawn,
} from './onlineRespawn';
import { shouldRunClientWorldSimulation } from './onlineSimulation';
import {
  lifecycleAfterWorldSessionEnter,
  shouldHandleOnlineClientEvent,
} from './onlineSession';
import {
  clearDoorBlocks,
  daylightFactor,
  formatGameplayKernelTrace,
  performUseHeld,
  tickGameplayKernel,
  type UseSimulationContext,
} from '../gameplay';
import { applyNetworkBlockChanges } from '../world/networkBlockUpdates';
import type { ServerMessage, ServerPlayerStateMessage, ServerWelcomeMessage } from '../../shared/protocol';
import { adaptiveJobBudgetMs, countInitialAreaProgress, initialAreaReady, lightContextReady, lightingHaloRadius, missingChunkCoords } from '../world/worldJobs';
import {
  collectReadyMeshJobs,
  discardObsoletePendingMesh,
  lightingUnlockNeighborKeys,
  pendingMeshInRadius,
  planMeshFrame,
} from '../world/streamingScheduler';
import { blockCollisionBoxes, rayAabbDistance } from '../world/collision';
import {
  defaultSlabType,
} from '../world/blockGeometry';
import { ExplosionQueue } from '../world/ExplosionQueue';
import { YandexGamesService } from '../yandex/YandexGamesService';

export interface GameSession {
  summary: WorldSummary;
  world: VoxelWorld;
  worldRenderer: WorldRenderer;
  player: PlayerController;
  survival: SurvivalSystem;
  combat: CombatSystem;
  inventory: Inventory;
  drops: DroppedItemManager;
  falling: FallingBlockManager;
  mobs: MobManager;
  arrows: PlayerArrowManager;
  minecarts: MinecartManager;
  entityHost: ThreeEntityHost;
  ridingCartId?: string;
  redstone: RedstoneSystem;
  activePressurePlates: Set<string>;
  selectedSlot: number;
  target?: VoxelHit;
  miningTarget?: string;
  miningProgress: number;
  foodUseTicks: number;
  bowUseTicks: number;
  playTicks: number;
  lastAutosaveTick: number;
  serverWorld?: SerializedServerWorld;
  online?: OnlineAnarchySession;
}

export interface OnlineAnarchySession {
  client: AnarchyClient;
  playerId: string;
  remotes: Map<string, RemotePlayerView>;
  interpolator: EntityInterpolationBuffer;
  inputSeq: number;
  lastViewKey?: string;
  lastStateTick: number;
  lastAliveTick?: number;
  motion: { target: { x: number; y: number; z: number } };
  pendingBlockAction?: { kind: 'break' | 'place'; x: number; y: number; z: number };
  rejectedBlockKey?: string;
}

interface RuntimeSettings {
  volume: number;
  sensitivity: number;
  renderDistance: number;
  fov: number;
}

const isCoarsePointer = (): boolean => matchMedia('(pointer: coarse)').matches;

function raycastRemotePlayers(
  remotes: Map<string, RemotePlayerView>,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
): { id: string; distance: number } | undefined {
  const half = PLAYER_WIDTH * 0.5;
  let closest: { id: string; distance: number } | undefined;
  for (const [id, view] of remotes) {
    const position = view.group.position;
    const hit = rayAabbDistance(origin, direction, {
      minX: position.x - half,
      maxX: position.x + half,
      minY: position.y,
      maxY: position.y + PLAYER_HEIGHT,
      minZ: position.z - half,
      maxZ: position.z + half,
    });
    if (!hit || hit.distance < 0 || hit.distance > maxDistance) continue;
    if (closest && hit.distance >= closest.distance) continue;
    closest = { id, distance: hit.distance };
  }
  return closest;
}

export class Game {
  private polishQaDispose?: () => void;
  private audioDebug?: HTMLPreElement;
  private audioDebugTimer?: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: GameUI;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 650);
  private readonly lifecycle = new GameLifecycleManager();
  private readonly audio = new AudioManager();
  private readonly saves = new SaveService();
  private readonly yandex = new YandexGamesService();
  private readonly input: InputManager;
  private readonly ambient = new THREE.HemisphereLight(0xb7d7f2, 0x1a1612, 0.38);
  private readonly sunlight = new THREE.DirectionalLight(0xffe2b3, 1.55);
  private readonly sun = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffed9b }));
  private readonly moon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xb9d4e5 }));
  private readonly interpolatedPlayerPosition = new THREE.Vector3();
  private readonly daySkyColor = new THREE.Color(0x7fb9dc);
  private readonly duskSkyColor = new THREE.Color(0xd9785a);
  private readonly nightSkyColor = new THREE.Color(0x071426);
  private readonly currentSkyColor = new THREE.Color(0x7fb6d5);
  private readonly firstPersonFrameState: FirstPersonFrameState = {
    visible: false,
    movementSpeed: 0,
    onGround: false,
    sprinting: false,
    mining: false,
    foodUseProgress: 0,
    bowCharge: 0,
    onFire: false,
    invisible: false,
    potionActive: false,
  };
  private atlas?: TextureAtlas;
  private itemVisuals?: ItemVisualFactory;
  private itemIcons?: ItemIconRenderer;
  private arrowVisuals?: ArrowVisualFactory;
  private firstPerson?: FirstPersonRenderer;
  private session?: GameSession;
  private readonly explosionQueue = new ExplosionQueue();
  private readonly miningSound = createMiningSoundState();
  private readonly footsteps = createFootstepState();
  private readonly explosionSounds = createExplosionLog();
  private openChestKey?: string;
  private lastConsumedArrow: string | undefined;
  private minecartDismountHeld = false;
  private settings: RuntimeSettings = {
    volume: 0.7,
    sensitivity: 0.0022,
    renderDistance: isCoarsePointer() ? DEFAULT_RENDER_DISTANCE_MOBILE : DEFAULT_RENDER_DISTANCE_DESKTOP,
    fov: 75,
  };
  private accumulator = 0;
  private previousTime = performance.now();
  private frameHandle = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private readonly frameTimings = new RollingTimingWindow(600);
  private readonly tickTimings = new RollingTimingWindow(200);
  private lastChunkGenerationJobs = 0;
  private lastChunkMeshJobs = 0;
  private debugVisible = false;
  private debugNextTick = 0;
  private cachedDebugText = '';
  private readonly debugTickOrder: boolean;
  private readonly kernelTrace: string[] = [];
  private screenBeforeSettings: 'main' | 'pause' = 'main';
  private lastSavePromise: Promise<void> = Promise.resolve();
  private deathShown = false;
  private readonly chat = new ChatLog();
  private readonly hurt = new HurtFeedback();
  private readonly profiler = new DevProfiler(isPerfQueryEnabled());
  private readonly perfScenario = readPerfScenario();
  private worldLoad?: {
    centerX: number;
    centerZ: number;
    radius: number;
    generateRadius: number;
    phase: WorldLoadPhase;
    generateTotal: number;
    generated: number;
    lit: number;
    meshed: number;
    error?: string;
    warmedUp: boolean;
    snapSpawn: boolean;
  };
  private lastLoadPercent = 0;
  private lastEntityUpdateMs = 0;
  private lastGenerateMs = 0;
  private lastLightMs = 0;
  private lastMeshMs = 0;
  private readonly chunkGrid = new ChunkGridOverlay();
  private chunkGridVisible = isChunkOverlayQueryEnabled();
  private lightDebugMode = 0;
  private jobFrame: JobFrameCounters = emptyJobFrameCounters();
  private readonly streamingTrace = new ChunkStreamingTrace();
  private inspectFreeze: InspectFreeze | null = null;
  private inspectorHud = '';
  private lastInspectorAt = 0;
  private overlayRevision = 0;
  private overlayCategories = new Map<string, ChunkDebugCategory>();
  private slowSnapshots: SlowChunkSnapshot[] = [];
  private readonly slowArmed = new Set<string>();
  private lastMeshActiveKey: string | null = null;
  private lastFrontTarget: { cx: number; cz: number } | null = null;
  private genWithoutMeshStreak = 0;
  private lastStreamChunkX = Number.NaN;
  private lastStreamChunkZ = Number.NaN;
  private readonly simParts = { player: 0, mobs: 0, world: 0, combat: 0, entities: 0, other: 0 };
  private lastSimParts = { player: 0, mobs: 0, world: 0, combat: 0, entities: 0, other: 0, ticks: 0 };
  private readonly litToMeshWaits = new RollingTimingWindow(64);
  private readonly requestToVisibleWaits = new RollingTimingWindow(64);
  private readonly generatedToVisibleWaits = new RollingTimingWindow(64);
  private readonly meshDurations = new RollingTimingWindow(64);
  private readonly wantedToVisibleWaits = new RollingTimingWindow(64);
  private readonly readyWantedToMeshWaits = new RollingTimingWindow(64);
  private lastReadyMeshWaitWarn: { cx: number; cz: number; waitMs: number; atMs: number } | null = null;
  private lastInspectMeshWanted = new Set<string>();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.canvas.tabIndex = 0;
    this.debugTickOrder = typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('debugTick') === '1';
    this.ui = new GameUI(uiRoot);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isCoarsePointer(), powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Two render passes share one frame; reset once so F3 counts world + viewmodel.
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarsePointer() ? 1.4 : 2));
    this.scene.background = this.currentSkyColor;
    this.scene.fog = new THREE.Fog(0x7fb6d5, 38, this.settings.renderDistance * 16 + 28);
    this.ambient.intensity = 0.22;
    this.sunlight.intensity = 1.35;
    this.sunlight.position.set(40, 70, 25);
    this.scene.add(this.ambient, this.sunlight, this.sun, this.moon);
    this.scene.add(this.chunkGrid.group);
    this.chunkGrid.setVisible(this.chunkGridVisible);

    this.input = new InputManager(this.canvas, {
      canCapture: () => this.lifecycle.state === 'PLAYING' && !this.ui.isBlockingOverlay(),
      toggleInventory: () => this.toggleInventory(),
      togglePause: () => this.togglePause(),
      openChat: (prefix) => this.openChat(prefix),
      dropItem: () => this.dropSelectedItem(),
      selectHotbar: (index) => this.selectHotbar(index),
      onPointerLockAcquired: () => {
        this.lifecycle.resumePlayingIfVisible();
        this.lifecycle.endOnlineRespawnRestore();
        this.ui.hidePointerLockFallback();
      },
      onPointerLockReleased: (reason) => this.handlePointerUnlock(reason),
      onPointerLockRequestFailed: () => {
        this.lifecycle.endOnlineRespawnRestore();
        this.showPointerLockFallbackIfNeeded();
      },
      isChatOpen: () => this.ui.isChatOpen(),
    });
    this.lifecycle.setBlurContext(() => ({
      pointerLocked: this.input.isPointerLocked(),
      pointerLockRequestPending: this.input.isLockRequestPending(),
    }));
    this.ui.onHotbarSelect = (index) => this.selectHotbar(index);
    this.ui.onChatSubmit = (line) => this.submitChat(line);
    this.ui.onChatCancel = () => this.closeChatAndResumeLook();
    this.canvas.addEventListener('click', () => {
      this.lifecycle.resumePlayingIfVisible();
      this.canvas.focus({ preventScroll: true });
    });
    this.bindLifecycle();
    this.bindWindowEvents();
  }

  async initialize(): Promise<void> {
    this.ui.showLoading('Загружаем текстуры и сохранения…');
    this.resize();
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
    await Promise.all([
      this.saves.initialize().catch((error) => console.warn('IndexedDB unavailable, saves remain in memory.', error)),
      this.yandex.initialize(
        () => this.pauseForPlatform(),
        () => this.resumeFromPlatform(),
      ),
      TextureAtlas.create(Math.min(
        this.renderer.capabilities.getMaxAnisotropy(),
        isCoarsePointer() ? 4 : 8,
      )).then((atlas) => { this.atlas = atlas; }),
      this.audio.preload(),
    ]);
    this.audio.setVolume(this.settings.volume);
    this.mountAudioDebug();
    this.itemVisuals = new ItemVisualFactory({ atlas: this.atlas });
    await this.itemVisuals.preload();
    this.itemIcons = new ItemIconRenderer(this.renderer, this.itemVisuals);
    this.itemIcons.bake();
    this.ui.setItemIconResolver((itemId) => this.itemIcons!.url(itemId));
    this.arrowVisuals = new ArrowVisualFactory();
    this.firstPerson = new FirstPersonRenderer(this.itemVisuals);
    this.resize();
    this.showMainMenu();
    await this.yandex.loadingReady();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.input.disposeDebug();
    this.disposeAudioDebug();
    this.disposeSession();
    this.firstPerson?.dispose();
    this.itemVisuals?.dispose();
    this.itemIcons?.dispose();
    this.arrowVisuals?.dispose();
    this.atlas?.dispose();
    this.renderer.dispose();
    this.saves.close();
    this.yandex.dispose();
    this.profiler.dispose();
  }

  private showMainMenu(): void {
    this.lifecycle.setState('MENU');
    this.ui.showMainMenu({
      singleplayer: () => void this.showWorldList(),
      online: () => void this.showOnlineServerList(),
      settings: () => {
        this.screenBeforeSettings = 'main';
        this.showSettings();
      },
    });
  }

  private async showOnlineServerList(): Promise<void> {
    const live = await fetchAnarchyStatus();
    this.ui.showOnlineServers({
      back: () => this.showMainMenu(),
      connect: (id) => void this.connectOnlineServer(id),
    }, live);
  }

  private async connectOnlineServer(id: string): Promise<void> {
    if (id !== ANARCHY_SERVER_ID) {
      this.ui.toast('Этот сервер пока недоступен');
      return;
    }
    this.ui.showLoading('Подключение к серверу…', 12, 'localhost');
    const client = new AnarchyClient();
    try {
      const welcome = await client.connect();
      await this.startOnlineAnarchy(client, welcome);
    } catch {
      client.disconnect();
      this.ui.toast('Сервер недоступен');
      await this.showOnlineServerList();
    }
  }

  private async startOnlineAnarchy(client: AnarchyClient, welcome: ServerWelcomeMessage): Promise<void> {
    const world = new VoxelWorld(welcome.seed);
    world.deferredLighting = true;
    world.restore({
      timeOfDay: welcome.timeOfDay,
      modifications: welcome.modifications,
      chests: {},
      furnaces: {},
      blockStates: welcome.blockStates,
    });
    let inventory: Inventory;
    try {
      inventory = Inventory.deserialize(welcome.inventory);
    } catch {
      inventory = new Inventory();
    }
    const summary = {
      ...createAnarchySummary(),
      seed: welcome.seed,
      mode: welcome.you.gamemode,
    };
    const remotes = new Map<string, RemotePlayerView>();
    await this.startSession(summary, world, inventory, undefined, {
      spawn: [welcome.you.x, welcome.you.y, welcome.you.z],
      snapSpawn: false,
      serverWorld: createCanonicalAnarchyServerWorld(welcome.spawn),
      online: {
        client,
        playerId: welcome.playerId,
        remotes,
        interpolator: new EntityInterpolationBuffer(),
        inputSeq: 0,
        lastStateTick: -1,
        motion: { target: { x: welcome.you.x, y: welcome.you.y, z: welcome.you.z } },
      },
    });
    const session = this.session;
    if (!session?.online) return;
    session.player.teleport([welcome.you.x, welcome.you.y, welcome.you.z]);
    session.player.yaw = welcome.you.yaw;
    session.player.pitch = welcome.you.pitch;
    this.input.yaw = welcome.you.yaw;
    this.input.pitch = welcome.you.pitch;
    for (const info of welcome.players) {
      this.spawnRemotePlayer(session, info);
    }
    client.onMessage((message) => {
      if (!shouldHandleOnlineClientEvent(this.session?.online?.client, client)) return;
      this.handleOnlineMessage(message);
    });
    client.onDisconnect(() => {
      if (!shouldHandleOnlineClientEvent(this.session?.online?.client, client)) return;
      this.ui.toast('Сервер недоступен');
      this.disposeSession();
      this.showMainMenu();
    });
  }

  private spawnRemotePlayer(session: GameSession, info: { id: string; name: string; x: number; y: number; z: number; yaw: number; pitch: number }): void {
    if (!session.online || info.id === session.online.playerId || session.online.remotes.has(info.id)) return;
    const view = new RemotePlayerView(info);
    session.online.remotes.set(info.id, view);
    this.scene.add(view.group);
  }

  private removeRemotePlayer(session: GameSession, playerId: string): void {
    const view = session.online?.remotes.get(playerId);
    if (!view) return;
    this.scene.remove(view.group);
    view.dispose();
    session.online?.remotes.delete(playerId);
  }

  private handleOnlineMessage(message: ServerMessage): void {
    const session = this.session;
    if (!session?.online) return;
    switch (message.type) {
      case 'welcome':
        return;
      case 'player_joined':
        this.spawnRemotePlayer(session, message.player);
        return;
      case 'player_left':
        this.removeRemotePlayer(session, message.playerId);
        return;
      case 'player_state':
        this.applyOnlinePlayerState(session, message);
        return;
      case 'block_update': {
        const previous = session.world.getBlock(message.x, message.y, message.z, false);
        applyNetworkBlockChanges(session.world, [{
          x: message.x,
          y: message.y,
          z: message.z,
          blockId: message.blockId,
          ...(message.state ? { state: message.state } : {}),
        }]);
        this.clearOnlineBlockPending(session, message.x, message.y, message.z);
        if (message.blockId === BlockId.Air) {
          this.playBlockSound('break', previous, message.x, message.y, message.z);
        } else {
          this.playBlockSound('place', message.blockId as BlockId, message.x, message.y, message.z);
        }
        return;
      }
      case 'block_batch': {
        applyNetworkBlockChanges(session.world, message.changes);
        for (const change of message.changes) {
          this.clearOnlineBlockPending(session, change.x, change.y, change.z);
        }
        return;
      }
      case 'entity_snapshot':
        applyEntitySnapshots(session, message.entities, {
          interpolator: session.online.interpolator,
          tick: message.tick,
          now: performance.now(),
        });
        return;
      case 'entity_event':
        applyNetworkEntityEvents(session, message.events);
        return;
      case 'health': {
        const previous = {
          health: session.survival.health,
          dead: session.survival.dead,
        };
        session.survival.restore({
          health: message.health,
          hunger: message.hunger,
          saturation: message.saturation,
          absorption: message.absorption,
          airTicks: message.air,
          dead: message.dead,
        });
        if (shouldRestoreGameplayAfterRespawn(previous, {
          health: session.survival.health,
          dead: session.survival.dead,
        })) {
          this.restoreOnlinePlayingFromRespawn();
          if (session.online) {
            session.online.lastAliveTick = recordAliveSnapshotTick(
              session.online.lastAliveTick,
              session.online.lastStateTick,
            );
          }
        }
        if (message.health < previous.health - 0.01) {
          this.hurt.trigger(performance.now(), { periodic: false });
          this.playLocal('player.hurt');
        }
        this.refreshHud();
        return;
      }
      case 'effects':
        session.survival.restore({
          effects: message.effects.map((effect) => ({
            id: effect.id as 'invisibility' | 'regeneration' | 'absorption',
            amplifier: effect.amplifier,
            ticks: effect.remainingTicks,
          })),
        });
        this.refreshHud();
        return;
      case 'time':
        session.world.timeOfDay = message.timeOfDay;
        return;
      case 'command_result':
        return;
      case 'block_result':
        this.handleOnlineBlockResult(session, message);
        return;
      case 'chunk_data':
        session.world.getChunk(message.cx, message.cz, true);
        return;
      case 'chat':
        if (message.kind === 'player') this.pushChat('player', `<${message.from}> ${message.text}`);
        else this.pushChat(message.kind === 'error' ? 'error' : message.kind === 'command' ? 'command' : 'system', message.text);
        return;
      case 'inventory':
        try {
          session.inventory.restore(Inventory.deserialize(message.inventory).serialize());
        } catch {
          /* keep local copy until next valid snapshot */
        }
        if (message.gamemode !== session.summary.mode) {
          session.summary.mode = message.gamemode;
          session.player.creativeFlightAllowed = message.gamemode === 'creative';
        }
        if (message.selectedSlot !== undefined) session.selectedSlot = message.selectedSlot;
        this.ui.applyAuthoritativeCursor(this.parseOnlineStack(message.cursor), this.parseOnlineStacks(message.craftSlots));
        if (message.window?.kind && message.window.kind !== 'inventory' && !this.ui.isInventoryOpen()) {
          this.openOnlineContainer(session, message.window.kind, message.window);
        }
        this.refreshHud();
        return;
      case 'error':
        this.ui.toast(message.message);
        return;
      case 'pong':
      case 'status':
        return;
      default:
        return;
    }
  }

  private parseOnlineStack(value: unknown): ItemStack | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as { itemId?: unknown; count?: unknown };
    if (typeof record.itemId !== 'string' || typeof record.count !== 'number') return null;
    try {
      return createItemStack(record.itemId, record.count);
    } catch {
      return null;
    }
  }

  private parseOnlineStacks(value: unknown): Array<ItemStack | null> | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.map((entry) => this.parseOnlineStack(entry));
  }

  private openOnlineContainer(
    session: GameSession,
    kind: 'crafting-table' | 'chest' | 'furnace',
    window: { readonly x?: number; readonly y?: number; readonly z?: number; readonly slots?: unknown },
  ): void {
    const x = window.x ?? 0;
    const y = window.y ?? 0;
    const z = window.z ?? 0;
    if (kind === 'chest' && Array.isArray(window.slots)) {
      const chest = session.world.getChest(x, y, z);
      chest.slots = window.slots.map((entry) => this.parseOnlineStack(entry));
    }
    if (kind === 'furnace' && Array.isArray(window.slots)) {
      const furnace = session.world.getFurnace(x, y, z);
      const parsed = window.slots.map((entry) => this.parseOnlineStack(entry));
      furnace.slots = [parsed[0] ?? null, parsed[1] ?? null, parsed[2] ?? null];
    }
    this.openBlockInventory(kind, {
      x, y, z,
      block: kind === 'chest' ? BlockId.Chest : kind === 'furnace' ? BlockId.Furnace : BlockId.CraftingTable,
      normal: new THREE.Vector3(0, 1, 0),
      distance: 0,
      point: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
    });
  }

  private applyOnlinePlayerState(session: GameSession, message: ServerPlayerStateMessage): void {
    const online = session.online;
    if (!online) return;
    if (!shouldAcceptSnapshot(online.lastStateTick, message.tick)) return;
    online.lastStateTick = message.tick;
    const { local, remotes } = splitPlayerSnapshots(online.playerId, message.players);
    const seen = new Set<string>();
    if (local) {
      const look = clientLookAfterSnapshot(
        { yaw: this.input.yaw, pitch: this.input.pitch },
        { yaw: local.yaw, pitch: local.pitch },
      );
      this.input.yaw = look.yaw;
      this.input.pitch = look.pitch;
      session.player.yaw = look.yaw;
      session.player.pitch = look.pitch;
      const ingested = ingestAuthoritativePosition(session.player.position, local);
      online.motion.target = ingested.target;
      if (ingested.snapped) {
        session.player.position.set(ingested.position.x, ingested.position.y, ingested.position.z);
        session.player.previousPosition.copy(session.player.position);
      }
      session.player.velocity.set(local.vx, local.vy, local.vz);
      session.player.sneaking = local.sneaking;
      session.player.sprinting = local.sprinting;
      session.player.onGround = local.onGround;
      const previousLife = { health: session.survival.health, dead: session.survival.dead };
      const snapshotDead = local.dead ?? local.health <= 0;
      if (!shouldIgnoreStaleDeadSnapshot({
        snapshotTick: message.tick,
        lastAliveTick: online.lastAliveTick,
        dead: snapshotDead,
      })) {
        session.survival.restore({
          health: local.health,
          hunger: local.hunger,
          dead: snapshotDead,
        });
        if (shouldRestoreGameplayAfterRespawn(previousLife, {
          health: session.survival.health,
          dead: session.survival.dead,
        })) {
          this.restoreOnlinePlayingFromRespawn();
        }
        if (!snapshotDead && local.health > 0) {
          online.lastAliveTick = recordAliveSnapshotTick(online.lastAliveTick, message.tick);
        }
      }
      session.ridingCartId = local.ridingEntityId;
      if (local.invisible) {
        /* local first-person hide is driven by survival effects */
      }
      if (local.gamemode !== session.summary.mode) {
        session.summary.mode = local.gamemode;
        session.player.creativeFlightAllowed = local.gamemode === 'creative';
      }
    }
    for (const snap of remotes) {
      seen.add(snap.id);
      let remote = online.remotes.get(snap.id);
      if (!remote) {
        this.spawnRemotePlayer(session, snap);
        remote = online.remotes.get(snap.id);
      }
      remote?.applySnapshot(snap, performance.now(), message.tick);
      if (remote) remote.group.visible = snap.invisible !== true;
    }
    for (const id of [...online.remotes.keys()]) {
      if (!seen.has(id)) this.removeRemotePlayer(session, id);
    }
  }

  private handleOnlineBlockResult(
    session: GameSession,
    message: Extract<ServerMessage, { type: 'block_result' }>,
  ): void {
    this.clearOnlineBlockPending(session, message.x, message.y, message.z);
    if (message.ok) return;
    const key = `${message.x},${message.y},${message.z}`;
    if (session.online) session.online.rejectedBlockKey = key;
    console.warn(
      `[anarchy] ${message.action} rejected: ${message.reason ?? 'unknown'} at ${key}`,
    );
  }

  private clearOnlineBlockPending(session: GameSession, x: number, y: number, z: number): void {
    const online = session.online;
    if (!online?.pendingBlockAction) return;
    const pending = online.pendingBlockAction;
    if (pending.x !== x || pending.y !== y || pending.z !== z) return;
    online.pendingBlockAction = undefined;
  }

  private stepOnlineAuthority(session: GameSession, dt: number): void {
    const online = session.online;
    if (!online) return;
    session.player.yaw = this.input.yaw;
    session.player.pitch = this.input.pitch;
    const next = stepTowardTarget(session.player.position, online.motion.target, dt);
    session.player.position.set(next.x, next.y, next.z);
    session.player.previousPosition.copy(session.player.position);
  }

  private sendOnlineIdle(session: GameSession): void {
    const online = session.online;
    if (!online) return;
    online.inputSeq += 1;
    online.client.send({
      type: 'input',
      seq: online.inputSeq,
      forward: 0,
      right: 0,
      jump: false,
      sneak: false,
      sprint: false,
      descend: false,
      flySprint: false,
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      selectedSlot: session.selectedSlot,
    });
  }

  private async openAnarchyWorld(): Promise<void> {
    this.ui.showLoading('Открываем Анархию…', 8, 'Локальный мир сервера');
    const existing = await this.saves.loadWorld(ANARCHY_WORLD_ID);
    const startup = resolveAnarchyStartup(existing);

    if (startup.action === 'restore') {
      const state = startup.state;
      const world = new VoxelWorld(state.summary.seed);
      world.deferredLighting = true;
      world.restore(state);
      let inventory: Inventory;
      let bucketOverflow: ItemStack[] = [];
      try {
        const restored = restoreBucketInventory(state.player.inventory);
        inventory = restored.inventory;
        bucketOverflow = restored.overflow;
      } catch (error) {
        console.warn('Anarchy inventory save was invalid; starting empty.', error);
        inventory = new Inventory();
      }
      await this.startSession(state.summary, world, inventory, state, {
        snapSpawn: false,
        serverWorld: createCanonicalAnarchyServerWorld(startup.spawn, state.serverWorld),
      });
      for (const stack of bucketOverflow) this.spawnDroppedStack(stack);
      return;
    }

    const summary = createAnarchySummary();
    const world = new VoxelWorld(summary.seed);
    world.deferredLighting = true;
    const inventory = new Inventory();
    inventory.addItem('apple', 3);
    const spawn = this.estimateSpawn(world);
    await this.startSession(summary, world, inventory, undefined, {
      spawn,
      snapSpawn: true,
      serverWorld: createCanonicalAnarchyServerWorld(spawn),
    });
    await this.saveSession();
  }

  private async showWorldList(): Promise<void> {
    const worlds = await this.saves.listWorlds();
    this.ui.showWorldList(worlds, {
      load: (id) => void this.loadWorld(id),
      create: () => this.ui.showCreateWorld({
        create: (name, seed, mode) => void this.createWorld(name, seed, mode),
        back: () => void this.showWorldList(),
      }),
      delete: async (id) => {
        await this.saves.deleteWorld(id);
        await this.showWorldList();
      },
      back: () => this.showMainMenu(),
    });
  }

  private async createWorld(name: string, seed: string, mode: GameMode): Promise<void> {
    const summary = this.saves.createSummary(name, seed, mode);
    const world = new VoxelWorld(summary.seed);
    world.deferredLighting = true;
    const inventory = new Inventory();
    if (mode === 'survival') inventory.addItem('apple', 3);
    await this.startSession(summary, world, inventory);
    await this.saveSession();
  }

  private async loadWorld(id: string): Promise<void> {
    this.ui.showLoading('Читаем сохранённый мир…');
    const state = await this.saves.loadWorld(id);
    if (!state) {
      this.ui.toast('Сохранение не найдено');
      await this.showWorldList();
      return;
    }
    const world = new VoxelWorld(state.summary.seed);
    world.deferredLighting = true;
    world.restore(state);
    let inventory: Inventory;
    let bucketOverflow: ItemStack[] = [];
    try {
      const restored = restoreBucketInventory(state.player.inventory);
      inventory = restored.inventory;
      bucketOverflow = restored.overflow;
    } catch (error) {
      console.warn('Inventory save was invalid; starting with an empty inventory.', error);
      inventory = new Inventory();
    }
    await this.startSession(state.summary, world, inventory, state);
    for (const stack of bucketOverflow) this.spawnDroppedStack(stack);
  }

  private async startSession(
    summary: WorldSummary,
    world: VoxelWorld,
    inventory: Inventory,
    restored?: SerializedWorldState,
    options?: {
      spawn?: [number, number, number];
      snapSpawn?: boolean;
      serverWorld?: SerializedServerWorld;
      online?: OnlineAnarchySession;
    },
  ): Promise<void> {
    this.disposeSession();
    this.ui.showLoading(restored ? 'Восстанавливаем чанки…' : 'Генерируем новый мир…');
    const atlas = this.atlas;
    if (!atlas) throw new Error('Texture atlas is not ready.');
    const itemVisuals = this.itemVisuals;
    if (!itemVisuals) throw new Error('Item visual factory is not ready.');
    const arrowVisuals = this.arrowVisuals;
    if (!arrowVisuals) throw new Error('Arrow visual factory is not ready.');

    const player = new PlayerController();
    const spawn = restored?.player.position ?? options?.spawn ?? this.estimateSpawn(world);
    player.teleport(spawn);
    if (restored) {
      player.restore({
        position: restored.player.position,
        velocity: restored.player.velocity,
        yaw: restored.player.yaw,
        pitch: restored.player.pitch,
      });
      this.input.yaw = restored.player.yaw;
      this.input.pitch = restored.player.pitch;
    } else {
      this.input.yaw = 0;
      this.input.pitch = 0;
    }

    const survival = new SurvivalSystem({
      health: restored?.player.health ?? 20,
      hunger: restored?.player.hunger ?? 20,
      saturation: restored?.player.saturation ?? 5,
      isSwordBlocking: () => this.session?.combat.swordBlocking ?? false,
      onDamage: (result) => this.onPlayerDamaged(result),
      onDeath: (source) => this.handleDeath(source),
    });
    const savedServerSpawn = restored?.serverWorld?.spawn ?? options?.serverWorld?.spawn;
    survival.setSpawnPoint(
      isFiniteSpawn(savedServerSpawn)
        ? [savedServerSpawn[0], savedServerSpawn[1], savedServerSpawn[2]]
        : restored?.player.spawnPoint ?? spawn,
    );
    if (restored && (restored.player.absorption !== undefined || restored.player.absorptionTicks !== undefined)) {
      survival.restore({
        health: survival.health,
        hunger: survival.hunger,
        saturation: survival.saturation,
        exhaustion: survival.exhaustion,
        absorption: restored.player.absorption ?? 0,
        absorptionTicks: restored.player.absorptionTicks,
        airTicks: survival.airTicks,
        fireTicks: survival.fireTicks,
        dead: survival.dead,
        spawnPoint: [...survival.spawnPoint],
      });
    }
    const redstone = new RedstoneSystem(world, {
      root: this.scene,
      onSourceChanged: (x, _y, z) => world.markBlockDirty(x, z),
    });
    const activePressurePlates = new Set<string>();
    if (restored?.redstone) {
      try {
        const redstoneState = restored.redstone as SerializedRedstoneState;
        redstone.restore(redstoneState);
        for (const source of redstoneState.sources) {
          if (source.kind === 'pressure_plate' && source.active) {
            activePressurePlates.add(blockKey(...source.position));
          }
        }
      } catch (error) {
        console.warn('Redstone save was invalid; resetting redstone runtime state.', error);
        redstone.clear();
        activePressurePlates.clear();
      }
    }
    const worldRenderer = new WorldRenderer(
      world,
      atlas,
      (x, y, z) => {
        const worldState = world.getBlockState(x, y, z);
        const redstoneState = redstone.getBlockRenderState(x, y, z);
        if (!worldState && !redstoneState) return undefined;
        return { ...worldState, ...redstoneState };
      },
    );
    this.scene.add(worldRenderer.group);
    const entityHost = new ThreeEntityHost(this.scene, {
      itemVisuals,
      arrowVisuals,
      ownsItemVisuals: false,
      ownsArrowVisuals: false,
    });
    const drops = new DroppedItemManager(entityHost, world, {
      onPickup: (stack) => {
        const remainder = inventory.add(stack as ItemStack);
        const accepted = stack.count - (remainder?.count ?? 0);
        if (accepted > 0) {
          this.playLocal('item.pickup');
          this.ui.toast(`Подобрано: ${getItemDefinition(stack.itemId).name}`);
        }
        return accepted;
      },
    });
    if (restored?.droppedItems) drops.restore(restored.droppedItems as SerializedDroppedItem[]);
    const falling = new FallingBlockManager(entityHost, world);
    if (restored?.fallingBlocks) {
      falling.restore(restored.fallingBlocks as SerializedFallingBlock[]);
    }

    const selectedSlot = clamp(restored?.player.selectedSlot ?? 0, 0, 8);
    const mobs = new MobManager(entityHost, world, {
      maxMobs: isCoarsePointer() ? 24 : 40,
      passiveCap: isCoarsePointer() ? 10 : 16,
      hostileCap: isCoarsePointer() ? 14 : 24,
      maxProjectiles: isCoarsePointer() ? 20 : 40,
      automaticSpawning: !options?.online,
      onArrowBlockHit: (x, y, z) => this.playWorld('arrow.hit', x + 0.5, y + 0.5, z + 0.5),
    });
    if (restored?.mobs) mobs.restore(restored.mobs as SerializedMob[]);
    const combat = new CombatSystem({
      heldItemId: inventory.getSlot(selectedSlot)?.itemId,
      offhandItemId: inventory.offhand?.itemId,
    });
    const minecarts = new MinecartManager(entityHost, world);
    if (restored?.minecarts) minecarts.restore(restored.minecarts as SerializedMinecart[]);
    const arrows = new PlayerArrowManager(entityHost, world, mobs, {
      minecarts,
      onBlockHit: (x, y, z, flaming) => {
        const session = this.session;
        this.playWorld('arrow.hit', x + 0.5, y + 0.5, z + 0.5);
        if (!session || !flaming) return;
        if (flamingArrowBlockHit(session.world.getBlock(x, y, z, false)) === 'prime_tnt') {
          session.redstone.primeTnt(x, y, z);
        }
      },
      onMobHit: (accepted, position) => {
        if (accepted) this.playWorld('combat.hit', position.x, position.y + 0.9, position.z);
      },
      onMinecartHit: (cart, flaming) => {
        const session = this.session;
        if (!session || !flaming) return;
        if (cart.variant === 'tnt') session.minecarts.explodeNow(cart);
      },
    });

    this.session = {
      summary,
      world,
      worldRenderer,
      player,
      survival,
      combat,
      inventory,
      drops,
      falling,
      mobs,
      arrows,
      minecarts,
      entityHost,
      redstone,
      activePressurePlates,
      selectedSlot,
      miningProgress: 0,
      foodUseTicks: 0,
      bowUseTicks: 0,
      playTicks: Math.floor(summary.playTimeSeconds * TICK_RATE),
      lastAutosaveTick: 0,
      serverWorld: restored?.serverWorld ?? options?.serverWorld,
      online: options?.online,
    };
    this.canvas.dataset.hotbar = String(this.session.selectedSlot);
    this.firstPerson?.setHeldItems(
      inventory.getSlot(this.session.selectedSlot)?.itemId,
    );
    this.deathShown = false;
    this.beginWorldLoading(options?.snapSpawn ?? !restored);
  }

  private estimateSpawn(world: VoxelWorld): [number, number, number] {
    return estimateWorldSpawn(world);
  }

  private snapPlayerToTerrain(): void {
    const session = this.session;
    if (!session) return;
    const originX = Math.floor(session.player.position.x);
    const originZ = Math.floor(session.player.position.z);
    const tryColumn = (x: number, z: number): boolean => {
      const column = session.world.generator.columnAt(x, z);
      if (column.biome === 'desert' || column.height <= SEA_LEVEL) return false;
      const surface = session.world.surfaceY(x, z);
      const floor = session.world.getBlock(x, surface, z);
      if (floor !== BlockId.GrassBlock) return false;
      if (session.world.isSolid(x, surface + 1, z) || session.world.isSolid(x, surface + 2, z)) return false;
      session.player.teleport([x + 0.5, surface + 1.01, z + 0.5]);
      return true;
    };
    if (tryColumn(originX, originZ)) return;
    for (let radius = 1; radius <= 24; radius += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
          if (tryColumn(originX + x, originZ + z)) return;
        }
      }
    }
  }

  private beginWorldLoading(snapSpawn = false): void {
    const session = this.session;
    if (!session) return;
    const meshRadius = initialReadyChunkRadius(this.settings.renderDistance);
    const generateRadius = lightingHaloRadius(meshRadius);
    this.worldLoad = {
      centerX: Math.floor(session.player.position.x),
      centerZ: Math.floor(session.player.position.z),
      radius: meshRadius,
      generateRadius,
      phase: 'generate',
      generateTotal: chunksInSquareRadius(generateRadius),
      generated: 0,
      lit: 0,
      meshed: 0,
      warmedUp: false,
      snapSpawn,
    };
    this.lastLoadPercent = 8;
    this.lifecycle.setState('LOADING_WORLD');
    this.ui.showLoading('Загрузка мира', this.lastLoadPercent, 'Подготовка мира…');
    this.input.releasePointerLock();
  }

  private processWorldLoading(frameStart: number): void {
    const session = this.session;
    const load = this.worldLoad;
    if (!session || !load) return;
    try {
      this.processWorldJobs(frameStart, true);
      const progress = countInitialAreaProgress(
        session.world,
        (key) => session.worldRenderer.hasChunk(key),
        load.centerX,
        load.centerZ,
        load.radius,
        load.generateRadius,
      );
      load.generated = progress.generated;
      load.lit = progress.lit;
      load.meshed = progress.meshed;
      const ready = initialAreaReady(
        session.world,
        (key) => session.worldRenderer.hasChunk(key),
        load.centerX,
        load.centerZ,
        load.radius,
        load.generateRadius,
      );
      if (ready && !load.warmedUp) {
        load.phase = 'warmup';
        this.warmupRenderer();
        load.warmedUp = true;
      } else if (ready && load.warmedUp) {
        load.phase = 'ready';
      } else if (session.world.unlitChunkCount > 0 && load.generated >= load.generateTotal) {
        load.phase = 'light';
      } else if (load.generated >= load.generateTotal) {
        load.phase = 'mesh';
      } else load.phase = 'generate';

      const snapshot: WorldLoadSnapshot = {
        phase: load.phase,
        generated: load.generated,
        generateTotal: load.generateTotal,
        lit: Math.max(0, load.lit),
        litTotal: load.generateTotal,
        meshed: load.meshed,
        meshTotal: chunksInSquareRadius(load.radius),
        error: load.error,
      };
      this.lastLoadPercent = load.phase === 'ready'
        ? 100
        : monotonicPercent(this.lastLoadPercent, worldLoadPercent(snapshot));
      const view = worldLoadView(snapshot, this.lastLoadPercent);
      this.ui.updateWorldLoading(view.label, view.percent, view.detail);
      if (load.phase === 'ready') {
        if (load.snapSpawn) this.snapPlayerToTerrain();
        this.worldLoad = undefined;
        this.enterPlaying();
        this.maybeRunPerfScenario();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('World loading failed.', error);
      load.phase = 'error';
      load.error = message;
      this.worldLoad = undefined;
      this.lifecycle.setState('MENU');
      this.ui.showWorldLoadError(message, () => void this.showWorldList());
    }
  }

  private warmupRenderer(): void {
    const session = this.session;
    if (!session) return;
    this.camera.position.set(
      session.player.position.x,
      session.player.position.y + session.player.eyeHeight,
      session.player.position.z,
    );
    applyImmediateRenderLook(this.camera, this.input);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  private processWorldJobs(frameStart: number, loading: boolean): void {
    const session = this.session;
    if (!session) return;
    const originX = loading ? this.worldLoad?.centerX ?? session.player.position.x : session.player.position.x;
    const originZ = loading ? this.worldLoad?.centerZ ?? session.player.position.z : session.player.position.z;
    const meshRadius = loading
      ? this.worldLoad?.radius ?? this.settings.renderDistance
      : this.settings.renderDistance;
    const generateRadius = loading
      ? this.worldLoad?.generateRadius ?? lightingHaloRadius(meshRadius)
      : lightingHaloRadius(meshRadius);
    session.world.setViewCenter(originX, originZ, meshRadius);
    this.jobFrame = emptyJobFrameCounters();
    this.lastMeshActiveKey = null;
    const inspect = this.profiler.enabled;
    const inspectNow = inspect ? performance.now() : 0;
    const maxBudget = loading ? WORLD_LOADING_JOB_BUDGET_MS : WORLD_JOB_BUDGET_MS;
    const budget = adaptiveJobBudgetMs(
      performance.now() - frameStart,
      loading ? 12 : TARGET_FRAME_MS,
      maxBudget,
      loading ? 1 : 0.35,
    );
    if (budget <= 0 && !loading) {
      this.jobFrame.lightingOnlyDueToBudget = true;
      discardObsoletePendingMesh(session.world, originX, originZ, meshRadius);
      this.lastLightMs += this.runLightingJobs(session, WORLD_LIGHT_BUDGET_MS, originX, originZ, inspect, inspectNow);
      return;
    }
    const jobStart = performance.now();
    let generated = 0;
    let meshed = 0;

    const missing = missingChunkCoords(
      session.world,
      originX,
      originZ,
      generateRadius,
      lightingUnlockNeighborKeys(
        session.world,
        floorDiv(originX, 16),
        floorDiv(originZ, 16),
        meshRadius,
        generateRadius,
      ),
    );
    if (inspect) {
      for (const coord of missing) this.streamingTrace.mark('requested', coord.x, coord.z, inspectNow);
    }
    const generateLimit = loading ? 8 : 1;
    const generateBudget = Math.max(budget, loading ? 1 : 0);
    for (const coord of missing) {
      if (generated >= generateLimit) break;
      if (generateBudget > 0 && performance.now() - jobStart >= generateBudget) break;
      if (inspect) {
        this.jobFrame.genAttempted += 1;
        this.streamingTrace.mark('generationStarted', coord.x, coord.z, performance.now());
      }
      const genStart = performance.now();
      session.world.getChunk(coord.x, coord.z);
      this.lastGenerateMs += performance.now() - genStart;
      generated += 1;
      if (inspect) {
        this.jobFrame.genCompleted += 1;
        const doneAt = performance.now();
        this.streamingTrace.mark('generated', coord.x, coord.z, doneAt);
        this.streamingTrace.mark('meshQueued', coord.x, coord.z, doneAt);
      }
    }
    this.lastChunkGenerationJobs = generated;

    const lightBudget = loading ? WORLD_LOADING_LIGHT_BUDGET_MS : WORLD_LIGHT_BUDGET_MS;
    this.lastLightMs += this.runLightingJobs(session, lightBudget, originX, originZ, inspect, inspectNow);

    const playerCx = floorDiv(originX, 16);
    const playerCz = floorDiv(originZ, 16);
    const now = performance.now();
    if (inspect && (playerCx !== this.lastStreamChunkX || playerCz !== this.lastStreamChunkZ)) {
      this.syncInspectWantedPeriods(session, playerCx, playerCz, meshRadius, generateRadius, now);
    }
    this.lastStreamChunkX = playerCx;
    this.lastStreamChunkZ = playerCz;
    discardObsoletePendingMesh(session.world, originX, originZ, meshRadius);

    const velocity = session.player.velocity;
    const readyJobs = collectReadyMeshJobs(
      session.world,
      originX,
      originZ,
      meshRadius,
      now,
      velocity.x,
      velocity.z,
    );
    const defaultMeshLimit = loading ? 4 : (isCoarsePointer() ? 1 : 2);
    const plan = planMeshFrame({
      loading,
      generatedThisFrame: generated > 0,
      consecutiveGenWithoutMesh: this.genWithoutMeshStreak,
      readyJobs,
      defaultMeshLimit,
      frameElapsedMs: now - frameStart,
    });
    this.jobFrame.meshReady = plan.ready;
    this.jobFrame.meshUrgent = plan.urgent;
    this.jobFrame.meshOldestReadyAgeMs = plan.oldestReadyAgeMs;
    this.jobFrame.meshStarvationAvoided = plan.starvationAvoided;
    this.jobFrame.meshSkippedFrame = plan.skipMesh;
    this.jobFrame.meshSkippedDueToGenSeparation = !loading && generated > 0 && plan.skipMesh;

    if (plan.skipMesh || plan.meshLimit <= 0) {
      if (!loading && generated > 0) this.genWithoutMeshStreak += 1;
      else this.genWithoutMeshStreak = 0;
      this.lastChunkMeshJobs = 0;
      return;
    }

    const meshBudget = Math.max(0.5, (loading ? WORLD_LOADING_JOB_BUDGET_MS : WORLD_JOB_BUDGET_MS) - (performance.now() - jobStart));
    const meshStart = performance.now();
    const meshCounters = inspect ? { attempted: 0, completed: 0, skippedBlocked: 0 } : undefined;
    meshed = session.worldRenderer.rebuildDirty(
      plan.meshLimit,
      meshBudget,
      originX,
      originZ,
      {
        meshRadius,
        requireNeighborLight: true,
        counters: meshCounters,
        dirX: velocity.x,
        dirZ: velocity.z,
        onMeshStart: inspect
          ? (chunk) => {
            this.lastMeshActiveKey = inspectChunkKey(chunk.x, chunk.z);
            this.streamingTrace.mark('meshStarted', chunk.x, chunk.z, performance.now());
          }
          : undefined,
        onMeshComplete: (chunk) => {
          const doneAt = performance.now();
          if (inspect) {
            this.streamingTrace.mark('meshed', chunk.x, chunk.z, doneAt);
            this.streamingTrace.mark('visible', chunk.x, chunk.z, doneAt);
            const stamps = this.streamingTrace.timestamps(chunk.x, chunk.z);
            if (stamps.litAt !== undefined && stamps.meshStartedAt !== undefined) {
              this.litToMeshWaits.add(stamps.meshStartedAt - stamps.litAt);
            }
            if (stamps.meshStartedAt !== undefined) this.meshDurations.add(doneAt - stamps.meshStartedAt);
            if (stamps.requestedAt !== undefined) this.requestToVisibleWaits.add(doneAt - stamps.requestedAt);
            if (stamps.generatedAt !== undefined) this.generatedToVisibleWaits.add(doneAt - stamps.generatedAt);
            const wantedVisible = wantedToVisibleSampleMs(stamps, doneAt);
            if (wantedVisible !== null) this.wantedToVisibleWaits.add(wantedVisible);
            const readyWanted = readyWantedToMeshSampleMs(stamps);
            if (readyWanted !== null) this.readyWantedToMeshWaits.add(readyWanted);
          }
        },
      },
    );
    this.lastMeshMs += performance.now() - meshStart;
    this.lastChunkMeshJobs = meshed;
    this.genWithoutMeshStreak = meshed > 0 || generated === 0 ? 0 : this.genWithoutMeshStreak + 1;
    if (meshCounters) {
      this.jobFrame.meshAttempted = meshCounters.attempted;
      this.jobFrame.meshCompleted = meshCounters.completed;
      this.jobFrame.meshSkippedBlocked = meshCounters.skippedBlocked;
    }
  }

  private runLightingJobs(
    session: GameSession,
    budgetMs: number,
    originX: number,
    originZ: number,
    inspect: boolean,
    inspectNow: number,
  ): number {
    const beforeReady = inspect ? this.snapshotLitKeys(session) : undefined;
    const beforeActive = inspect ? this.snapshotLightingActiveKeys(session) : undefined;
    const counters = inspect ? { attempted: 0, completed: 0, yielded: 0, blocked: 0 } : undefined;
    if (inspect) {
      for (const chunk of session.world.chunks.values()) {
        if (!chunk.lightingReady) this.streamingTrace.mark('lightQueued', chunk.x, chunk.z, inspectNow);
      }
    }
    const elapsed = session.world.processLighting(budgetMs, originX, originZ, counters);
    if (inspect && counters) {
      this.jobFrame.lightAttempted = counters.attempted;
      this.jobFrame.lightCompleted = counters.completed;
      this.jobFrame.lightYielded = counters.yielded;
      this.jobFrame.lightBlocked = counters.blocked;
      const afterActive = this.snapshotLightingActiveKeys(session);
      for (const key of afterActive) {
        if (!beforeActive?.has(key)) {
          const { cx, cz } = parseChunkKey(key);
          this.streamingTrace.mark('lightStarted', cx, cz, performance.now());
        }
      }
      if (counters.yielded > 0) {
        const owner = lightingFloodOwner(session.world);
        if (owner && owner !== LIGHT_FLOOD_REGION && owner !== LIGHT_FLOOD_ADD_EMITTER) {
          const { cx, cz } = parseChunkKey(owner);
          this.streamingTrace.mark('lightYielded', cx, cz, performance.now());
        }
      }
      for (const chunk of session.world.chunks.values()) {
        const key = inspectChunkKey(chunk.x, chunk.z);
        if (chunk.lightingReady && !beforeReady?.has(key)) {
          this.streamingTrace.mark('lit', chunk.x, chunk.z, performance.now());
        }
      }
    }
    return elapsed;
  }

  private snapshotLitKeys(session: GameSession): Set<string> {
    const keys = new Set<string>();
    for (const chunk of session.world.chunks.values()) {
      if (chunk.lightingReady) keys.add(inspectChunkKey(chunk.x, chunk.z));
    }
    return keys;
  }

  private snapshotLightingActiveKeys(session: GameSession): Set<string> {
    const keys = new Set<string>();
    const owner = lightingFloodOwner(session.world);
    for (const chunk of session.world.chunks.values()) {
      const key = inspectChunkKey(chunk.x, chunk.z);
      if (lightingIsActive(chunk.lightingReady, chunk.skyFillCursor, chunk.blockScanCursor, owner, key)) {
        keys.add(key);
      }
    }
    return keys;
  }

  private syncInspectWantedPeriods(
    session: GameSession,
    playerCx: number,
    playerCz: number,
    meshRadius: number,
    generateRadius: number,
    now: number,
  ): void {
    const nextWanted = new Set<string>();
    const syncOne = (cx: number, cz: number, inMeshWanted: boolean, inGenerationWanted: boolean): void => {
      const key = inspectChunkKey(cx, cz);
      const chunk = session.world.chunks.get(key);
      const stamps = this.streamingTrace.record(cx, cz);
      const lightingReady = chunk?.lightingReady === true;
      const visible = session.worldRenderer.hasChunk(key);
      const contextReady = chunk
        ? lightContextReady(session.world, chunk, playerCx, playerCz, generateRadius)
        : false;
      const result = syncWantedPeriod(stamps, {
        inMeshWanted,
        inGenerationWanted,
        inLightHalo: inGenerationWanted,
        generated: Boolean(chunk),
        lightingReady,
        lightContextReady: contextReady,
        visible,
        distance: chebyshev(cx, cz, playerCx, playerCz),
        now,
      });
      if (result.enteredMeshWanted) this.streamingTrace.mark('enteredMeshWanted', cx, cz, now);
      if (result.leftMeshWanted) this.streamingTrace.mark('leftMeshWanted', cx, cz, now);
      if (result.becameReadyWhileWanted) this.streamingTrace.mark('readyWhileWanted', cx, cz, now);
    };

    for (let dz = -generateRadius; dz <= generateRadius; dz += 1) {
      for (let dx = -generateRadius; dx <= generateRadius; dx += 1) {
        const cx = playerCx + dx;
        const cz = playerCz + dz;
        const inMeshWanted = chebyshev(cx, cz, playerCx, playerCz) <= meshRadius;
        if (inMeshWanted) nextWanted.add(inspectChunkKey(cx, cz));
        syncOne(cx, cz, inMeshWanted, true);
      }
    }
    for (const key of this.lastInspectMeshWanted) {
      if (nextWanted.has(key)) continue;
      const { cx, cz } = parseChunkKey(key);
      const inGenerationWanted = chebyshev(cx, cz, playerCx, playerCz) <= generateRadius;
      syncOne(cx, cz, false, inGenerationWanted);
    }
    if (this.inspectFreeze) {
      const { cx, cz } = this.inspectFreeze;
      const dist = chebyshev(cx, cz, playerCx, playerCz);
      if (dist > generateRadius) {
        syncOne(cx, cz, false, false);
      }
    }
    this.lastInspectMeshWanted = nextWanted;
  }

  private refreshStreamingInspector(session: GameSession, now: number): void {
    const originX = session.player.position.x;
    const originZ = session.player.position.z;
    const meshRadius = this.settings.renderDistance;
    const generateRadius = lightingHaloRadius(meshRadius);
    const playerCx = floorDiv(Math.floor(originX), 16);
    const playerCz = floorDiv(Math.floor(originZ), 16);
    const look = session.player.viewDirection();
    if (this.profiler.enabled) {
      for (const key of session.world.pendingMesh) {
        const { cx, cz } = parseChunkKey(key);
        this.streamingTrace.mark('meshQueued', cx, cz, now);
        this.streamingTrace.mark('requested', cx, cz, now);
      }
      for (let dz = -generateRadius; dz <= generateRadius; dz += 1) {
        for (let dx = -generateRadius; dx <= generateRadius; dx += 1) {
          this.streamingTrace.mark('requested', playerCx + dx, playerCz + dz, now);
        }
      }
      this.syncInspectWantedPeriods(session, playerCx, playerCz, meshRadius, generateRadius, now);
    }
    const view = {
      world: session.world,
      hasMesh: (key: string) => session.worldRenderer.hasChunk(key),
      originX,
      originZ,
      meshRadius,
      generateRadius,
      playerCx,
      playerCz,
      lookX: look.x,
      lookZ: look.z,
      velocityX: session.player.velocity.x,
      velocityZ: session.player.velocity.z,
      flying: session.player.isFlying,
      jobFrame: this.jobFrame,
      freeze: this.inspectFreeze,
      now,
    };
    const snap = captureStreamingSnapshot(view, this.streamingTrace, this.lastMeshActiveKey);
    this.overlayCategories = snap.overlay;
    this.overlayRevision += 1;
    this.lastFrontTarget = snap.front ? { cx: snap.front.cx, cz: snap.front.cz } : { cx: playerCx, cz: playerCz };
    const keep = new Set<string>();
    if (this.inspectFreeze) keep.add(inspectChunkKey(this.inspectFreeze.cx, this.inspectFreeze.cz));
    if (snap.front) keep.add(inspectChunkKey(snap.front.cx, snap.front.cz));
    keep.add(inspectChunkKey(playerCx, playerCz));
    this.streamingTrace.evictFar(playerCx, playerCz, generateRadius + 4, keep);

    if (this.profiler.enabled) {
      const queues = collectStreamingQueues(view);
      const starvation = { current: null as { cx: number; cz: number; waitMs: number } | null };
      const consider = (cx: number, cz: number): void => {
        const key = inspectChunkKey(cx, cz);
        const visible = session.worldRenderer.hasChunk(key);
        if (visible) {
          this.slowArmed.delete(key);
          return;
        }
        const inspected = inspectStreamingChunk(view, cx, cz, queues, this.streamingTrace, this.lastMeshActiveKey);
        const wait = openReadyWantedWaitMs(inspected.latency);
        if (wait !== null && shouldWarnReadyMeshWait(wait, false)) {
          if (!starvation.current || wait > starvation.current.waitMs) {
            starvation.current = { cx, cz, waitMs: wait };
          }
        }
        const captured = maybeSlowSnapshot(
          inspected,
          snap.horizon,
          snap.gen.pending,
          snap.light.pending,
          snap.mesh.pending,
          now,
          this.slowArmed.has(key),
        );
        if (!captured) return;
        this.slowArmed.add(key);
        this.slowSnapshots = pushSlowSnapshot(this.slowSnapshots, captured);
      };
      if (snap.front) consider(snap.front.cx, snap.front.cz);
      for (let dz = -meshRadius; dz <= meshRadius; dz += 1) {
        for (let dx = -meshRadius; dx <= meshRadius; dx += 1) {
          if (snap.front && snap.front.cx === playerCx + dx && snap.front.cz === playerCz + dz) continue;
          consider(playerCx + dx, playerCz + dz);
        }
      }
      if (starvation.current) {
        const previous = this.lastReadyMeshWaitWarn;
        const found = starvation.current;
        const same = previous !== null && previous.cx === found.cx && previous.cz === found.cz;
        this.lastReadyMeshWaitWarn = {
          cx: found.cx,
          cz: found.cz,
          waitMs: found.waitMs,
          atMs: same && previous ? previous.atMs : now,
        };
      }
      this.inspectorHud = formatStreamingHud(snap, this.slowSnapshots.at(-1) ?? null, now, {
        readyMeshWaitWarn: this.lastReadyMeshWaitWarn,
        litToMesh: this.litToMeshWaits.snapshot(),
        requestToVisible: this.requestToVisibleWaits.snapshot(),
        generatedToVisible: this.generatedToVisibleWaits.snapshot(),
        wantedToVisible: this.wantedToVisibleWaits.snapshot(),
        readyWantedToMesh: this.readyWantedToMeshWaits.snapshot(),
        fluid: session.world.fluidHudStats(),
        lightOrigins: session.world.lightOriginCounts,
      });
    }
  }

  private maybeRunPerfScenario(): void {
    if (!this.perfScenario || !this.session) return;
    if (this.perfScenario === 'CREATIVE_BREAK_STRESS') this.runCreativeBreakStress();
    if (this.perfScenario === 'MOB_SMOOTHNESS') this.runMobSmoothnessSample();
  }

  private runCreativeBreakStress(): void {
    const session = this.session;
    if (!session) return;
    const originX = Math.floor(session.player.position.x);
    const originY = Math.floor(session.player.position.y);
    const originZ = Math.floor(session.player.position.z);
    const marksBefore = session.world.meshDirtyMarks;
    const lightBefore = session.world.lightQueueMarks;
    const mutations = [];
    for (let index = 0; index < 100; index += 1) {
      mutations.push({
        x: originX + (index % 10),
        y: originY,
        z: originZ + Math.floor(index / 10) + 2,
        block: session.world.getBlock(originX + (index % 10), originY, originZ + Math.floor(index / 10) + 2),
      });
    }
    const started = performance.now();
    for (const mutation of mutations) {
      session.world.applyBlockBatch([{ x: mutation.x, y: mutation.y, z: mutation.z, block: BlockId.Air }], {
        deferLighting: true,
      });
    }
    const queued = performance.now() - started;
    const lightMs = session.world.flushLighting();
    console.info('[perf] CREATIVE_BREAK_STRESS', {
      edits: mutations.length,
      queuedMs: Number(queued.toFixed(2)),
      lightMs: Number(lightMs.toFixed(2)),
      meshDirtyMarks: session.world.meshDirtyMarks - marksBefore,
      pendingMesh: session.world.pendingMeshJobs,
      lightQueueMarks: session.world.lightQueueMarks - lightBefore,
      pendingLight: session.world.pendingLightJobs,
    });
  }

  private runMobSmoothnessSample(): void {
    const session = this.session;
    if (!session) return;
    const spawn = session.player.position.clone();
    spawn.x += 3;
    const mob = session.mobs.spawn('cow', spawn, { force: true, velocity: new THREE.Vector3(0, 0, 2) });
    if (!mob) return;
    session.mobs.interpolateVisuals(0.5);
    console.info('[perf] MOB_SMOOTHNESS', {
      sim: [mob.position.x, mob.position.z],
      visual: mob.visual
        ? [mob.visual.position.x, mob.visual.position.z]
        : [mob.position.x, mob.position.z],
    });
  }

  private enterPlaying(): void {
    this.session?.worldRenderer.setOpenChest(undefined);
    this.ui.closeInventory();
    this.ui.closeChat();
    this.input.clearHeldKeys();
    this.ui.hidePointerLockFallback();
    this.ui.enterGame();
    this.lifecycle.endOnlineRespawnRestore();
    this.lifecycle.setState(lifecycleAfterWorldSessionEnter(this.lifecycle.state));
    this.previousTime = performance.now();
    this.accumulator = 0;
    if (import.meta.env.DEV && !this.polishQaDispose && this.session?.summary.seed === 'interaction-support-polish'
      && new URLSearchParams(location.search).get('polishQa') === '1') {
      const session = this.session;
      this.polishQaDispose = () => {};
      void import('../dev/GameplayPolishQa').then(({ mountGameplayPolishQa }) => {
        if (this.session !== session) return;
        this.polishQaDispose = mountGameplayPolishQa(session, this.input, {
          use: () => {
            this.ui.hidePointerLockFallback();
            session.target = session.world.raycast(session.player.eyePosition(), session.player.viewDirection(), PLAYER_REACH);
            this.useTargetOrItem();
          },
          break: () => {
            this.ui.hidePointerLockFallback();
            session.target = session.world.raycast(session.player.eyePosition(), session.player.viewDirection(), PLAYER_REACH);
            this.breakTarget();
          },
        });
      });
    }
  }

  /** Close the inventory modal and restore desktop mouse-look. */
  private closeInventoryAndResumeLook(): void {
    this.closeOpenChestAudio();
    this.session?.worldRenderer.setOpenChest(undefined);
    if (this.session?.online) {
      this.session.online.client.send({ type: 'inventory_action', action: 'close' });
      this.ui.closeInventory(false);
    } else {
      this.ui.closeInventory();
    }
    this.enterPlaying();
    this.input.tryRequestPointerLock();
  }

  /** Resume from pause/settings and restore desktop mouse-look. Opening pause does not use this. */
  private resumeFromPause(): void {
    this.enterPlaying();
    this.input.tryRequestPointerLock();
  }

  private openPauseMenu(): void {
    this.ui.hidePointerLockFallback();
    if (openingPauseMenuPausesSimulation()) this.lifecycle.setState('PAUSED');
    if (this.session?.online) this.sendOnlineIdle(this.session);
    else void this.saveSession();
    this.ui.showPause({
      resume: () => this.resumeFromPause(),
      settings: () => {
        this.screenBeforeSettings = 'pause';
        this.showSettings();
      },
      saveAndQuit: () => void this.saveAndQuit(),
    });
  }

  private handlePointerUnlock(reason: PointerUnlockReason): void {
    if (reason === 'unknown' || reason === 'focus-lost') {
      this.showPointerLockFallbackIfNeeded();
      return;
    }
    if (!shouldOpenPauseOnUnlock(reason, this.lifecycle.state === 'PLAYING', this.ui.isBlockingOverlay())) return;
    this.openPauseMenu();
  }

  private showPointerLockFallbackIfNeeded(): void {
    if (!shouldShowPointerLockFallback({
      playing: this.lifecycle.state === 'PLAYING',
      inventoryOpen: this.ui.isBlockingOverlay(),
      coarsePointer: isCoarsePointer(),
      lockedToCanvas: this.input.isPointerLocked(),
      lastRequestFailed: true,
    })) return;
    this.ui.showPointerLockFallback(() => this.input.tryRequestPointerLock());
  }

  private toggleInventory(): void {
    const session = this.session;
    if (!session || this.lifecycle.state === 'DEAD' || this.lifecycle.state === 'MENU') return;
    if (this.ui.isChatOpen()) this.ui.closeChat();
    if (this.ui.isInventoryOpen()) {
      this.closeInventoryAndResumeLook();
      return;
    }
    if (this.lifecycle.state !== 'PLAYING') return;
    this.openGameplayModal();
    this.ui.openInventory({
      inventory: session.inventory,
      mode: session.summary.mode,
      kind: 'inventory',
      onClose: () => this.closeInventoryAndResumeLook(),
      onDrop: (stack) => this.spawnDroppedStack(stack),
      onChanged: () => this.refreshHud(),
      submitAction: session.online
        ? (message) => session.online?.client.send(message)
        : undefined,
    });
    session.online?.client.send({ type: 'inventory_action', action: 'open', kind: 'inventory' });
  }

  private openGameplayModal(): void {
    this.ui.hidePointerLockFallback();
    this.input.releasePointerLock();
    this.input.releaseActions();
    if (this.session) {
      this.session.miningProgress = 0;
      this.session.miningTarget = undefined;
    }
  }

  private openBlockInventory(kind: 'crafting-table' | 'chest' | 'furnace', hit: VoxelHit): void {
    const session = this.session!;
    if (this.lifecycle.state !== 'PLAYING') return;
    this.openGameplayModal();
    if (kind === 'chest') {
      const key = blockKey(hit.x, hit.y, hit.z);
      if (this.openChestKey !== key) {
        this.playWorld('chest.open', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
        this.openChestKey = key;
      }
      session.worldRenderer.setOpenChest(key);
    }
    this.ui.openInventory({
      inventory: session.inventory,
      mode: session.summary.mode,
      kind,
      ...(kind === 'chest' ? { chest: session.world.getChest(hit.x, hit.y, hit.z) } : {}),
      ...(kind === 'furnace' ? { furnace: session.world.getFurnace(hit.x, hit.y, hit.z) } : {}),
      onClose: () => {
        this.closeInventoryAndResumeLook();
        void this.saveSession();
      },
      onDrop: (stack) => this.spawnDroppedStack(stack),
      onChanged: () => this.refreshHud(),
      submitAction: session.online
        ? (message) => session.online?.client.send(message)
        : undefined,
    });
  }

  private togglePause(): void {
    if (!this.session || this.lifecycle.state === 'MENU' || this.lifecycle.state === 'LOADING' || this.lifecycle.state === 'LOADING_WORLD') return;
    if (this.ui.isChatOpen()) {
      this.closeChatAndResumeLook();
      return;
    }
    if (this.ui.isInventoryOpen()) {
      this.closeInventoryAndResumeLook();
      return;
    }
    if (this.lifecycle.state === 'PLAYING') {
      this.input.releasePointerLock();
      this.openPauseMenu();
    } else if (this.lifecycle.state === 'PAUSED') this.resumeFromPause();
  }

  private showSettings(): void {
    this.ui.showSettings((settings) => {
      this.settings = settings;
      this.audio.setVolume(settings.volume);
      this.input.setSensitivity(settings.sensitivity);
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
      if (this.scene.fog instanceof THREE.Fog) this.scene.fog.far = settings.renderDistance * 16 + 28;
    }, () => this.ui.showControls(() => this.showSettings()), () => {
      if (this.screenBeforeSettings === 'pause' && this.session) {
        this.ui.showPause({
          resume: () => this.resumeFromPause(),
          settings: () => this.showSettings(),
          saveAndQuit: () => void this.saveAndQuit(),
        });
      } else this.showMainMenu();
    });
  }

  private async saveAndQuit(): Promise<void> {
    await this.saveSession();
    this.disposeSession();
    this.showMainMenu();
  }

  private async saveSession(): Promise<void> {
    const session = this.session;
    if (!session || session.online) return;
    const state: SerializedWorldState = {
      schemaVersion: 1,
      summary: {
        ...session.summary,
        playTimeSeconds: session.playTicks / TICK_RATE,
        updatedAt: Date.now(),
      },
      timeOfDay: session.world.timeOfDay,
      weather: 'clear',
      player: {
        position: session.player.position.toArray() as [number, number, number],
        velocity: session.player.velocity.toArray() as [number, number, number],
        yaw: session.player.yaw,
        pitch: session.player.pitch,
        health: session.survival.health,
        hunger: session.survival.hunger,
        saturation: session.survival.saturation,
        absorption: session.survival.absorption,
        absorptionTicks: session.survival.effectTicks('absorption'),
        selectedSlot: session.selectedSlot,
        spawnPoint: [...session.survival.spawnPoint],
        inventory: session.inventory.serialize(),
      },
      modifications: session.world.serializeModifications(),
      chests: Object.fromEntries(session.world.chests),
      furnaces: Object.fromEntries(session.world.furnaces),
      droppedItems: session.drops.serialize(),
      fallingBlocks: session.falling.serialize(),
      minecarts: session.minecarts.serialize(),
      blockStates: session.world.serializeBlockStates(),
      mobs: session.mobs.serialize(),
      redstone: session.redstone.serialize(),
      ...(session.serverWorld ? { serverWorld: session.serverWorld } : {}),
    };
    session.summary = state.summary;
    this.lastSavePromise = this.lastSavePromise.then(() => this.saves.saveWorld(state)).catch((error) => {
      console.error('Autosave failed.', error);
      this.ui.toast('Не удалось сохранить мир');
    });
    await this.lastSavePromise;
  }

  private frame(now: number): void {
    const frameStart = performance.now();
    const rawElapsed = Math.max(0, (now - this.previousTime) / 1000);
    this.previousTime = now;
    this.frameTimings.add(rawElapsed * 1000);
    this.fpsFrames += 1;
    this.fpsTimer += Math.min(MAX_FRAME_DELTA, rawElapsed);
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
    this.lastGenerateMs = 0;
    this.lastLightMs = 0;
    this.lastMeshMs = 0;
    this.lastEntityUpdateMs = 0;
    let tickMs = 0;
    if (this.lifecycle.state === 'LOADING_WORLD') {
      this.accumulator = 0;
      this.processWorldLoading(frameStart);
    } else if (worldSimulationActive(this.lifecycle.state)) {
      const stepped = advanceFixedStep(this.accumulator, rawElapsed, FIXED_DT, MAX_FRAME_DELTA, MAX_CATCH_UP_TICKS);
      this.accumulator = stepped.nextAccumulator;
      this.simParts.player = 0;
      this.simParts.mobs = 0;
      this.simParts.world = 0;
      this.simParts.combat = 0;
      this.simParts.entities = 0;
      this.simParts.other = 0;
      const tickStart = performance.now();
      for (let tick = 0; tick < stepped.ticks; tick += 1) this.tick();
      if (this.session?.online) this.stepOnlineAuthority(this.session, rawElapsed);
      tickMs = performance.now() - tickStart;
      this.lastSimParts = { ...this.simParts, ticks: stepped.ticks };
      if (stepped.ticks > 0) this.tickTimings.add(tickMs / stepped.ticks);
      this.processWorldJobs(frameStart, false);
    } else this.accumulator = 0;
    this.updateFirstPerson(rawElapsed);
    if (this.session) {
      updateSharedFireAnimation(rawElapsed);
      this.session.worldRenderer.updateChests(rawElapsed);
      const inspectClock = performance.now();
      if (
        (this.profiler.enabled || this.chunkGridVisible)
        && inspectClock - this.lastInspectorAt >= 125
      ) {
        this.lastInspectorAt = inspectClock;
        this.refreshStreamingInspector(this.session, inspectClock);
      }
      this.updateChunkGrid();
    }
    const renderStart = performance.now();
    this.render(this.accumulator / FIXED_DT);
    const renderMs = performance.now() - renderStart;
    const frameMs = performance.now() - frameStart;
    if (this.profiler.enabled) {
      const cost: FrameCostBreakdown = {
        frameMs,
        tickMs,
        generateMs: this.lastGenerateMs,
        lightMs: this.lastLightMs,
        meshMs: this.lastMeshMs,
        entityMs: this.lastEntityUpdateMs,
        renderMs,
        otherMs: Math.max(0, frameMs - tickMs - renderMs),
      };
      this.profiler.addFrame(cost, rawElapsed);
      const session = this.session;
      const playerX = session ? Math.floor(session.player.position.x) : 0;
      const playerZ = session ? Math.floor(session.player.position.z) : 0;
      const snapshot = this.profiler.snapshot({
        generateJobs: this.lastChunkGenerationJobs,
        meshJobs: this.lastChunkMeshJobs,
        waitingMesh: session
          ? pendingMeshInRadius(
            session.world,
            playerX,
            playerZ,
            this.settings.renderDistance,
          )
          : 0,
        waitingGenerate: session
          ? missingChunkCoords(
            session.world,
            playerX,
            playerZ,
            lightingHaloRadius(this.settings.renderDistance),
          ).length
          : 0,
        lightingJobs: session?.world.pendingLightJobs ?? 0,
        lightPending: lightFrameStats.jobsPending,
        lightColumns: lightFrameStats.columns,
        lightNodes: lightFrameStats.nodes,
        lightFrameMs: this.lastLightMs,
        lightMaxSlice: lightFrameStats.maxSlice,
        dirtyLightChunks: lightFrameStats.dirtyLightChunks,
        dirtyChunks: session?.world.dirtyChunkCount ?? 0,
        blockMutations: session?.world.mutationMarks ?? 0,
        mobCount: session?.mobs.count ?? 0,
        entityUpdateMs: this.lastEntityUpdateMs,
        chunkX: session ? floorDiv(playerX, 16) : undefined,
        chunkZ: session ? floorDiv(playerZ, 16) : undefined,
        chunkHud: session ? this.chunkDebugLine(session) : undefined,
        inspectorHud: this.inspectorHud || undefined,
        simParts: this.profiler.enabled ? this.lastSimParts : undefined,
        meshWait: this.profiler.enabled ? this.meshDurations.snapshot() : undefined,
      });
      if (snapshot) this.profiler.paint(this.ui.overlayRoot(), snapshot);
    }
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
  }

  private addSimPart(part: 'player' | 'mobs' | 'world' | 'combat' | 'entities' | 'other', started: number): number {
    if (!this.profiler.enabled) return 0;
    this.simParts[part] += performance.now() - started;
    return performance.now();
  }

  private tickOnline(session: GameSession): void {
    const online = session.online;
    if (!online) return;
    session.player.yaw = this.input.yaw;
    session.player.pitch = this.input.pitch;
    session.playTicks += 1;
    const overlayOpen = this.ui.isBlockingOverlay();
    const gameplayAllowed = playerGameplayAllowed(this.lifecycle.state, overlayOpen);
    const movement = resolvePlayerMoveInput(overlayOpen, this.input.movement());
      const riding = Boolean(session.ridingCartId);
      online.inputSeq += 1;
      online.client.send({
        type: 'input',
        seq: online.inputSeq,
        forward: movement.forward,
        right: movement.right,
        jump: movement.jump,
        sneak: movement.sneak,
        sprint: movement.sprint,
        descend: movement.descend === true,
        flySprint: movement.flySprint === true,
        yaw: this.input.yaw,
        pitch: this.input.pitch,
        selectedSlot: session.selectedSlot,
        mining: gameplayAllowed && this.input.mining,
        use: gameplayAllowed && this.input.using,
        vehicleForward: riding ? movement.forward : 0,
      });
    const selected = this.selectedStack();
    session.combat.setHeldItem(selected?.itemId);
    this.firstPerson?.setHeldItems(selected?.itemId);
    if (gameplayAllowed) this.updateTargetAndActions();
    else {
      this.input.consumeAttackPressed();
      this.input.consumeUsePressed();
      session.miningProgress = 0;
      session.miningTarget = undefined;
    }
    const cx = floorDiv(Math.floor(session.player.position.x), 16);
    const cz = floorDiv(Math.floor(session.player.position.z), 16);
    const viewKey = `${cx},${cz},${this.settings.renderDistance}`;
    if (online.lastViewKey !== viewKey) {
      online.lastViewKey = viewKey;
      online.client.send({
        type: 'view',
        cx,
        cz,
        radius: Math.max(1, Math.min(8, this.settings.renderDistance)),
      });
    }
    if (session.playTicks % 80 === 0) {
      const removed = session.world.pruneChunks(
        Math.floor(session.player.position.x),
        Math.floor(session.player.position.z),
        this.settings.renderDistance,
      );
      session.worldRenderer.removeChunks(removed);
    }
    session.mobs.tickRemoteVisuals(FIXED_DT);
    const holdingBow = gameplayAllowed
      && this.input.using
      && this.selectedStack()?.itemId === ItemId.Bow;
    session.bowUseTicks = stepVisualBowUseTicks(session.bowUseTicks, holdingBow);
    if (session.playTicks % 2 === 0) this.refreshHud();
  }

  private tick(): void {
    const session = this.session;
    if (!session) return;
    if (!shouldRunClientWorldSimulation(Boolean(session.online))) {
      this.tickOnline(session);
      return;
    }
    const profile = this.profiler.enabled;
    let simMark = profile ? performance.now() : 0;
    session.playTicks += 1;
    if (this.debugTickOrder) this.kernelTrace.length = 0;

    const overlayOpen = this.ui.isBlockingOverlay();
    const gameplayAllowed = playerGameplayAllowed(this.lifecycle.state, overlayOpen);
    const movementBefore = resolvePlayerMoveInput(overlayOpen, this.input.movement());
    const riding = Boolean(session.ridingCartId);
    let entityStart = 0;

    const aborted = tickGameplayKernel({
      tickWorld: () => {
        session.world.tick();
        this.processDetachedBlocks();
      },
      tickFalling: () => {
        for (const spawn of session.world.consumeFallingBlocks()) {
          session.falling.spawn(spawn.block, spawn.x, spawn.y, spawn.z);
        }
        session.falling.update(FIXED_DT);
        simMark = this.addSimPart('world', simMark);
      },
      tickPlayers: () => {
        const selected = this.selectedStack();
        session.combat.setHeldItem(selected?.itemId);
        session.combat.setOffhand(session.inventory.offhand?.itemId);
        this.firstPerson?.setHeldItems(selected?.itemId);
        simMark = this.addSimPart('combat', simMark);

        session.combat.updateUse(this.input.using, gameplayAllowed, !session.survival.dead);
        const drawingBow = session.bowUseTicks > 0;
        const movementMultiplier = drawingBow || session.combat.swordBlocking ? 0.2 : 1;
        session.player.creativeFlightAllowed = session.summary.mode === 'creative';
        const playerInput = {
          yaw: this.input.yaw,
          pitch: this.input.pitch,
          locomotion: !riding,
          movement: () => ({
            ...movementBefore,
            forward: riding ? 0 : movementBefore.forward * movementMultiplier,
            right: riding ? 0 : movementBefore.right * movementMultiplier,
            jump: riding ? false : movementBefore.jump,
            sprint: !riding && !drawingBow && movementBefore.sprint
              && movementMultiplier === 1
              && (session.summary.mode === 'creative' || session.survival.hunger > 6),
            descend: movementBefore.descend === true,
            flySprint: movementMultiplier === 1 && movementBefore.flySprint === true,
          }),
        };
        const playerResult = session.player.tick(session.world, playerInput, FIXED_DT, (damage, cause) => {
          if (session.summary.mode === 'survival') session.survival.damage(damage, cause, { armor: session.inventory });
        });
        this.updateFootsteps(session, playerResult.horizontalDistance);
        if (session.summary.mode === 'survival') {
          const survivalResult = session.survival.tick(FIXED_DT, {
            player: session.player,
            world: session.world,
            armor: session.inventory,
            inFire: session.player.inFire,
            horizontalDistance: playerResult.horizontalDistance,
            sprinting: session.player.sprinting,
            swimming: session.player.inWater,
            jumped: playerResult.jumped,
            onDeath: (source) => this.handleDeath(source),
          });
          if (survivalResult.dead) {
            this.handleDeath();
            return 'abort';
          }
        }
        simMark = this.addSimPart('player', simMark);
      },
      tickPlayerActions: () => {
        if (gameplayAllowed) {
          this.updateTargetAndActions();
          this.updateFoodUse();
        } else {
          this.input.consumeAttackPressed();
          this.input.consumeUsePressed();
          session.miningProgress = 0;
          session.miningTarget = undefined;
          resetMiningSound(this.miningSound);
        }
        simMark = this.addSimPart('other', simMark);
      },
      tickProjectiles: () => {
        entityStart = performance.now();
        session.arrows.tick(FIXED_DT);
        const collectedArrows = session.arrows.tryCollect(session.player.aabb, {
          mode: session.summary.mode,
          addItem: (itemId, count) => session.inventory.addItem(itemId, count),
        });
        if (collectedArrows > 0) this.playLocal('item.pickup');
      },
      tickVehicles: () => {
        session.minecarts.tryPushFromPlayer(session.player, session.ridingCartId);
        const ridingCart = session.ridingCartId ? session.minecarts.get(session.ridingCartId) : undefined;
        const steerOnRail = Boolean(ridingCart && session.minecarts.isOnRail(ridingCart));
        session.minecarts.update(FIXED_DT, {
          riderId: session.ridingCartId,
          forward: riding && steerOnRail ? movementBefore.forward : 0,
          strafe: riding && steerOnRail ? movementBefore.right : 0,
          riderYaw: session.player.yaw,
        });
        this.updateMinecartRiding(session);
        if (session.playTicks % 80 === 0) {
          const removed = session.world.pruneChunks(
            Math.floor(session.player.position.x),
            Math.floor(session.player.position.z),
            this.settings.renderDistance,
          );
          session.worldRenderer.removeChunks(removed);
        }
        for (const boom of session.minecarts.consumeExplosions()) {
          this.explosionQueue.enqueue({
            x: boom.position.x,
            y: boom.position.y,
            z: boom.position.z,
            radius: boom.radius,
            power: boom.power,
          });
          if (session.ridingCartId === boom.id) session.ridingCartId = undefined;
        }
        simMark = this.addSimPart('entities', simMark);
      },
      tickMobs: () => {
        session.mobs.update(FIXED_DT, {
          playerPosition: session.player.position,
          playerEyePosition: session.player.eyePosition(),
          playerAlive: !session.survival.dead,
          playerTargetable: session.summary.mode === 'survival' && !session.survival.invisible,
          daylight: daylightFactor(session.world.timeOfDay),
        });
      },
      handleMobEvents: () => {
        this.processMobEvents();
        simMark = this.addSimPart('mobs', simMark);
        this.processExplosionQueue();
        if (session.summary.mode === 'survival' && session.survival.dead) {
          this.handleDeath();
          return 'abort';
        }
      },
      tickPreDropSupport: () => {
        session.world.processSupportIntegrity();
        this.processDetachedBlocks();
      },
      tickDrops: () => {
        session.drops.update(FIXED_DT, { collectorPosition: session.player.position });
        this.lastEntityUpdateMs += performance.now() - entityStart;
        simMark = this.addSimPart('entities', simMark);
      },
      tickRedstone: () => {
        this.updateRedstone();
      },
      processExplosions: () => {
        this.processExplosionQueue();
        if (session.summary.mode === 'survival' && session.survival.dead) {
          this.handleDeath();
          return 'abort';
        }
      },
    }, this.debugTickOrder ? this.kernelTrace : undefined);

    if (aborted) return;

    if (session.playTicks - session.lastAutosaveTick >= AUTOSAVE_INTERVAL_SECONDS * TICK_RATE) {
      session.lastAutosaveTick = session.playTicks;
      void this.saveSession();
    }
    if (session.playTicks % 2 === 0) this.refreshHud();
    if (this.ui.isInventoryOpen()) this.ui.refreshOpenInventory();
    this.addSimPart('other', simMark);
  }

  private updateTargetAndActions(): void {
    const session = this.session!;
    const origin = session.player.eyePosition();
    const direction = session.player.viewDirection();
    session.target = session.world.raycast(origin, direction, PLAYER_REACH);
    const cartHit = session.minecarts.raycast(origin, direction, PLAYER_REACH, session.ridingCartId);
    const mobTarget = session.mobs.raycast(origin, direction, Math.min(3, PLAYER_REACH));
    const remoteHit = session.online
      ? raycastRemotePlayers(session.online.remotes, origin, direction, Math.min(3, PLAYER_REACH))
      : undefined;
    const remoteCloser = Boolean(
      remoteHit
      && (!mobTarget || remoteHit.distance <= mobTarget.distance)
      && (!cartHit || remoteHit.distance <= cartHit.distance)
      && (!session.target || remoteHit.distance < session.target.distance)
    );
    const attack = resolvePlayerAttackTarget(session.target, cartHit, mobTarget, session.ridingCartId);
    session.worldRenderer.setTarget(attack?.kind === 'block' ? attack.hit : attack?.kind === 'minecart' ? undefined : session.target);
    const attackPresses = this.input.consumeAttackPresses();
    const attackPressed = attackPresses > 0;
    const targetKey = session.target ? `${session.target.x},${session.target.y},${session.target.z}` : undefined;
    if (session.online && session.online.rejectedBlockKey && session.online.rejectedBlockKey !== targetKey) {
      session.online.rejectedBlockKey = undefined;
    }
    if (remoteCloser && session.online) {
      session.miningTarget = undefined;
      session.miningProgress = 0;
      for (let click = 0; click < attackPresses; click += 1) {
        session.online.client.send({ type: 'attack' });
      }
    } else if (attack?.kind === 'mob' && mobTarget) {
      session.miningTarget = undefined;
      session.miningProgress = 0;
      if (session.online) {
        for (let click = 0; click < attackPresses; click += 1) {
          session.online.client.send({ type: 'attack' });
        }
      } else {
        for (let click = 0; click < attackPresses; click += 1) {
          const stack = this.selectedStack();
          const result = session.combat.performMeleeAttack(stack?.itemId ?? null, {
            critical: {
              fallDistance: session.player.fallDistance,
              onGround: session.player.onGround,
              sprinting: session.player.sprinting,
              inWater: session.player.inWater,
              onLadder: session.player.onLadder,
              riding: Boolean(session.ridingCartId),
            },
            attackerSprinting: session.player.sprinting,
            attackerYaw: session.player.yaw,
          });
          const accepted = session.mobs.damage(mobTarget.mob, result.damage, {
            source: 'player',
            attackerPosition: session.player.position,
            attackerYaw: result.attackerYaw,
            extraKnockbackLevel: result.extraKnockbackLevel,
          });
          completeMeleeAttack(result, accepted, session.player);
          if (accepted && session.summary.mode === 'survival') {
            if (stack && result.profile.durabilityCost > 0) {
              session.inventory.setSlot(session.selectedSlot, damageItem(stack, result.profile.durabilityCost));
            }
            session.survival.recordAttack();
          }
          if (accepted) this.playWorld('combat.hit', mobTarget.mob.position.x, mobTarget.mob.position.y + 0.9, mobTarget.mob.position.z);
        }
      }
    } else if (attack?.kind === 'minecart') {
      session.miningTarget = undefined;
      session.miningProgress = 0;
      resetMiningSound(this.miningSound);
      if (attackPressed) {
        if (session.online) session.online.client.send({ type: 'attack' });
        else this.breakMinecart(attack.cart);
      }
    } else if (!this.input.mining || !session.target) {
      session.miningTarget = undefined;
      session.miningProgress = 0;
      resetMiningSound(this.miningSound);
    } else {
      if (session.miningTarget !== targetKey) {
        session.miningTarget = targetKey;
        session.miningProgress = 0;
      }
      const definition = getBlockDefinition(session.target.block);
      if (definition.breakable !== false && definition.hardness >= 0) {
        const delta = session.summary.mode === 'creative' ? 1 : this.miningDelta(definition, this.selectedStack());
        const kind = nextMiningSound(this.miningSound, targetKey, session.miningProgress, delta);
        session.miningProgress += delta;
        if (kind === 'break' || session.miningProgress >= 1) this.breakTarget();
        else if (kind === 'hit') {
          this.playBlockSound('hit', session.target.block, session.target.x, session.target.y, session.target.z);
        }
      }
    }
    for (let click = 0; click < attackPresses; click += 1) this.firstPerson?.swing();
    session.combat.setHeldItem(this.selectedStack()?.itemId);
    if (this.input.consumeUsePressed()) {
      if (session.online) {
        // Server useHeld owns interact + placement from authoritative look/raycast.
        session.online.client.send({ type: 'interact' });
      } else {
        this.useTargetOrItem();
      }
    }
  }

  private miningDelta(definition: ReturnType<typeof getBlockDefinition>, tool: ItemStack | null): number {
    return miningProgressPerTick(definition, miningToolFromItemId(tool?.itemId));
  }

  private breakTarget(): void {
    const session = this.session!;
    const hit = session.target;
    if (!hit) return;
    if (session.online) {
      const pending = session.online.pendingBlockAction;
      if (session.online.rejectedBlockKey === `${hit.x},${hit.y},${hit.z}`) return;
      if (pending && pending.kind === 'break' && pending.x === hit.x && pending.y === hit.y && pending.z === hit.z) {
        return;
      }
      session.online.pendingBlockAction = { kind: 'break', x: hit.x, y: hit.y, z: hit.z };
      session.online.client.send({ type: 'break_block', x: hit.x, y: hit.y, z: hit.z });
      this.firstPerson?.swing();
      return;
    }
    const definition = getBlockDefinition(hit.block);
    const toolStack = this.selectedStack();
    const item = toolStack ? tryGetItemDefinition(toolStack.itemId) : undefined;
    const harvestable = canHarvestBlock(definition, miningToolFromItemId(toolStack?.itemId));
    if (hit.block === BlockId.OakDoor) this.removeDoor(hit.x, hit.y, hit.z);
    else {
      session.world.applyBlockBatch([{ x: hit.x, y: hit.y, z: hit.z, block: BlockId.Air }], {
        deferLighting: true,
      });
      session.redstone.notifyBlockChanged(hit.x, hit.y, hit.z);
    }
    session.miningProgress = 0;
    session.miningTarget = undefined;
    resetMiningSound(this.miningSound);
    this.playBlockSound('break', hit.block, hit.x, hit.y, hit.z);
    this.firstPerson?.swing();

    if (session.summary.mode === 'survival') {
      const drop = definition.drop;
      if (drop && harvestable) {
        const count = drop.count ?? (drop.min !== undefined ? drop.min + Math.floor(Math.random() * ((drop.max ?? drop.min) - drop.min + 1)) : 1);
        const slabExtra = isSlabBlock(hit.block)
          && defaultSlabType(session.world.getBlockState(hit.x, hit.y, hit.z)) === 'double' ? count : 0;
        this.spawnDroppedStack(
          createItemStack(drop.item, count + slabExtra),
          new THREE.Vector3(hit.x + 0.5, hit.y + 0.3, hit.z + 0.5),
        );
      }
      if (toolStack && (item?.kind === 'tool' || item?.kind === 'weapon')) {
        session.inventory.setSlot(session.selectedSlot, damageItem(toolStack, 1));
      }
      session.survival.addExhaustion(0.005);
    }
    this.releaseBlockEntityContents(hit);
  }

  private breakMinecart(cart: MinecartEntity): void {
    const session = this.session!;
    const broken = session.minecarts.breakCart(cart, session.ridingCartId);
    if (!broken) return;
    this.playWorld('block.break.stone', broken.position.x, broken.position.y, broken.position.z);
    this.firstPerson?.swing();
    const loot = dropsForBrokenMinecart(session.summary.mode, broken.items);
    if (loot.length === 0) return;
    const origin = broken.position.clone().add(new THREE.Vector3(0, 0.2, 0));
    for (const itemId of loot) {
      this.spawnDroppedStack(createItemStack(itemId), origin.clone());
    }
  }

  private releaseBlockEntityContents(hit: VoxelHit): void {
    const session = this.session!;
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (hit.block === BlockId.Chest) {
      const chest = session.world.chests.get(key);
      if (chest) for (const stack of chest.slots) if (stack) this.spawnDroppedStack(stack, new THREE.Vector3(hit.x + 0.5, hit.y + 0.6, hit.z + 0.5));
      session.world.chests.delete(key);
    } else if (hit.block === BlockId.Furnace) {
      const furnace = session.world.furnaces.get(key);
      if (furnace) for (const stack of furnace.slots) if (stack) this.spawnDroppedStack(stack, new THREE.Vector3(hit.x + 0.5, hit.y + 0.6, hit.z + 0.5));
      session.world.furnaces.delete(key);
    }
  }

  private useTargetOrItem(): void {
    const session = this.session!;
    if (session.online) {
      session.online.client.send({ type: 'interact' });
      return;
    }
    performUseHeld(this.singleplayerUseContext());
  }

  private singleplayerUseContext(): UseSimulationContext {
    const session = this.session!;
    const game = this;
    return {
      world: session.world,
      inventory: session.inventory,
      get selectedSlot() { return session.selectedSlot; },
      set selectedSlot(value) { session.selectedSlot = value; },
      gamemode: session.summary.mode,
      reach: PLAYER_REACH,
      hit: session.target,
      eyePosition: () => session.player.eyePosition(),
      viewDirection: () => session.player.viewDirection(),
      get yaw() { return session.player.yaw; },
      get position() { return session.player.position; },
      intersectsBlock: (x, y, z) => session.player.intersectsBlock(x, y, z),
      intersectsCollisionBoxes: (boxes) => session.player.intersectsCollisionBoxes(boxes),
      get foodUseTicks() { return session.foodUseTicks; },
      set foodUseTicks(value) { session.foodUseTicks = value; },
      get bowUseTicks() { return session.bowUseTicks; },
      set bowUseTicks(value) { session.bowUseTicks = value; },
      get ridingCartId() { return session.ridingCartId; },
      set ridingCartId(value) { session.ridingCartId = value; },
      minecarts: session.minecarts,
      redstone: session.redstone,
      setSpawnPoint: (position) => session.survival?.setSpawnPoint(position),
      enterVehicle: (cartId) => {
        game.mountMinecart(cartId);
        return session.ridingCartId === cartId;
      },
      effects: {
        toast: (message) => game.ui.toast(message),
        swing: () => game.firstPerson?.swing(),
        playWorld: (event, x, y, z, options) => game.playWorld(event as SoundEventId, x, y, z, options),
        playBlock: (_action, block, x, y, z) => game.playBlockSound('place', block, x, y, z),
        openContainer: (kind, x, y, z) => {
          const hit = session.target
            && session.target.x === x && session.target.y === y && session.target.z === z
            ? session.target
            : {
              x, y, z,
              block: session.world.getBlock(x, y, z, false),
              normal: new THREE.Vector3(0, 1, 0),
              distance: 0,
              point: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
            };
          game.openBlockInventory(kind, hit);
        },
        onBedUsed: (skippedNight) => {
          game.ui.toast(skippedNight
            ? 'Ночь пропущена. Точка возрождения установлена.'
            : 'Точка возрождения установлена');
          void game.saveSession();
        },
        onFlintIgnite: () => {
          game.playWorld(
            'fire.ignite',
            session.player.position.x,
            session.player.position.y + 1,
            session.player.position.z,
          );
          game.firstPerson?.swing();
        },
        onFlintAlreadyPrimed: () => { game.firstPerson?.swing(); },
        dropOverflow: (stack) => game.spawnDroppedStack(stack),
      },
    };
  }

  private removeDoor(x: number, y: number, z: number): void {
    const session = this.session!;
    const { lowerY, upperY } = clearDoorBlocks(session.world, x, y, z);
    session.redstone.notifyBlockChanged(x, lowerY, z);
    session.redstone.notifyBlockChanged(x, upperY, z);
  }

  private updateFoodUse(): void {
    const session = this.session!;
    if (session.bowUseTicks > 0) {
      const stack = this.selectedStack();
      if (this.input.using && stack?.itemId === ItemId.Bow) session.bowUseTicks += 1;
      else {
        if (stack?.itemId === ItemId.Bow) this.releaseBow(stack);
        session.bowUseTicks = 0;
      }
    }
    if (session.foodUseTicks <= 0) return;
    const stack = this.selectedStack();
    const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
    if (!this.input.using || item?.kind !== 'food' || !session.survival.canConsumeFood(item.id)) {
      session.foodUseTicks = 0;
      return;
    }
    session.foodUseTicks += 1;
    const eatOrDrink = consumableSoundEvent(item);
    if (session.foodUseTicks >= 32) {
      if (session.survival.consumeFood(item, session.inventory)) {
        this.playLocal(eatOrDrink);
        this.ui.toast(`Съедено: ${item.name}`);
      }
      session.foodUseTicks = 0;
    } else if (session.foodUseTicks % 8 === 0) {
      this.playLocal(eatOrDrink, { volume: 0.55 });
    }
  }

  private releaseBow(stack: ItemStack): void {
    const session = this.session!;
    const charge = session.combat.bowCharge(session.bowUseTicks);
    if (!charge.canFire) return;
    if (session.summary.mode === 'survival' && !this.consumeArrow(session)) {
      this.ui.toast('Нужна стрела');
      return;
    }
    if (session.summary.mode !== 'survival') {
      this.lastConsumedArrow = session.inventory.has(ItemId.FireArrow, 1) ? ItemId.FireArrow : ItemId.Arrow;
    }
    const direction = session.player.viewDirection();
    const origin = session.player.eyePosition().addScaledVector(direction, 0.35);
    const flaming = this.lastConsumedArrow === ItemId.FireArrow;
    session.arrows.spawn(origin, direction, charge.launchSpeed, charge.baseDamage, charge.critical, flaming);
    if (session.summary.mode === 'survival') {
      session.inventory.setSlot(session.selectedSlot, damageItem(stack, 1));
    }
    this.playLocal('bow.shoot');
    this.firstPerson?.swing();
  }

  private processMobEvents(): void {
    const session = this.session!;
    for (const drop of session.mobs.consumeDrops()) {
      session.drops.spawn(drop.stack, drop.position, { velocity: drop.velocity });
    }
    for (const event of session.mobs.consumePlayerDamage()) this.damagePlayerFromMob(event);
    for (const event of session.mobs.consumeExplosions()) {
      this.explosionQueue.enqueue({
        x: event.position.x,
        y: event.position.y,
        z: event.position.z,
        radius: event.radius,
        power: event.power,
      });
    }
  }

  private processDetachedBlocks(): void {
    const session = this.session!;
    const events = session.world.consumeDetachedBlocks();
    if (events.length) session.redstone.notifyBlocksChanged(events);
    for (const event of events) {
      // Environmental drops also exist in Creative; lava destroys without loot.
      const drop = getBlockDefinition(event.block).drop;
      if (!drop || event.reason === 'lava') continue;
      const count = drop.count ?? (drop.min !== undefined
        ? drop.min + Math.floor(Math.random() * ((drop.max ?? drop.min) - drop.min + 1)) : 1);
      if (count > 0) this.spawnDroppedStack(createItemStack(drop.item, count),
        new THREE.Vector3(event.x + 0.5, event.y + 0.3, event.z + 0.5));
    }
  }

  private updateRedstone(): void {
    const session = this.session!;
    const occupied = new Set<string>();
    const living: Readonly<THREE.Vector3>[] = [
      session.player.position,
      ...session.mobs.entities.map((mob) => mob.position),
    ];
    const items: Readonly<THREE.Vector3>[] = session.drops.entities.map((drop) => drop.position);
    const occupy = (positions: readonly Readonly<THREE.Vector3>[], livingOnly: boolean): void => {
      void livingOnly;
      for (const position of positions) {
        const x = Math.floor(position.x);
        const z = Math.floor(position.z);
        const feetY = Math.floor(position.y + 0.05);
        for (const y of [feetY, feetY - 1]) {
          const block = session.world.getBlock(x, y, z);
          if (!isPressurePlateBlock(block)) continue;
          const trigger = getBlockDefinition(block).pressurePlateTrigger ?? 'all';
          if (trigger === 'living' && livingOnly === false) continue;
          const key = blockKey(x, y, z);
          if (occupied.has(key)) continue;
          occupied.add(key);
          session.redstone.setPressurePlateOccupied(x, y, z, true);
        }
      }
    };
    occupy(living, true);
    occupy(items, false);
    for (const key of session.activePressurePlates) {
      if (occupied.has(key)) continue;
      const [x, y, z] = key.split(',').map(Number) as [number, number, number];
      session.redstone.setPressurePlateOccupied(x, y, z, false);
    }
    session.activePressurePlates = occupied;
    session.redstone.update(FIXED_DT);
    for (const event of session.redstone.consumeExplosionEvents()) {
      this.explosionQueue.enqueue({
        x: event.position.x,
        y: event.position.y,
        z: event.position.z,
        radius: event.radius,
        power: event.power,
      });
    }
  }

  private damagePlayerFromMob(event: MobPlayerDamageEvent): void {
    const session = this.session!;
    if (session.summary.mode === 'creative') return;
    const damage = session.survival.damage(event.amount, event.source === 'arrow' ? 'projectile' : 'melee', {
      armor: session.inventory,
    });
    if (!damage.fullHurt) return;
    if (event.source === 'melee') {
      session.player.receiveMeleeKnockback({
        x: session.player.position.x - event.position.x,
        z: session.player.position.z - event.position.z,
      });
    } else if (event.knockback) session.player.velocity.add(event.knockback);
  }

  private processExplosionQueue(): void {
    const session = this.session!;
    if (this.explosionQueue.pendingCount === 0) return;
    const mobile = isCoarsePointer();
    const changed: Array<{ x: number; y: number; z: number }> = [];
    this.explosionQueue.process(session.world, {
      budgetMs: mobile ? 1.8 : 3.5,
      maxJobs: mobile ? 6 : 12,
      maxVoxels: mobile ? 256 : 512,
      remainingPrimedCapacity: session.redstone.primedCapacityRemaining,
      onResolved: (job) => {
        this.applyExplosionDamage(job.x, job.y, job.z, job.radius, job.power);
        if (shouldPlayExplosion(this.explosionSounds, job, session.playTicks)) {
          this.playWorld('explosion', job.x, job.y, job.z);
        }
      },
      onContents: (block) => {
        changed.push({ x: block.x, y: block.y, z: block.z });
        this.releaseBlockEntityContents({
          x: block.x,
          y: block.y,
          z: block.z,
          block: block.previous,
          distance: 0,
          normal: new THREE.Vector3(),
          point: new THREE.Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5),
        });
      },
      onChainedTnt: (tnt) => {
        session.redstone.primeTnt(tnt.x, tnt.y, tnt.z, tnt.fuseSeconds, { blockAlreadyRemoved: true });
      },
    });
    if (changed.length > 0) session.redstone.notifyBlocksChanged(changed);
  }

  private applyExplosionDamage(x: number, y: number, z: number, radius: number, power: number): void {
    const session = this.session!;
    const originX = x;
    const originY = y;
    const originZ = z;
    const playerX = session.player.position.x;
    const playerY = session.player.position.y + session.player.height * 0.5;
    const playerZ = session.player.position.z;
    const dx = playerX - originX;
    const dy = playerY - originY;
    const dz = playerZ - originZ;
    const distanceToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const playerExposure = clamp(1 - distanceToPlayer / (radius * 1.7), 0, 1);
    if (session.summary.mode === 'survival' && playerExposure > 0) {
      session.survival.damage(Math.ceil(playerExposure * power * 5), 'explosion', { armor: session.inventory });
      const lengthSq = dx * dx + dy * dy + dz * dz;
      if (lengthSq > 1e-6) {
        const inverse = 1 / Math.sqrt(lengthSq);
        session.player.velocity.x += dx * inverse * playerExposure * 8;
        session.player.velocity.y += dy * inverse * playerExposure * 8 + playerExposure * 4;
        session.player.velocity.z += dz * inverse * playerExposure * 8;
      }
    }
    const attackerPosition = new THREE.Vector3(originX, originY, originZ);
    for (const mob of session.mobs.entities) {
      const distance = mob.position.distanceTo(attackerPosition);
      const exposure = clamp(1 - distance / (radius * 1.5), 0, 1);
      if (exposure > 0) {
        session.mobs.damage(mob, exposure * power * 5, {
          source: 'explosion',
          attackerPosition,
          knockback: exposure * 8,
        });
      }
    }
  }

  private dropSelectedItem(): void {
    const session = this.session;
    if (!session || this.lifecycle.state !== 'PLAYING') return;
    const stack = this.selectedStack();
    if (!stack) return;
    if (session.online) {
      session.online.client.send({
        type: 'inventory_action',
        action: 'drop_selected',
        slot: session.selectedSlot,
        count: 1,
      });
      return;
    }
    const dropped = { ...stack, count: 1 };
    session.inventory.setSlot(session.selectedSlot, stack.count <= 1 ? null : { ...stack, count: stack.count - 1 });
    session.drops.drop(dropped, session.player.eyePosition(), session.player.viewDirection());
    this.refreshHud();
  }

  private spawnDroppedStack(stack: ItemStack, position?: THREE.Vector3): void {
    const session = this.session;
    if (!session || session.online) return;
    session.drops.spawn(stack, position ?? session.player.position.clone().add(new THREE.Vector3(0, 0.35, 0)), {
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.4, 2.2, (Math.random() - 0.5) * 1.4),
    });
  }

  private consumeArrow(session: GameSession): boolean {
    const selected = this.selectedStack();
    if (selected?.itemId === ItemId.FireArrow && session.inventory.remove(ItemId.FireArrow, 1) === 1) {
      this.lastConsumedArrow = ItemId.FireArrow;
      return true;
    }
    if (session.inventory.remove(ItemId.FireArrow, 1) === 1) {
      this.lastConsumedArrow = ItemId.FireArrow;
      return true;
    }
    if (session.inventory.remove(ItemId.Arrow, 1) === 1) {
      this.lastConsumedArrow = ItemId.Arrow;
      return true;
    }
    this.lastConsumedArrow = undefined;
    return false;
  }

  private mountMinecart(id: string): void {
    const session = this.session!;
    const cart = session.minecarts.get(id);
    if (!cart || !session.minecarts.isRideable(cart)) return;
    session.ridingCartId = id;
    this.minecartDismountHeld = true;
    session.player.position.set(cart.position.x, cart.position.y + 0.2, cart.position.z);
    session.player.previousPosition.copy(session.player.position);
    session.player.velocity.set(0, 0, 0);
  }

  private updateMinecartRiding(session: GameSession): void {
    const id = session.ridingCartId;
    if (!id) {
      this.minecartDismountHeld = this.input.movement().sprint;
      return;
    }
    const cart = session.minecarts.get(id);
    if (!cart || !session.minecarts.isRideable(cart)) {
      session.ridingCartId = undefined;
      return;
    }
    const edge = minecartDismountFromSprint(this.input.movement().sprint, this.minecartDismountHeld);
    this.minecartDismountHeld = edge.held;
    if (edge.dismount) {
      session.ridingCartId = undefined;
      const exit = session.minecarts.findDismountPosition(cart);
      session.player.position.copy(exit);
      session.player.previousPosition.copy(exit);
      session.player.velocity.set(0, 0, 0);
      return;
    }
    session.player.position.set(cart.position.x, cart.position.y + 0.2, cart.position.z);
    session.player.previousPosition.set(cart.previousPosition.x, cart.previousPosition.y + 0.2, cart.previousPosition.z);
    session.player.velocity.copy(cart.velocity);
    session.player.fallDistance = 0;
  }

  private selectedStack(): ItemStack | null {
    return this.session?.inventory.getSlot(this.session.selectedSlot) ?? null;
  }

  private selectHotbar(index: number): void {
    if (!this.session) return;
    this.session.selectedSlot = clamp(Math.floor(index), 0, 8);
    this.canvas.dataset.hotbar = String(this.session.selectedSlot);
    this.session.miningProgress = 0;
    this.session.miningTarget = undefined;
    this.session.foodUseTicks = 0;
    this.session.bowUseTicks = 0;
    this.session.combat.setHeldItem(this.selectedStack()?.itemId);
    this.refreshHud();
  }

  private openChat(prefix = ''): void {
    if (!this.session || this.lifecycle.state !== 'PLAYING') return;
    if (this.ui.isInventoryOpen() || this.ui.isChatOpen()) return;
    this.input.releaseActions();
    this.input.releasePointerLock();
    this.ui.setChatInputHistory(this.chat.history);
    this.ui.openChat(prefix);
  }

  private closeChatAndResumeLook(): void {
    this.ui.closeChat();
    this.input.clearHeldKeys();
    this.lifecycle.resumePlayingIfVisible();
    this.canvas.focus({ preventScroll: true });
    if (this.lifecycle.state === 'PLAYING') this.input.tryRequestPointerLock();
  }

  private submitChat(raw: string): void {
    const session = this.session;
    if (!session) return;
    const trimmed = raw.replace(/\s+$/g, '');
    if (!trimmed) {
      this.closeChatAndResumeLook();
      return;
    }
    this.chat.rememberInput(trimmed);
    this.ui.setChatInputHistory(this.chat.history);
    if (session.online) {
      session.online.client.send({ type: 'chat', text: trimmed });
      this.closeChatAndResumeLook();
      return;
    }
    const dispatched = dispatchChatLine(trimmed, this.commandContext());
    if (dispatched.parsed.kind === 'say') {
      this.pushChat('player', `<${PLAYER_CHAT_NAME}> ${dispatched.parsed.text}`);
    } else if (dispatched.parsed.kind === 'command') {
      this.pushChat('command', trimmed);
      const kind = dispatched.result?.ok ? 'system' : 'error';
      for (const line of dispatched.result?.lines ?? []) {
        if (line) this.pushChat(kind, line);
      }
    }
    this.closeChatAndResumeLook();
  }

  private pushChat(kind: 'system' | 'player' | 'command' | 'death' | 'error', text: string): void {
    const message = this.chat.push(kind, text);
    this.ui.appendChat(message.kind, message.text, message.createdAtMs);
  }

  private commandContext(): CommandContext {
    const session = this.session!;
    return {
      playerName: PLAYER_CHAT_NAME,
      get mode() { return session.summary.mode; },
      setMode: (mode) => this.setGameMode(mode),
      get timeOfDay() { return session.world.timeOfDay; },
      setTime: (ticks) => {
        session.world.timeOfDay = ((Math.floor(ticks) % 24_000) + 24_000) % 24_000;
      },
      get seed() { return session.summary.seed; },
      give: (itemId, count) => this.giveItems(itemId, count),
      teleport: (x, y, z) => this.teleportPlayer(x, y, z),
      playerPosition: () => ({
        x: session.player.position.x,
        y: session.player.position.y,
        z: session.player.position.z,
      }),
      clearInventory: () => {
        let count = 0;
        for (const stack of session.inventory.slots) if (stack) count += stack.count;
        for (const stack of Object.values(session.inventory.armor)) if (stack) count += stack.count;
        if (session.inventory.offhand) count += session.inventory.offhand.count;
        session.inventory.clear();
        this.refreshHud();
        return count;
      },
      kill: () => {
        session.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
      },
    };
  }

  private setGameMode(mode: GameMode): void {
    const session = this.session!;
    session.summary.mode = mode;
    session.player.creativeFlightAllowed = mode === 'creative';
    if (mode !== 'creative') session.player.isFlying = false;
    this.refreshHud();
  }

  private giveItems(itemId: string, count: number): { given: number; leftover: number } {
    const session = this.session!;
    const leftover = session.inventory.addItem(itemId, count);
    if (leftover > 0) {
      this.spawnDroppedStack(
        createItemStack(itemId, leftover),
        session.player.position.clone().add(new THREE.Vector3(0, 0.35, 0)),
      );
    }
    this.refreshHud();
    return { given: count - leftover, leftover };
  }

  private teleportPlayer(x: number, y: number, z: number): void {
    const session = this.session!;
    session.ridingCartId = undefined;
    const destination = new THREE.Vector3(x, clamp(y, 1, WORLD_HEIGHT - 3), z);
    session.player.teleport(destination);
  }

  private listenerPose() {
    const session = this.session;
    if (!session) return undefined;
    const eye = session.player.eyePosition();
    return { x: eye.x, y: eye.y, z: eye.z, yaw: session.player.yaw, pitch: session.player.pitch };
  }

  private playLocal(event: SoundEventId, options?: PlaySoundOptions): void {
    this.audio.play(event, options);
  }

  private playWorld(event: SoundEventId, x: number, y: number, z: number, options?: PlaySoundOptions): void {
    this.audio.playAt(event, { x, y, z }, this.listenerPose(), options);
  }

  private playBlockSound(
    action: BlockSoundAction,
    blockId: BlockId,
    x: number,
    y: number,
    z: number,
    options?: PlaySoundOptions,
  ): void {
    this.audio.playBlock(action, blockId, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, this.listenerPose(), options);
  }

  private closeOpenChestAudio(): void {
    if (!this.openChestKey) return;
    const [x, y, z] = this.openChestKey.split(',').map(Number) as [number, number, number];
    this.playWorld('chest.close', x + 0.5, y + 0.5, z + 0.5);
    this.openChestKey = undefined;
  }

  private updateFootsteps(session: GameSession, horizontalDistance: number): void {
    if (!advanceFootsteps(this.footsteps, {
      grounded: session.player.onGround,
      flying: session.player.isFlying,
      inWater: session.player.inWater,
      sprinting: session.player.sprinting,
      horizontalDistance,
    })) return;
    const feet = blockUnderFeet(session.player.position.x, session.player.position.y, session.player.position.z);
    let block = session.world.getBlock(feet.x, feet.y, feet.z, false);
    if (block === BlockId.Air && feet.y > 0) {
      block = session.world.getBlock(feet.x, feet.y - 1, feet.z, false);
      feet.y -= 1;
    }
    // Player-local: keep material from the block underfoot, but do not pan below the camera.
    this.playBlockSound('step', block, feet.x, feet.y, feet.z, { positional: false });
  }

  private onPlayerDamaged(result: DamageResult): void {
    if (result.accepted && !result.ignored && (result.dealt > 0 || result.fullHurt)) {
      this.playLocal('player.hurt');
    }
    if (!result.fullHurt || result.ignored) return;
    this.hurt.trigger(performance.now(), { periodic: isPeriodicDamageSource(result.source) });
  }

  /** Close overlays and restore PLAYING input after an online respawn. */
  private restoreOnlinePlayingFromRespawn(): void {
    const session = this.session;
    if (!session?.online) return;
    this.lifecycle.beginOnlineRespawnRestore();
    this.deathShown = false;
    session.ridingCartId = undefined;
    session.miningProgress = 0;
    session.miningTarget = undefined;
    session.worldRenderer.setOpenChest(undefined);
    const chatOpen = this.ui.isChatOpen();
    const inventoryOpen = this.ui.isInventoryOpen();
    this.ui.closeInventory(false);
    this.ui.closeChat();
    this.ui.hidePointerLockFallback();
    this.ui.enterGame();
    const plan = planOnlineRespawnInputRestore({
      state: this.lifecycle.state,
      pointerLocked: this.input.isPointerLocked(),
      chatOpen,
      inventoryOpen,
    });
    if (plan.clearHeldKeys) this.input.clearHeldKeys();
    this.lifecycle.setState(plan.lifecycle);
    this.lifecycle.resumePlayingIfVisible();
    if (plan.focusCanvas) this.canvas.focus({ preventScroll: true });
    let requestedLock = false;
    if (plan.requestPointerLock && this.lifecycle.state === 'PLAYING') {
      requestedLock = this.input.tryRequestPointerLock();
    }
    if (!requestedLock) this.lifecycle.endOnlineRespawnRestore();
  }

  private handleDeath(source?: DamageSource): void {
    const session = this.session;
    if (!session || this.deathShown) return;
    if (session.online) return;
    this.deathShown = true;
    this.pushChat('death', deathMessage(source ?? session.survival.lastDamage?.source ?? 'generic'));
    this.ui.closeChat();
    this.lifecycle.setState('DEAD');
    this.ui.hidePointerLockFallback();
    this.input.releasePointerLock();
    if (session.summary.mode === 'survival') {
      for (const stack of session.inventory.slots) if (stack) this.spawnDroppedStack(stack);
      for (const stack of Object.values(session.inventory.armor)) if (stack) this.spawnDroppedStack(stack);
      if (session.inventory.offhand) this.spawnDroppedStack(session.inventory.offhand);
      session.inventory.clear();
    }
    void this.saveSession();
    this.ui.showDeath(
      () => {
        session.survival.respawn(session.player, session.survival.spawnPoint);
        this.deathShown = false;
        this.enterPlaying();
      },
      () => void this.saveAndQuit(),
    );
  }

  private render(alpha: number): void {
    const now = performance.now();
    const session = this.session;
    if (session) {
      if (session.online) {
        const position = session.player.position;
        this.camera.position.set(position.x, position.y + session.player.eyeHeight, position.z);
      } else {
        const position = this.interpolatedPlayerPosition
          .copy(session.player.previousPosition)
          .lerp(session.player.position, clamp(alpha, 0, 1));
        this.camera.position.set(position.x, position.y + session.player.eyeHeight, position.z);
      }
      applyImmediateRenderLook(this.camera, this.input, this.hurt.cameraRoll(now));
      session.online?.remotes.forEach((remote) => remote.interpolate(now));
      if (session.online) {
        applyInterpolatedEntityVisuals(session, session.online.interpolator, now);
      } else {
        session.falling.interpolate(clamp(alpha, 0, 1));
        session.redstone.interpolatePrimedTnt(clamp(alpha, 0, 1));
        session.mobs.interpolateVisuals(alpha);
        session.drops.interpolateVisuals(alpha);
        session.arrows.interpolateVisuals(alpha);
        session.minecarts.interpolateVisuals(alpha);
      }
      const sprintFov = session.player.sprinting ? 7 : 0;
      const bowZoom = session.bowUseTicks > 0
        ? session.combat.bowCharge(session.bowUseTicks).power * 8
        : 0;
      const nextFov = this.camera.fov + ((this.settings.fov + sprintFov - bowZoom) - this.camera.fov) * 0.18;
      if (Math.abs(nextFov - this.camera.fov) >= 0.02) {
        this.camera.fov = nextFov;
        this.camera.updateProjectionMatrix();
      }
      this.updateEnvironment(session.world.timeOfDay);
    }
    this.ui.setHurtFlash(this.hurt.flashAlpha(now));
    this.ui.fadeChatLines(now, chatLineOpacity);
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.firstPerson?.render(this.renderer);
  }

  private updateFirstPerson(deltaSeconds: number): void {
    const viewmodel = this.firstPerson;
    if (!viewmodel) return;
    const session = this.session;
    const state = this.firstPersonFrameState;
    state.visible = session !== undefined
      && this.lifecycle.state === 'PLAYING'
      && !this.ui.isInventoryOpen();
    if (session) {
      state.movementSpeed = Math.hypot(session.player.velocity.x, session.player.velocity.z);
      state.onGround = session.player.onGround;
      state.sprinting = session.player.sprinting;
      state.mining = this.input.mining && session.target !== undefined;
      state.foodUseProgress = session.foodUseTicks > 0 ? clamp(session.foodUseTicks / 32, 0, 1) : 0;
      state.bowCharge = session.bowUseTicks > 0 ? session.combat.bowCharge(session.bowUseTicks).power : 0;
      state.swordBlocking = session.combat.swordBlocking;
      state.onFire = session.survival.isOnFire;
      state.invisible = session.survival.invisible;
      const invisible = session.survival.hasEffect('invisibility');
      const regenerating = session.survival.hasEffect('regeneration');
      state.potionActive = invisible || regenerating;
      state.potionKind = invisible && regenerating
        ? 'both'
        : regenerating
          ? 'regeneration'
          : 'invisibility';
    } else {
      state.movementSpeed = 0;
      state.onGround = false;
      state.sprinting = false;
      state.mining = false;
      state.foodUseProgress = 0;
      state.bowCharge = 0;
      state.swordBlocking = false;
      state.onFire = false;
      state.invisible = false;
      state.potionActive = false;
      state.potionKind = undefined;
    }
    viewmodel.update(deltaSeconds, state);
  }

  private updateEnvironment(time: number): void {
    const phase = (time / 24_000) * Math.PI * 2;
    const sunHeight = Math.sin(phase);
    const daylight = daylightFactor(time);
    const sky = sunHeight > -0.18
      ? this.currentSkyColor.copy(this.duskSkyColor).lerp(this.daySkyColor, clamp((sunHeight + 0.18) * 2.6, 0, 1))
      : this.currentSkyColor.copy(this.nightSkyColor).lerp(this.duskSkyColor, clamp((sunHeight + 0.72) * 1.85, 0, 1));
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(sky);
    this.ambient.intensity = 0.14 + daylight * 0.32;
    this.sunlight.intensity = 0.18 + daylight * 1.55;
    this.sunlight.color.set(daylight > 0.45 ? 0xffe2b3 : 0x8ea7d4);
    const session = this.session!;
    const center = session.player.position;
    this.sun.position.set(center.x + Math.cos(phase) * 70, center.y + sunHeight * 70, center.z + 15);
    this.sunlight.position.copy(this.sun.position);
    session.worldRenderer.setDaylight(daylight);
    this.moon.position.set(center.x - Math.cos(phase) * 70, center.y - sunHeight * 70, center.z - 15);
    this.sun.visible = sunHeight > -0.25;
    this.moon.visible = sunHeight < 0.25;
  }

  private refreshHud(): void {
    const session = this.session;
    if (!session) return;
    const target = session.target ? getBlockDefinition(session.target.block).name : '—';
    if (this.debugVisible && (session.playTicks >= this.debugNextTick || this.cachedDebugText.length === 0)) {
      this.debugNextTick = session.playTicks + 7;
      const frameTiming = this.frameTimings.snapshot();
      const tickTiming = this.tickTimings.snapshot();
      const renderInfo = this.renderer.info.render;
      const itemCache = this.itemVisuals?.cacheStats;
      const sfx = this.audio.debugSnapshot();
      this.cachedDebugText = `FPS ${this.fps} · frame ${frameTiming.averageMs.toFixed(2)} / p95 ${frameTiming.p95Ms.toFixed(2)} / spike ${frameTiming.maximumMs.toFixed(2)} ms\nTPS ${TICK_RATE} fixed · tick ${tickTiming.averageMs.toFixed(2)} / spike ${tickTiming.maximumMs.toFixed(2)} ms\nXYZ ${session.player.position.x.toFixed(2)} / ${session.player.position.y.toFixed(2)} / ${session.player.position.z.toFixed(2)}\nLight ${session.world.skyLightAt(Math.floor(session.player.position.x), Math.floor(session.player.position.y + session.player.eyeHeight), Math.floor(session.player.position.z))} sky / ${session.world.blockLightAt(Math.floor(session.player.position.x), Math.floor(session.player.position.y + session.player.eyeHeight), Math.floor(session.player.position.z))} block\nChunk ${this.chunkDebugLine(session)}\nChunks ${session.worldRenderer.chunkCount}/${session.world.chunks.size} · dirty ${session.world.dirtyChunkCount} · jobs gen ${this.lastChunkGenerationJobs} mesh ${this.lastChunkMeshJobs}\nFaces ${session.worldRenderer.faceCount} · triangles ${renderInfo.triangles} · calls ${renderInfo.calls}\nGen ${session.world.generationAverageMs.toFixed(2)} avg / ${session.world.generationMaximumMs.toFixed(2)} max ms · mesh ${session.worldRenderer.meshAverageMs.toFixed(2)} avg / ${session.worldRenderer.meshMaximumMs.toFixed(2)} max ms\nTarget ${target}\nMobs ${session.mobs.count} · Projectiles ${session.mobs.projectileCount + session.arrows.count} · Drops ${session.drops.count}\nViewmodel ${this.firstPerson?.heldCategory ?? 'hand'} · item cache ${itemCache?.blockGeometries ?? 0}/${itemCache?.itemTextures ?? 0}\nSFX ${sfx.bufferCount}/${sfx.catalogFiles} buf · ${sfx.voiceCount} voices · ${sfx.contextState}${sfx.muted ? ' muted' : ''}\nRedstone ${session.redstone.sourceCount} · Primed TNT ${session.redstone.primedTntCount} · boom Q ${this.explosionQueue.pendingCount}/${this.explosionQueue.lastTick.processed} vx ${this.explosionQueue.lastTick.destroyed} · ${this.explosionQueue.lastTick.cpuMs.toFixed(2)}/${this.explosionQueue.lastTick.relightMs.toFixed(2)} ms sky ${this.explosionQueue.lastTick.skyRecomputes}\nSeed ${session.summary.seed} · ${session.summary.mode}`;
      if (this.debugTickOrder && this.kernelTrace.length > 0) {
        this.cachedDebugText += `\nKernel ${formatGameplayKernelTrace(this.kernelTrace)}`;
      }
    }
    const debug = this.debugVisible ? this.cachedDebugText : undefined;
    this.ui.updateHud({
      inventory: session.inventory,
      selectedSlot: session.selectedSlot,
      health: session.summary.mode === 'creative' ? 20 : session.survival.health,
      hunger: session.summary.mode === 'creative' ? 20 : session.survival.hunger,
      armor: getArmorPoints(session.inventory),
      absorption: session.survival.absorption,
      miningProgress: session.miningProgress,
      effects: potionHudEntries((id) => session.survival.effectTicks(id)),
      ...(debug ? { debug } : {}),
    });
  }

  private disposeSession(): void {
    this.polishQaDispose?.();
    this.polishQaDispose = undefined;
    if (!this.session) return;
    if (this.session.online) {
      for (const view of this.session.online.remotes.values()) {
        this.scene.remove(view.group);
        view.dispose();
      }
      this.session.online.remotes.clear();
      this.session.online.client.disconnect();
    }
    this.scene.remove(this.session.worldRenderer.group);
    this.session.worldRenderer.dispose();
    this.session.arrows.dispose();
    this.session.minecarts.dispose();
    this.session.mobs.dispose();
    this.session.redstone.dispose();
    this.session.drops.dispose();
    this.session.falling.dispose();
    this.session.entityHost.dispose();
    disposeWorldLighting(this.session.world);
    this.explosionQueue.clear();
    resetMiningSound(this.miningSound);
    resetFootsteps(this.footsteps);
    this.openChestKey = undefined;
    this.worldLoad = undefined;
    this.session = undefined;
    this.chat.clear();
    this.ui.clearChat();
    this.inspectFreeze = null;
    this.inspectorHud = '';
    this.overlayCategories.clear();
    this.slowArmed.clear();
    this.slowSnapshots = [];
    this.lastInspectMeshWanted.clear();
    this.streamingTrace.reset(performance.now());
    this.firstPerson?.setHeldItems();
    this.input.releaseActions();
  }

  private chunkDebugLine(session: GameSession): string {
    const x = Math.floor(session.player.position.x);
    const y = Math.floor(session.player.position.y);
    const z = Math.floor(session.player.position.z);
    const chunkX = floorDiv(x, 16);
    const chunkZ = floorDiv(z, 16);
    const chunk = session.world.getChunk(chunkX, chunkZ, false);
    const look = this.lightDebugMode === 1 ? 'SKY' : this.lightDebugMode === 2 ? 'BLOCK' : this.lightDebugMode === 3 ? 'FINAL' : 'off';
    const biome = session.world.biomeAt(x, z);
    if (!chunk) return `${chunkX},${chunkZ} missing · ${biome}  F7=${look} F8=${this.chunkGridVisible ? 'on' : 'off'} F9=${this.inspectFreeze ? 'frozen' : 'live'}`;
    const key = `${chunkX},${chunkZ}`;
    const mesh = session.worldRenderer.hasChunk(key) ? 'mesh' : 'nomesh';
    const lit = chunk.lightingReady ? 'lit' : `sky${chunk.skyReady ? '1' : '0'}/blk${chunk.blockLightReady ? '1' : '0'}`;
    const stale = chunk.lightMeshStale ? ' STALE' : '';
    const base = `${chunkX},${chunkZ} ${lit} ${mesh} lv ${chunk.lightVersion}/${chunk.meshedLightVersion} sky ${session.world.skyLightAt(x, y, z)} blk ${session.world.blockLightAt(x, y, z)}${stale} · ${biome}  F7=${look} F8=${this.chunkGridVisible ? 'on' : 'off'} F9=${this.inspectFreeze ? 'frozen' : 'live'}`;
    if (!isWorldgenDebugQueryEnabled()) return base;
    const column = session.world.generator.columnAt(x, z);
    const floor = session.world.generator.bedrockHeight(x, z);
    const cap = stoneCapY(floor);
    const cave = session.world.generator.isCave(x, y, z, column.height) ? 1 : 0;
    const block = session.world.getBlock(x, y, z, false);
    return `${base}  surfaceY=${column.height} mtn=${column.mountain.toFixed(1)} hills=${column.hills.toFixed(1)} cave=${cave} cap=${cap} blk=${block}`;
  }

  private updateChunkGrid(): void {
    if (!this.session || !this.chunkGridVisible) {
      this.chunkGrid.setVisible(false);
      return;
    }
    this.chunkGrid.setVisible(true);
    const position = this.session.player.position;
    const highlights: Array<{ cx: number; cz: number; color: number }> = [];
    const playerCx = floorDiv(Math.floor(position.x), 16);
    const playerCz = floorDiv(Math.floor(position.z), 16);
    highlights.push({ cx: playerCx, cz: playerCz, color: 0xffffff });
    if (this.inspectFreeze) {
      highlights.push({ cx: this.inspectFreeze.cx, cz: this.inspectFreeze.cz, color: 0xff4fd8 });
    }
    this.chunkGrid.update(position.x, position.y, position.z, this.settings.renderDistance + 1, {
      colorAt: (cx, cz) => categoryColor(this.overlayCategories.get(inspectChunkKey(cx, cz)) ?? 'absent'),
      highlights,
      colorRevision: this.overlayRevision,
    });
  }

  private cycleLightDebug(): void {
    this.lightDebugMode = (this.lightDebugMode + 1) % 4;
    setWorldLightDebug(this.lightDebugMode);
    this.debugNextTick = 0;
  }

  private bindLifecycle(): void {
    this.lifecycle.changed.subscribe((state) => {
      if (state === 'PLAYING') {
        this.audio.resume();
        this.yandex.gameplayStart();
      } else {
        this.session?.combat.updateUse(false, false, false);
        this.audio.pause();
        this.yandex.gameplayStop();
      }
      if (state === 'BACKGROUND') void this.saveSession();
    });
  }

  private pauseForPlatform(): void {
    if (this.lifecycle.state === 'PLAYING') {
      this.lifecycle.setState('AD');
      this.input.releaseActions();
      void this.saveSession();
    }
  }

  private resumeFromPlatform(): void {
    if (this.lifecycle.state === 'AD' && this.session) this.enterPlaying();
  }

  private mountAudioDebug(): void {
    if (!import.meta.env.DEV) return;
    (window as Window & { __frontierAudio?: AudioManager }).__frontierAudio = this.audio;
    if (new URLSearchParams(location.search).get('audioDebug') !== '1') return;
    this.audioDebug = document.createElement('pre');
    this.audioDebug.id = 'audio-debug';
    this.audioDebug.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;pointer-events:none;background:#000c;color:#9f9;padding:8px;font:12px monospace;max-width:min(520px,92vw);white-space:pre-wrap';
    document.body.append(this.audioDebug);
    this.audioDebugTimer = window.setInterval(() => this.refreshAudioDebug(), 200);
    this.refreshAudioDebug();
  }

  private refreshAudioDebug(): void {
    if (!this.audioDebug) return;
    const snap = this.audio.debugSnapshot();
    const recent = snap.recentPlays.slice(-12).map((play) =>
      `${play.event} ${play.file} p${play.pitch.toFixed(2)} v${play.volume.toFixed(2)}${play.positional ? ' 3d' : ''}`).join('\n');
    this.audioDebug.textContent = [
      `SFX ${snap.bufferCount}/${snap.catalogFiles} decoded · voices ${snap.voiceCount} · ctx ${snap.contextState}`,
      `vol ${snap.masterVolume.toFixed(2)}${snap.muted ? ' muted' : ''}${snap.paused ? ' paused' : ''}`,
      snap.missingFiles.length ? `missing files: ${snap.missingFiles.join(', ')}` : 'files ok',
      snap.missingEvents.length ? `missing events: ${snap.missingEvents.join(', ')}` : 'events ok',
      recent || '(no plays yet)',
    ].join('\n');
  }

  private disposeAudioDebug(): void {
    if (this.audioDebugTimer !== undefined) window.clearInterval(this.audioDebugTimer);
    this.audioDebugTimer = undefined;
    this.audioDebug?.remove();
    this.audioDebug = undefined;
    const host = window as Window & { __frontierAudio?: AudioManager };
    if (host.__frontierAudio === this.audio) delete host.__frontierAudio;
  }

  private bindWindowEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pagehide', () => void this.saveSession());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.saveSession();
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'F3' && !event.repeat) {
        event.preventDefault();
        this.debugVisible = !this.debugVisible;
        this.debugNextTick = 0;
        if (!this.debugVisible) this.cachedDebugText = '';
        this.refreshHud();
      }
      if (event.code === 'F9' && !event.repeat) {
        event.preventDefault();
        const session = this.session;
        if (session) {
          const fallback = {
            cx: floorDiv(Math.floor(session.player.position.x), 16),
            cz: floorDiv(Math.floor(session.player.position.z), 16),
          };
          this.inspectFreeze = toggleInspectFreeze(this.inspectFreeze, this.lastFrontTarget ?? fallback);
          this.lastInspectorAt = 0;
          this.updateChunkGrid();
        }
      }
      if (event.code === 'F8' && !event.repeat) {
        event.preventDefault();
        this.chunkGridVisible = !this.chunkGridVisible;
        this.lastInspectorAt = 0;
        this.updateChunkGrid();
        this.debugNextTick = 0;
      }
      if (event.code === 'F7' && !event.repeat) {
        event.preventDefault();
        this.cycleLightDebug();
      }
    });
    document.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.firstPerson?.resize(width, height);
  }
}
