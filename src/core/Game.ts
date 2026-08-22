import * as THREE from 'three';
import {
  BlockId,
  buttonPlacementFromHit,
  canHarvestBlock,
  doorFacingFromYaw,
  getBlockDefinition,
  isPressurePlateBlock,
  isSlabBlock,
  isStairBlock,
  ladderPlacementFromHit,
  miningProgressPerTick,
  miningToolFromItemId,
  slabTypeFromHit,
  stairPlacementFromHit,
  torchPlacementFromHit,
  type BlockAttachment,
  type HorizontalFacing,
} from '../blocks';
import { CombatSystem, PlayerArrowManager } from '../combat';
import { AudioManager } from './AudioManager';
import {
  AUTOSAVE_INTERVAL_SECONDS,
  DEFAULT_RENDER_DISTANCE_DESKTOP,
  DEFAULT_RENDER_DISTANCE_MOBILE,
  FIXED_DT,
  MAX_FRAME_DELTA,
  PLAYER_REACH,
  TICK_RATE,
  WORLD_HEIGHT,
  blockKey,
  clamp,
  floorDiv,
} from './constants';
import { GameLifecycleManager } from './Lifecycle';
import { RollingTimingWindow } from './PerformanceStats';
import {
  DroppedItemManager,
  FallingBlockManager,
  MobManager,
  type MobPlayerDamageEvent,
  type SerializedDroppedItem,
  type SerializedFallingBlock,
  type SerializedMob,
} from '../entities';
import { InputManager } from '../input/InputManager';
import { Inventory, createItemStack, damageItem, type ItemStack } from '../inventory';
import { ItemId, getItemDefinition, tryGetItemDefinition } from '../items';
import { PlayerController } from '../player';
import { RedstoneSystem, type SerializedRedstoneState } from '../redstone';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { ItemIconRenderer } from '../rendering/ItemIconRenderer';
import { applyImmediateRenderLook } from '../rendering/cameraLook';
import { ArrowVisualFactory } from '../rendering/ArrowVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';
import { WorldRenderer } from '../rendering/WorldRenderer';
import { SaveService } from '../save/SaveService';
import type { GameMode, SerializedWorldState, WorldSummary } from '../save/types';
import { SurvivalSystem } from '../survival';
import { GameUI } from '../ui/GameUI';
import { VoxelWorld, type VoxelHit } from '../world/World';
import { blockCollisionBoxes } from '../world/collision';
import {
  defaultSlabType,
  defaultStairFacing,
  defaultStairHalf,
  slabLocalBoxes,
  stairLocalBoxes,
} from '../rendering/specialBlockGeometry';
import { ExplosionQueue } from '../world/ExplosionQueue';
import { YandexGamesService } from '../yandex/YandexGamesService';

interface GameSession {
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
}

interface RuntimeSettings {
  volume: number;
  sensitivity: number;
  renderDistance: number;
  fov: number;
}

const isCoarsePointer = (): boolean => matchMedia('(pointer: coarse)').matches;

export class Game {
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
    shieldRaised: false,
  };
  private atlas?: TextureAtlas;
  private itemVisuals?: ItemVisualFactory;
  private itemIcons?: ItemIconRenderer;
  private arrowVisuals?: ArrowVisualFactory;
  private firstPerson?: FirstPersonRenderer;
  private session?: GameSession;
  private readonly explosionQueue = new ExplosionQueue();
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
  private screenBeforeSettings: 'main' | 'pause' = 'main';
  private lastSavePromise: Promise<void> = Promise.resolve();
  private deathShown = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
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

    this.input = new InputManager(this.canvas, {
      canCapture: () => this.lifecycle.state === 'PLAYING' && !this.ui.isInventoryOpen(),
      toggleInventory: () => this.toggleInventory(),
      togglePause: () => this.togglePause(),
      dropItem: () => this.dropSelectedItem(),
      selectHotbar: (index) => this.selectHotbar(index),
    });
    this.ui.onHotbarSelect = (index) => this.selectHotbar(index);
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
    ]);
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
    this.disposeSession();
    this.firstPerson?.dispose();
    this.itemVisuals?.dispose();
    this.itemIcons?.dispose();
    this.arrowVisuals?.dispose();
    this.atlas?.dispose();
    this.renderer.dispose();
    this.saves.close();
    this.yandex.dispose();
  }

  private showMainMenu(): void {
    this.lifecycle.setState('MENU');
    this.ui.showMainMenu({
      play: () => void this.showWorldList(),
      settings: () => {
        this.screenBeforeSettings = 'main';
        this.showSettings();
      },
      controls: () => this.ui.showControls(() => this.showMainMenu()),
    });
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
    world.restore(state);
    let inventory: Inventory;
    try {
      inventory = Inventory.deserialize(state.player.inventory);
    } catch (error) {
      console.warn('Inventory save was invalid; starting with an empty inventory.', error);
      inventory = new Inventory();
    }
    await this.startSession(state.summary, world, inventory, state);
  }

  private async startSession(
    summary: WorldSummary,
    world: VoxelWorld,
    inventory: Inventory,
    restored?: SerializedWorldState,
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
    const spawn = restored?.player.position ?? this.findSpawn(world);
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
      onDeath: () => this.handleDeath(),
    });
    survival.setSpawnPoint(restored?.player.spawnPoint ?? spawn);
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
    const drops = new DroppedItemManager(this.scene, world, {
      visualFactory: itemVisuals,
      onPickup: (stack) => {
        const remainder = inventory.add(stack as ItemStack);
        const accepted = stack.count - (remainder?.count ?? 0);
        if (accepted > 0) {
          this.audio.playTone(660, 0.05, 0.025);
          this.ui.toast(`Подобрано: ${getItemDefinition(stack.itemId).name}`);
        }
        return accepted;
      },
    });
    if (restored?.droppedItems) drops.restore(restored.droppedItems as SerializedDroppedItem[]);
    const falling = new FallingBlockManager(this.scene, world, itemVisuals);
    if (restored?.fallingBlocks) {
      falling.restore(restored.fallingBlocks as SerializedFallingBlock[]);
    }

    const selectedSlot = clamp(restored?.player.selectedSlot ?? 0, 0, 8);
    const mobs = new MobManager(this.scene, world, {
      maxMobs: isCoarsePointer() ? 24 : 40,
      passiveCap: isCoarsePointer() ? 10 : 16,
      hostileCap: isCoarsePointer() ? 14 : 24,
      maxProjectiles: isCoarsePointer() ? 20 : 40,
      arrowVisualFactory: arrowVisuals,
    });
    if (restored?.mobs) mobs.restore(restored.mobs as SerializedMob[]);
    const combat = new CombatSystem({
      heldItemId: inventory.getSlot(selectedSlot)?.itemId,
      offhandItemId: inventory.offhand?.itemId,
    });
    const arrows = new PlayerArrowManager(this.scene, world, mobs, { visualFactory: arrowVisuals });

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
      redstone,
      activePressurePlates,
      selectedSlot,
      miningProgress: 0,
      foodUseTicks: 0,
      bowUseTicks: 0,
      playTicks: Math.floor(summary.playTimeSeconds * TICK_RATE),
      lastAutosaveTick: 0,
    };
    this.canvas.dataset.hotbar = String(this.session.selectedSlot);
    this.firstPerson?.setHeldItems(
      inventory.getSlot(this.session.selectedSlot)?.itemId,
      inventory.offhand?.itemId,
    );
    world.ensureChunks(Math.floor(player.position.x), Math.floor(player.position.z), 2);
    let rebuilt = 0;
    for (const chunk of [...world.chunks.values()]) {
      worldRenderer.rebuild(chunk);
      rebuilt += 1;
      if (rebuilt % 4 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    this.deathShown = false;
    this.enterPlaying();
  }

  private findSpawn(world: VoxelWorld): [number, number, number] {
    for (let radius = 0; radius <= 24; radius += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (radius > 0 && Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
          const surface = world.surfaceY(x, z);
          const floor = world.getBlock(x, surface, z);
          if ((floor === BlockId.GrassBlock || floor === BlockId.Sand)
            && !world.isSolid(x, surface + 1, z) && !world.isSolid(x, surface + 2, z)) {
            return [x + 0.5, surface + 1.01, z + 0.5];
          }
        }
      }
    }
    return [0.5, world.generator.columnAt(0, 0).height + 2, 0.5];
  }

  private enterPlaying(): void {
    this.ui.closeInventory();
    this.ui.enterGame();
    this.lifecycle.setState('PLAYING');
    this.previousTime = performance.now();
    this.accumulator = 0;
  }

  private toggleInventory(): void {
    const session = this.session;
    if (!session || this.lifecycle.state === 'DEAD' || this.lifecycle.state === 'MENU') return;
    if (this.ui.isInventoryOpen()) {
      this.ui.closeInventory();
      this.enterPlaying();
      return;
    }
    this.lifecycle.setState('PAUSED');
    this.ui.openInventory({
      inventory: session.inventory,
      mode: session.summary.mode,
      kind: 'inventory',
      onClose: () => {
        this.ui.closeInventory();
        this.enterPlaying();
      },
      onDrop: (stack) => this.spawnDroppedStack(stack),
      onChanged: () => this.refreshHud(),
    });
  }

  private openBlockInventory(kind: 'crafting-table' | 'chest' | 'furnace', hit: VoxelHit): void {
    const session = this.session!;
    this.lifecycle.setState('PAUSED');
    this.ui.openInventory({
      inventory: session.inventory,
      mode: session.summary.mode,
      kind,
      ...(kind === 'chest' ? { chest: session.world.getChest(hit.x, hit.y, hit.z) } : {}),
      ...(kind === 'furnace' ? { furnace: session.world.getFurnace(hit.x, hit.y, hit.z) } : {}),
      onClose: () => {
        this.ui.closeInventory();
        this.enterPlaying();
        void this.saveSession();
      },
      onDrop: (stack) => this.spawnDroppedStack(stack),
      onChanged: () => this.refreshHud(),
    });
  }

  private togglePause(): void {
    if (!this.session || this.lifecycle.state === 'MENU' || this.lifecycle.state === 'LOADING') return;
    if (this.ui.isInventoryOpen()) {
      this.ui.closeInventory();
      this.enterPlaying();
      return;
    }
    if (this.lifecycle.state === 'PLAYING') {
      this.lifecycle.setState('PAUSED');
      document.exitPointerLock?.();
      void this.saveSession();
      this.ui.showPause({
        resume: () => this.enterPlaying(),
        settings: () => {
          this.screenBeforeSettings = 'pause';
          this.showSettings();
        },
        saveAndQuit: () => void this.saveAndQuit(),
      });
    } else if (this.lifecycle.state === 'PAUSED') this.enterPlaying();
  }

  private showSettings(): void {
    this.ui.showSettings((settings) => {
      this.settings = settings;
      this.audio.setVolume(settings.volume);
      this.input.setSensitivity(settings.sensitivity);
      this.camera.fov = settings.fov;
      this.camera.updateProjectionMatrix();
      if (this.scene.fog instanceof THREE.Fog) this.scene.fog.far = settings.renderDistance * 16 + 28;
    }, () => {
      if (this.screenBeforeSettings === 'pause' && this.session) {
        this.ui.showPause({
          resume: () => this.enterPlaying(),
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
    if (!session) return;
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
        selectedSlot: session.selectedSlot,
        spawnPoint: [...session.survival.spawnPoint],
        inventory: session.inventory.serialize(),
      },
      modifications: session.world.serializeModifications(),
      chests: Object.fromEntries(session.world.chests),
      furnaces: Object.fromEntries(session.world.furnaces),
      droppedItems: session.drops.serialize(),
      fallingBlocks: session.falling.serialize(),
      blockStates: session.world.serializeBlockStates(),
      mobs: session.mobs.serialize(),
      redstone: session.redstone.serialize(),
    };
    session.summary = state.summary;
    this.lastSavePromise = this.lastSavePromise.then(() => this.saves.saveWorld(state)).catch((error) => {
      console.error('Autosave failed.', error);
      this.ui.toast('Не удалось сохранить мир');
    });
    await this.lastSavePromise;
  }

  private frame(now: number): void {
    const rawElapsed = Math.max(0, (now - this.previousTime) / 1000);
    const elapsed = Math.min(MAX_FRAME_DELTA, rawElapsed);
    this.previousTime = now;
    this.frameTimings.add(rawElapsed * 1000);
    this.fpsFrames += 1;
    this.fpsTimer += elapsed;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
    if (this.lifecycle.simulating) {
      this.accumulator += elapsed;
      while (this.accumulator >= FIXED_DT) {
        const tickStart = performance.now();
        this.tick();
        this.tickTimings.add(performance.now() - tickStart);
        this.accumulator -= FIXED_DT;
      }
    } else this.accumulator = 0;
    this.updateFirstPerson(elapsed);
    this.render(this.accumulator / FIXED_DT);
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
  }

  private tick(): void {
    const session = this.session;
    if (!session) return;
    session.playTicks += 1;
    session.world.tick();
    for (const spawn of session.world.consumeFallingBlocks()) {
      session.falling.spawn(spawn.block, spawn.x, spawn.y, spawn.z);
    }
    session.falling.update(FIXED_DT);

    const selected = this.selectedStack();
    session.combat.setHeldItem(selected?.itemId);
    session.combat.setOffhand(session.inventory.offhand?.itemId);
    this.firstPerson?.setHeldItems(selected?.itemId, session.inventory.offhand?.itemId);
    const holdingShield = selected?.itemId === ItemId.Shield || session.inventory.offhand?.itemId === ItemId.Shield;
    session.combat.setUsingShield(
      this.input.using && holdingShield && session.foodUseTicks <= 0 && session.bowUseTicks <= 0,
    );
    session.combat.tick(FIXED_DT);

    const movementBefore = this.input.movement();
    const drawingBow = session.bowUseTicks > 0;
    const movementMultiplier = drawingBow ? Math.min(0.2, session.combat.movementMultiplier) : session.combat.movementMultiplier;
    const playerInput = {
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      movement: () => ({
        ...movementBefore,
        forward: movementBefore.forward * movementMultiplier,
        right: movementBefore.right * movementMultiplier,
        sprint: !drawingBow && movementBefore.sprint
          && movementMultiplier === 1
          && (session.summary.mode === 'creative' || session.survival.hunger > 6),
      }),
    };
    const playerResult = session.player.tick(session.world, playerInput, FIXED_DT, (damage, cause) => {
      if (session.summary.mode === 'survival') session.survival.damage(damage, cause, { armor: session.inventory });
    });
    if (session.summary.mode === 'survival') {
      const survivalResult = session.survival.tick(FIXED_DT, {
        player: session.player,
        world: session.world,
        armor: session.inventory,
        horizontalDistance: playerResult.horizontalDistance,
        sprinting: session.player.sprinting,
        swimming: session.player.inWater,
        jumped: playerResult.jumped,
        onDeath: () => this.handleDeath(),
      });
      if (survivalResult.dead) {
        this.handleDeath();
        return;
      }
    }

    this.lastChunkGenerationJobs = session.world.ensureChunks(
      Math.floor(session.player.position.x),
      Math.floor(session.player.position.z),
      this.settings.renderDistance,
      1,
    ).length;
    if (session.playTicks % 80 === 0) {
      const removed = session.world.pruneChunks(Math.floor(session.player.position.x), Math.floor(session.player.position.z), this.settings.renderDistance);
      session.worldRenderer.removeChunks(removed);
    }
    // Never combine a synchronous generation job with a mesh job in one fixed tick.
    // Dirty flags coalesce repeated changes, and the time budget prevents a two-mesh burst.
    this.lastChunkMeshJobs = this.lastChunkGenerationJobs > 0
      ? 0
      : session.worldRenderer.rebuildDirty(isCoarsePointer() ? 1 : 2, isCoarsePointer() ? 4 : 7);
    this.updateTargetAndActions();
    this.updateFoodUse();
    session.arrows.tick(FIXED_DT);
    session.mobs.update(FIXED_DT, {
      playerPosition: session.player.position,
      playerEyePosition: session.player.eyePosition(),
      playerAlive: !session.survival.dead,
      playerTargetable: session.summary.mode === 'survival',
      daylight: this.daylightFactor(session.world.timeOfDay),
    });
    this.processMobEvents();
    this.processExplosionQueue();
    if (session.summary.mode === 'survival' && session.survival.dead) {
      this.handleDeath();
      return;
    }
    session.drops.update(FIXED_DT, { collectorPosition: session.player.position });
    this.updateRedstone();
    if (session.summary.mode === 'survival' && session.survival.dead) {
      this.handleDeath();
      return;
    }

    if (session.playTicks - session.lastAutosaveTick >= AUTOSAVE_INTERVAL_SECONDS * TICK_RATE) {
      session.lastAutosaveTick = session.playTicks;
      void this.saveSession();
    }
    if (session.playTicks % 2 === 0) this.refreshHud();
  }

  private updateTargetAndActions(): void {
    const session = this.session!;
    const origin = session.player.eyePosition();
    const direction = session.player.viewDirection();
    session.target = session.world.raycast(origin, direction, PLAYER_REACH);
    session.worldRenderer.setTarget(session.target);
    const mobTarget = session.mobs.raycast(origin, direction, Math.min(3, PLAYER_REACH));
    const attackPressed = this.input.consumeAttackPressed();
    const targetKey = session.target ? `${session.target.x},${session.target.y},${session.target.z}` : undefined;
    if (mobTarget) {
      session.miningTarget = undefined;
      session.miningProgress = 0;
      if (attackPressed) {
        const stack = this.selectedStack();
        const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
        const result = session.combat.performMeleeAttack(stack?.itemId ?? null, {
          critical: {
            fallDistance: session.player.fallDistance,
            onGround: session.player.onGround,
            sprinting: session.player.sprinting,
            inWater: session.player.inWater,
            onLadder: session.player.onLadder,
          },
          attackerSprinting: session.player.sprinting,
          attackerYaw: session.player.yaw,
        });
        session.mobs.damage(mobTarget.mob, result.damage, {
          source: 'player',
          attackerPosition: origin,
          knockback: result.knockback.length(),
        });
        if (session.summary.mode === 'survival') {
          if (stack && (item?.kind === 'tool' || (item?.kind === 'weapon' && item.weapon === 'sword'))) {
            session.inventory.setSlot(session.selectedSlot, damageItem(stack, 1));
          }
          session.survival.addExhaustion(0.1);
        }
        this.audio.playTone(result.critical ? 520 : 310, 0.055, result.critical ? 0.055 : 0.035);
      }
    } else if (!this.input.mining || !session.target) {
      session.miningTarget = undefined;
      session.miningProgress = 0;
    } else {
      if (session.miningTarget !== targetKey) {
        session.miningTarget = targetKey;
        session.miningProgress = 0;
      }
      const definition = getBlockDefinition(session.target.block);
      if (definition.breakable !== false && definition.hardness >= 0) {
        session.miningProgress += session.summary.mode === 'creative' ? 1 : this.miningDelta(definition, this.selectedStack());
        if (session.miningProgress >= 1) this.breakTarget();
      }
    }
    if (attackPressed) this.firstPerson?.swing();
    if (this.input.consumeUsePressed()) this.useTargetOrItem();
  }

  private miningDelta(definition: ReturnType<typeof getBlockDefinition>, tool: ItemStack | null): number {
    return miningProgressPerTick(definition, miningToolFromItemId(tool?.itemId));
  }

  private breakTarget(): void {
    const session = this.session!;
    const hit = session.target;
    if (!hit) return;
    const definition = getBlockDefinition(hit.block);
    const toolStack = this.selectedStack();
    const item = toolStack ? tryGetItemDefinition(toolStack.itemId) : undefined;
    const harvestable = canHarvestBlock(definition, miningToolFromItemId(toolStack?.itemId));
    if (hit.block === BlockId.OakDoor) this.removeDoor(hit.x, hit.y, hit.z);
    else {
      session.world.setBlock(hit.x, hit.y, hit.z, BlockId.Air);
      session.redstone.notifyBlockChanged(hit.x, hit.y, hit.z);
    }
    session.miningProgress = 0;
    session.miningTarget = undefined;
    this.audio.playTone(145 + (hit.block % 9) * 12, 0.045, 0.035);
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
    const hit = session.target;
    if (hit) {
      if (hit.block === BlockId.CraftingTable) return this.openBlockInventory('crafting-table', hit);
      if (hit.block === BlockId.Chest) return this.openBlockInventory('chest', hit);
      if (hit.block === BlockId.Furnace) return this.openBlockInventory('furnace', hit);
      if (hit.block === BlockId.Lever) {
        const active = session.redstone.toggleLever(hit.x, hit.y, hit.z);
        if (active !== undefined) {
          this.audio.playTone(active ? 480 : 260, 0.045, 0.03);
          this.ui.toast(active ? 'Рычаг включён' : 'Рычаг выключен');
          this.firstPerson?.swing();
        }
        return;
      }
      if (hit.block === BlockId.StoneButton) {
        if (session.redstone.pressButton(hit.x, hit.y, hit.z)) {
          this.audio.playTone(420, 0.035, 0.025);
          this.firstPerson?.swing();
        }
        return;
      }
      if (hit.block === BlockId.OakDoor) {
        this.toggleDoor(hit.x, hit.y, hit.z);
        this.audio.playTone(310, 0.04, 0.03);
        this.firstPerson?.swing();
        return;
      }
      if (hit.block === BlockId.WhiteBed) {
        session.survival.setSpawnPoint([hit.x + 0.5, hit.y + 1.01, hit.z + 0.5]);
        if (session.world.timeOfDay > 12_500 && session.world.timeOfDay < 23_500) {
          session.world.timeOfDay = 1_000;
          this.ui.toast('Ночь пропущена. Точка возрождения установлена.');
        } else this.ui.toast('Точка возрождения установлена');
        void this.saveSession();
        return;
      }
    }
    const stack = this.selectedStack();
    const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
    if (item?.kind === 'food') {
      session.foodUseTicks = 1;
      return;
    }
    if (stack?.itemId === ItemId.Bow) {
      session.bowUseTicks = 1;
      return;
    }
    if (!hit || !stack || item?.placesBlockId === undefined) return;
    if (this.tryMergeSlab(hit, item.placesBlockId)) return;
    const hitDefinition = getBlockDefinition(hit.block);
    const replaceHit = hitDefinition.replaceable === true;
    const x = replaceHit ? hit.x : hit.x + hit.normal.x;
    const y = replaceHit ? hit.y : hit.y + hit.normal.y;
    const z = replaceHit ? hit.z : hit.z + hit.normal.z;
    if (this.tryMergeSlabAt(x, y, z, item.placesBlockId)) return;
    const existing = getBlockDefinition(session.world.getBlock(x, y, z));
    if (!existing.replaceable && session.world.getBlock(x, y, z) !== BlockId.Air) return;
    const placed = getBlockDefinition(item.placesBlockId);
    if (item.placesBlockId === BlockId.OakDoor) {
      this.placeDoor(x, y, z);
      return;
    }
    if (item.placesBlockId === BlockId.Torch || item.placesBlockId === BlockId.RedstoneTorch) {
      const view = session.player.viewDirection();
      const orientation = torchPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z, view.x, view.z);
      if (!orientation) {
        this.ui.toast('Факел нельзя поставить на потолок');
        return;
      }
      if (!this.finishPlacingBlock(x, y, z, item.placesBlockId, placed.solid)) return;
      session.world.setBlockState(x, y, z, orientation);
      return;
    }
    if (item.placesBlockId === BlockId.StoneButton) {
      const view = session.player.viewDirection();
      const orientation = buttonPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z, view.x, view.z);
      if (!this.finishPlacingBlock(x, y, z, item.placesBlockId, placed.solid)) return;
      session.redstone.setButtonOrientation(x, y, z, orientation.attachment, orientation.facing);
      return;
    }
    if (item.placesBlockId === BlockId.Ladder) {
      const orientation = ladderPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z);
      if (!orientation) {
        this.ui.toast('Лестницу можно поставить только на боковую сторону блока');
        return;
      }
      if (replaceHit || !hitDefinition.solid) {
        this.ui.toast('Лестнице нужна сплошная боковая опора');
        return;
      }
      if (!this.finishPlacingBlock(x, y, z, item.placesBlockId, placed.solid)) return;
      session.world.setBlockState(x, y, z, { facing: orientation.facing });
      return;
    }
    if (isPressurePlateBlock(item.placesBlockId)) {
      const support = getBlockDefinition(session.world.getBlock(x, y - 1, z, false));
      if (!support.solid) {
        this.ui.toast('Нажимную пластину можно поставить только сверху блока');
        return;
      }
      if (!this.finishPlacingBlock(x, y, z, item.placesBlockId, false)) return;
      return;
    }
    if (isSlabBlock(item.placesBlockId)) {
      const localY = hit.point ? hit.point.y - hit.y : 0.25;
      const slabType = slabTypeFromHit(hit.normal.x, hit.normal.y, hit.normal.z, localY);
      const boxes = slabLocalBoxes(slabType).map((box) => ({
        minX: x + box.minX, minY: y + box.minY, minZ: z + box.minZ,
        maxX: x + box.maxX, maxY: y + box.maxY, maxZ: z + box.maxZ,
      }));
      if (session.player.intersectsCollisionBoxes(boxes)) {
        this.ui.toast('Нельзя поставить блок внутри игрока');
        return;
      }
      if (!this.finishPlacingBlock(x, y, z, item.placesBlockId, false)) return;
      session.world.setBlockState(x, y, z, { slabType });
      return;
    }
    if (isStairBlock(item.placesBlockId)) {
      const view = session.player.viewDirection();
      const localY = hit.point ? hit.point.y - hit.y : 0.25;
      const placement = stairPlacementFromHit(
        hit.normal.x, hit.normal.y, hit.normal.z, localY, view.x, view.z,
      );
      const boxes = stairLocalBoxes(placement.facing, placement.stairHalf, 'straight').map((box) => ({
        minX: x + box.minX, minY: y + box.minY, minZ: z + box.minZ,
        maxX: x + box.maxX, maxY: y + box.maxY, maxZ: z + box.maxZ,
      }));
      if (session.player.intersectsCollisionBoxes(boxes)) {
        this.ui.toast('Нельзя поставить блок внутри игрока');
        return;
      }
      if (!this.finishPlacingBlock(x, y, z, item.placesBlockId, false)) return;
      session.world.setBlockState(x, y, z, { facing: placement.facing, stairHalf: placement.stairHalf });
      return;
    }
    if (placed.solid && session.player.intersectsBlock(x, y, z)) {
      this.ui.toast('Нельзя поставить блок внутри игрока');
      return;
    }
    if (session.world.setBlock(x, y, z, item.placesBlockId)) {
      session.redstone.notifyBlockChanged(x, y, z);
      if (item.placesBlockId === BlockId.Lever) {
        const orientation = this.leverPlacement(hit);
        session.redstone.setLeverOrientation(x, y, z, orientation.attachment, orientation.facing);
      }
      this.audio.playTone(230, 0.04, 0.025);
      this.firstPerson?.swing();
      if (session.summary.mode === 'survival') this.consumeSelected(1);
    }
  }

  private tryMergeSlab(hit: VoxelHit, placing: BlockId): boolean {
    if (!isSlabBlock(placing) || hit.block !== placing) return false;
    const existing = defaultSlabType(this.session!.world.getBlockState(hit.x, hit.y, hit.z));
    if (existing === 'double') return false;
    const ny = hit.normal.y;
    const merge = (existing === 'bottom' && ny > 0.5) || (existing === 'top' && ny < -0.5);
    if (!merge) return false;
    return this.mergeSlab(hit.x, hit.y, hit.z);
  }

  private tryMergeSlabAt(x: number, y: number, z: number, placing: BlockId): boolean {
    const session = this.session!;
    const dest = session.world.getBlock(x, y, z, false);
    if (!isSlabBlock(placing) || dest !== placing) return false;
    if (defaultSlabType(session.world.getBlockState(x, y, z)) === 'double') return false;
    return this.mergeSlab(x, y, z);
  }

  private mergeSlab(x: number, y: number, z: number): boolean {
    const session = this.session!;
    const boxes = slabLocalBoxes('double').map((box) => ({
      minX: x + box.minX, minY: y + box.minY, minZ: z + box.minZ,
      maxX: x + box.maxX, maxY: y + box.maxY, maxZ: z + box.maxZ,
    }));
    if (session.player.intersectsCollisionBoxes(boxes)) {
      this.ui.toast('Нельзя поставить блок внутри игрока');
      return true;
    }
    session.world.setBlockState(x, y, z, { slabType: 'double' });
    session.redstone.notifyBlockChanged(x, y, z);
    this.audio.playTone(230, 0.04, 0.025);
    this.firstPerson?.swing();
    if (session.summary.mode === 'survival') this.consumeSelected(1);
    return true;
  }

  private leverPlacement(hit: VoxelHit): { attachment: BlockAttachment; facing: HorizontalFacing } {
    const view = this.session!.player.viewDirection();
    return buttonPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z, view.x, view.z);
  }

  private finishPlacingBlock(x: number, y: number, z: number, block: BlockId, solid: boolean): boolean {
    const session = this.session!;
    if (solid && session.player.intersectsBlock(x, y, z)) {
      this.ui.toast('Нельзя поставить блок внутри игрока');
      return false;
    }
    if (!session.world.setBlock(x, y, z, block)) return false;
    session.redstone.notifyBlockChanged(x, y, z);
    this.audio.playTone(230, 0.04, 0.025);
    this.firstPerson?.swing();
    if (session.summary.mode === 'survival') this.consumeSelected(1);
    return true;
  }

  private doorHalves(x: number, y: number, z: number): { lowerY: number; upperY: number } {
    const session = this.session!;
    const state = session.world.getBlockState(x, y, z);
    const half = state?.half
      ?? (session.world.getBlock(x, y - 1, z, false) === BlockId.OakDoor ? 'upper' : 'lower');
    const lowerY = half === 'upper' ? y - 1 : y;
    return { lowerY, upperY: lowerY + 1 };
  }

  private placeDoor(x: number, y: number, z: number): void {
    const session = this.session!;
    if (y + 1 >= WORLD_HEIGHT) {
      this.ui.toast('Нет места для двери');
      return;
    }
    const upperBlock = session.world.getBlock(x, y + 1, z);
    const upperDefinition = getBlockDefinition(upperBlock);
    if (upperBlock !== BlockId.Air && !upperDefinition.replaceable) {
      this.ui.toast('Нет места для двери');
      return;
    }
    if (session.player.intersectsBlock(x, y, z) || session.player.intersectsBlock(x, y + 1, z)) {
      this.ui.toast('Нельзя поставить блок внутри игрока');
      return;
    }
    if (!session.world.setBlock(x, y, z, BlockId.OakDoor)) return;
    if (!session.world.setBlock(x, y + 1, z, BlockId.OakDoor)) {
      session.world.setBlock(x, y, z, BlockId.Air);
      return;
    }
    const facing = doorFacingFromYaw(session.player.yaw);
    session.world.setBlockState(x, y, z, { facing, hinge: 'left', open: false, half: 'lower' });
    session.world.setBlockState(x, y + 1, z, { facing, hinge: 'left', open: false, half: 'upper' });
    session.redstone.notifyBlockChanged(x, y, z);
    session.redstone.notifyBlockChanged(x, y + 1, z);
    this.audio.playTone(230, 0.04, 0.025);
    this.firstPerson?.swing();
    if (session.summary.mode === 'survival') this.consumeSelected(1);
  }

  private toggleDoor(x: number, y: number, z: number): void {
    const session = this.session!;
    const { lowerY, upperY } = this.doorHalves(x, y, z);
    const current = session.world.getBlockState(x, lowerY, z) ?? session.world.getBlockState(x, y, z);
    const next = {
      facing: current?.facing ?? 'north',
      hinge: current?.hinge ?? 'left' as const,
      open: current?.open !== true,
    };
    session.world.setBlockState(x, lowerY, z, { ...next, half: 'lower' });
    if (session.world.getBlock(x, upperY, z, false) === BlockId.OakDoor) {
      session.world.setBlockState(x, upperY, z, { ...next, half: 'upper' });
    }
  }

  private removeDoor(x: number, y: number, z: number): void {
    const session = this.session!;
    const { lowerY, upperY } = this.doorHalves(x, y, z);
    session.world.setBlock(x, lowerY, z, BlockId.Air);
    session.redstone.notifyBlockChanged(x, lowerY, z);
    if (session.world.getBlock(x, upperY, z, false) === BlockId.OakDoor) {
      session.world.setBlock(x, upperY, z, BlockId.Air);
      session.redstone.notifyBlockChanged(x, upperY, z);
    }
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
    if (session.foodUseTicks >= 32) {
      if (session.survival.consumeFood(item, session.inventory)) {
        this.audio.playTone(420, 0.08, 0.035);
        this.ui.toast(`Съедено: ${item.name}`);
      }
      session.foodUseTicks = 0;
    }
  }

  private releaseBow(stack: ItemStack): void {
    const session = this.session!;
    const charge = session.combat.bowCharge(session.bowUseTicks);
    if (!charge.canFire) return;
    if (session.summary.mode === 'survival' && session.inventory.remove(ItemId.Arrow, 1) !== 1) {
      this.ui.toast('Нужна стрела');
      return;
    }
    const direction = session.player.viewDirection();
    const origin = session.player.eyePosition().addScaledVector(direction, 0.35);
    session.arrows.spawn(origin, direction, charge.launchSpeed, charge.baseDamage, charge.critical);
    if (session.summary.mode === 'survival') {
      session.inventory.setSlot(session.selectedSlot, damageItem(stack, 1));
    }
    this.audio.playTone(charge.critical ? 760 : 540, 0.07, 0.035);
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
    this.processExplosionQueue();
  }

  private damagePlayerFromMob(event: MobPlayerDamageEvent): void {
    const session = this.session!;
    if (session.summary.mode === 'creative') return;
    const directionToAttacker = new THREE.Vector3().subVectors(event.position, session.player.position);
    const shield = session.combat.resolveShieldHit({
      damage: event.amount,
      directionToAttacker,
      defenderYaw: session.player.yaw,
      projectile: event.source === 'arrow',
    });
    if (shield.shieldDurabilityDamage > 0) this.damageEquippedShield(shield.shieldDurabilityDamage);
    if (shield.receivedDamage > 0) {
      const damage = session.survival.damage(shield.receivedDamage, event.source === 'arrow' ? 'projectile' : 'melee', {
        armor: session.inventory,
      });
      if (damage.dealt > 0) {
        const knockbackScale = event.amount > 0 ? shield.receivedDamage / event.amount : 0;
        session.player.velocity.addScaledVector(event.knockback, knockbackScale);
      }
    } else if (shield.blocked) {
      this.audio.playTone(185, 0.06, 0.045);
    }
  }

  private damageEquippedShield(amount: number): void {
    const session = this.session!;
    if (session.summary.mode === 'creative') return;
    const offhand = session.inventory.getSlot({ section: 'offhand' });
    if (offhand?.itemId === ItemId.Shield) {
      session.inventory.setSlot({ section: 'offhand' }, damageItem(offhand, amount));
      return;
    }
    const selected = this.selectedStack();
    if (selected?.itemId === ItemId.Shield) {
      session.inventory.setSlot(session.selectedSlot, damageItem(selected, amount));
    }
  }

  private processExplosionQueue(): void {
    const session = this.session!;
    if (this.explosionQueue.pendingCount === 0) return;
    const mobile = isCoarsePointer();
    const changed: Array<{ x: number; y: number; z: number }> = [];
    const stats = this.explosionQueue.process(session.world, {
      budgetMs: mobile ? 1.8 : 3.5,
      maxJobs: mobile ? 6 : 12,
      maxVoxels: mobile ? 256 : 512,
      remainingPrimedCapacity: session.redstone.primedCapacityRemaining,
      onResolved: (job) => this.applyExplosionDamage(job.x, job.y, job.z, job.radius, job.power),
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
    if (stats.processed > 0) {
      const sounds = Math.min(2, stats.processed);
      const gain = Math.min(0.14, 0.09 + (stats.processed - 1) * 0.01);
      for (let index = 0; index < sounds; index += 1) this.audio.playTone(72, 0.18, gain);
    }
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
    const dropped = { ...stack, count: 1 };
    session.inventory.setSlot(session.selectedSlot, stack.count <= 1 ? null : { ...stack, count: stack.count - 1 });
    session.drops.drop(dropped, session.player.eyePosition(), session.player.viewDirection());
    this.refreshHud();
  }

  private spawnDroppedStack(stack: ItemStack, position?: THREE.Vector3): void {
    const session = this.session;
    if (!session) return;
    session.drops.spawn(stack, position ?? session.player.position.clone().add(new THREE.Vector3(0, 0.35, 0)), {
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.4, 2.2, (Math.random() - 0.5) * 1.4),
    });
  }

  private consumeSelected(count: number): void {
    const session = this.session!;
    const stack = this.selectedStack();
    if (!stack) return;
    session.inventory.setSlot(session.selectedSlot, stack.count <= count ? null : { ...stack, count: stack.count - count });
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

  private handleDeath(): void {
    const session = this.session;
    if (!session || this.deathShown) return;
    this.deathShown = true;
    this.lifecycle.setState('DEAD');
    document.exitPointerLock?.();
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
    const session = this.session;
    if (session) {
      const position = this.interpolatedPlayerPosition
        .copy(session.player.previousPosition)
        .lerp(session.player.position, clamp(alpha, 0, 1));
      const eyeHeight = session.player.eyeHeight;
      this.camera.position.set(position.x, position.y + eyeHeight, position.z);
      applyImmediateRenderLook(this.camera, this.input);
      session.falling.interpolate(clamp(alpha, 0, 1));
      session.redstone.interpolatePrimedTnt(clamp(alpha, 0, 1));
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
      state.shieldRaised = session.combat.shieldActive;
    } else {
      state.movementSpeed = 0;
      state.onGround = false;
      state.sprinting = false;
      state.mining = false;
      state.foodUseProgress = 0;
      state.bowCharge = 0;
      state.shieldRaised = false;
    }
    viewmodel.update(deltaSeconds, state);
  }

  private updateEnvironment(time: number): void {
    const phase = (time / 24_000) * Math.PI * 2;
    const sunHeight = Math.sin(phase);
    const daylight = this.daylightFactor(time);
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

  private daylightFactor(time: number): number {
    const phase = (time / 24_000) * Math.PI * 2;
    return clamp((Math.sin(phase) + 0.22) / 0.75, 0.08, 1);
  }

  private refreshHud(): void {
    const session = this.session;
    if (!session) return;
    const target = session.target ? getBlockDefinition(session.target.block).name : '—';
    const chunkX = floorDiv(Math.floor(session.player.position.x), 16);
    const chunkZ = floorDiv(Math.floor(session.player.position.z), 16);
    if (this.debugVisible && (session.playTicks >= this.debugNextTick || this.cachedDebugText.length === 0)) {
      this.debugNextTick = session.playTicks + 7;
      const frameTiming = this.frameTimings.snapshot();
      const tickTiming = this.tickTimings.snapshot();
      const renderInfo = this.renderer.info.render;
      const itemCache = this.itemVisuals?.cacheStats;
      this.cachedDebugText = `FPS ${this.fps} · frame ${frameTiming.averageMs.toFixed(2)} / p95 ${frameTiming.p95Ms.toFixed(2)} / spike ${frameTiming.maximumMs.toFixed(2)} ms\nTPS ${TICK_RATE} fixed · tick ${tickTiming.averageMs.toFixed(2)} / spike ${tickTiming.maximumMs.toFixed(2)} ms\nXYZ ${session.player.position.x.toFixed(2)} / ${session.player.position.y.toFixed(2)} / ${session.player.position.z.toFixed(2)}\nLight ${session.world.skyLightAt(Math.floor(session.player.position.x), Math.floor(session.player.position.y + session.player.eyeHeight), Math.floor(session.player.position.z))} sky / ${session.world.blockLightAt(Math.floor(session.player.position.x), Math.floor(session.player.position.y + session.player.eyeHeight), Math.floor(session.player.position.z))} block\nChunk ${chunkX}, ${chunkZ} · ${session.world.biomeAt(Math.floor(session.player.position.x), Math.floor(session.player.position.z))}\nChunks ${session.worldRenderer.chunkCount}/${session.world.chunks.size} · dirty ${session.world.dirtyChunkCount} · jobs gen ${this.lastChunkGenerationJobs} mesh ${this.lastChunkMeshJobs}\nFaces ${session.worldRenderer.faceCount} · triangles ${renderInfo.triangles} · calls ${renderInfo.calls}\nGen ${session.world.generationAverageMs.toFixed(2)} avg / ${session.world.generationMaximumMs.toFixed(2)} max ms · mesh ${session.worldRenderer.meshAverageMs.toFixed(2)} avg / ${session.worldRenderer.meshMaximumMs.toFixed(2)} max ms\nTarget ${target}\nMobs ${session.mobs.count} · Projectiles ${session.mobs.projectileCount + session.arrows.count} · Drops ${session.drops.count}\nViewmodel ${this.firstPerson?.heldCategory ?? 'hand'} · item cache ${itemCache?.blockGeometries ?? 0}/${itemCache?.itemTextures ?? 0}\nRedstone ${session.redstone.sourceCount} · Primed TNT ${session.redstone.primedTntCount} · boom Q ${this.explosionQueue.pendingCount}/${this.explosionQueue.lastTick.processed} vx ${this.explosionQueue.lastTick.destroyed} · ${this.explosionQueue.lastTick.cpuMs.toFixed(2)}/${this.explosionQueue.lastTick.relightMs.toFixed(2)} ms sky ${this.explosionQueue.lastTick.skyRecomputes}\nSeed ${session.summary.seed} · ${session.summary.mode}`;
    }
    const debug = this.debugVisible ? this.cachedDebugText : undefined;
    this.ui.updateHud({
      inventory: session.inventory,
      selectedSlot: session.selectedSlot,
      health: session.summary.mode === 'creative' ? 20 : session.survival.health,
      hunger: session.summary.mode === 'creative' ? 20 : session.survival.hunger,
      miningProgress: session.miningProgress,
      attackStrength: session.combat.getAttackStrength(this.selectedStack()?.itemId ?? null),
      ...(debug ? { debug } : {}),
    });
  }

  private disposeSession(): void {
    if (!this.session) return;
    this.scene.remove(this.session.worldRenderer.group);
    this.session.worldRenderer.dispose();
    this.session.arrows.dispose();
    this.session.mobs.dispose();
    this.session.redstone.dispose();
    this.session.drops.dispose();
    this.session.falling.dispose();
    this.explosionQueue.clear();
    this.session = undefined;
    this.firstPerson?.setHeldItems();
    this.input.releaseActions();
  }

  private bindLifecycle(): void {
    this.lifecycle.changed.subscribe((state) => {
      if (state === 'PLAYING') {
        this.audio.resume();
        this.yandex.gameplayStart();
      } else {
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

  private bindWindowEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pagehide', () => void this.saveSession());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.saveSession();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === null && this.lifecycle.state === 'PLAYING' && !isCoarsePointer()) this.togglePause();
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'F3' && !event.repeat) {
        event.preventDefault();
        this.debugVisible = !this.debugVisible;
        this.debugNextTick = 0;
        if (!this.debugVisible) this.cachedDebugText = '';
        this.refreshHud();
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
