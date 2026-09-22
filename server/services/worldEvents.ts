import { BlockId, getBlockDefinition, isKnownBlockId, type BlockRenderState } from '../../src/blocks';
import { CHUNK_SIZE, chunkKey, floorDiv, isValidWorldY, MAX_WORLD_Y, MIN_WORLD_Y, WORLDGEN_VERSION, blockKey, positiveMod } from '../../src/core/constants';
import { cloneStack, createItemStack, isSharedWorldChestBlock, type ItemStack } from '../../src/inventory';
import { Chunk } from '../../src/world/Chunk';
import type { FurnaceState, VoxelWorld } from '../../src/world/World';
import { sanitizeSignLines, type SignLines } from '../../src/world/sign';
import { isInsidePlayableBlock, isVolumeInsidePlayableWorld, WORLD_BORDER_MAX } from '../../src/world/worldBorder';
import { isDangerousBlock } from './rtp';
import { volumeContains, type BlockPos, type SelectionVolume } from './selection';
import {
  dayKey,
  decideDailySpawn,
  eventTimeline,
  formatDailyTime,
  minutesRemaining,
  MOSCOW_TIME_ZONE,
  nextDailyOccurrence,
  normalizeTimeZone,
  parseDailyTime,
  secondsRemaining,
  type EventTimeline,
} from './eventScheduler';
import { fillChestSlots, generateEventChestLoot } from './eventLoot';
import {
  createDefaultChestShrineTemplate,
  DEFAULT_EVENT_TEMPLATE_NAME,
  parseEventTemplateName,
  parseStoredTemplate,
  placedVolume,
  rotateBlockState,
  rotateOffset,
  captureTemplateFromWorld,
  templateFootprint,
  type EventTemplate,
  type TemplateYaw,
} from './eventTemplates';
import {
  buildEventSystemClaim,
  eventProtectionVolume,
  pointInEventProtection,
  volumeOverlapsEventProtection,
} from './eventProtection';
import { type Claim } from './claims';
import {
  emptyValidationContext,
  reservedAt,
  type SpawnValidationContext,
} from './spawnValidation';

export type WorldEventPhase =
  | 'scheduled'
  | 'warning_sent'
  | 'spawned_locked'
  | 'active_unlocked'
  | 'completed';

export type WorldEventJournalPhase = 'placing' | 'cleaning';

export interface WorldEventsConfig {
  enabled: boolean;
  dailyTime: string;
  timeZone: string;
  warningMinutes: number;
  unlockDelayMinutes: number;
  durationMinutes: number;
  spawnMinDistance: number;
  spawnMaxDistance: number;
  /** Exclusive playable |coord| bound; canonical value is WORLD_BORDER_MAX. */
  worldBorder: number;
  templateName: string;
  announceCoordinates: boolean;
  playerAvoidRadius: number;
  homeAvoidRadius: number;
  maxSearchAttempts: number;
  attemptsPerTick: number;
}

export const DEFAULT_WORLD_EVENTS_CONFIG: WorldEventsConfig = {
  enabled: true,
  dailyTime: '20:00',
  timeZone: MOSCOW_TIME_ZONE,
  warningMinutes: 15,
  unlockDelayMinutes: 5,
  durationMinutes: 120,
  spawnMinDistance: 3000,
  spawnMaxDistance: 5000,
  worldBorder: WORLD_BORDER_MAX,
  templateName: DEFAULT_EVENT_TEMPLATE_NAME,
  announceCoordinates: true,
  playerAvoidRadius: 64,
  homeAvoidRadius: 48,
  maxSearchAttempts: 80,
  attemptsPerTick: 4,
};

export const SEARCH_RETRY_MS = 30_000;
/** Wall-clock hint for one search tick of `continueGeneration`. One generator feature phase may still exceed this. */
export const EVENT_SEARCH_GENERATION_BUDGET_MS = 4;
/** Search must not finish several fresh far chunks in one server tick. */
export const EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK = 1;

const EVENT_TRANSIENT_BATCH = {
  skipSupport: true,
  deferLighting: true,
  record: false,
} as const;

export type NetworkWorldModifications = Record<string, Record<string, number>>;

function placementCellIndex(cell: Pick<EventPlacementCell, 'x' | 'y' | 'z'>): number {
  return Chunk.index(positiveMod(cell.x, CHUNK_SIZE), cell.y, positiveMod(cell.z, CHUNK_SIZE));
}

/**
 * Network-only composition: persistent terrain deltas plus the live event
 * overlay. Does not mutate `persistent` or `world.modifications`.
 * Air cells are kept — the template may carve generated terrain.
 */
export function overlayEventPlacementOnModifications(
  persistent: NetworkWorldModifications,
  placement: readonly EventPlacementCell[] | undefined,
): NetworkWorldModifications {
  if (!placement?.length) return persistent;
  const result: NetworkWorldModifications = { ...persistent };
  const copied = new Set<string>();
  for (const cell of placement) {
    if (!isValidWorldY(cell.y)) continue;
    const key = chunkKey(floorDiv(cell.x, CHUNK_SIZE), floorDiv(cell.z, CHUNK_SIZE));
    let chunk = result[key];
    if (!chunk) {
      chunk = {};
      result[key] = chunk;
      copied.add(key);
    } else if (!copied.has(key)) {
      chunk = { ...chunk };
      result[key] = chunk;
      copied.add(key);
    }
    chunk[String(placementCellIndex(cell))] = cell.blockId;
  }
  return result;
}

export function overlayEventPlacementOnChunkModifications(
  persistent: Record<string, number>,
  placement: readonly EventPlacementCell[] | undefined,
  cx: number,
  cz: number,
): Record<string, number> {
  if (!placement?.length) return persistent;
  let result: Record<string, number> | undefined;
  for (const cell of placement) {
    if (!isValidWorldY(cell.y)) continue;
    if (floorDiv(cell.x, CHUNK_SIZE) !== cx || floorDiv(cell.z, CHUNK_SIZE) !== cz) continue;
    result ??= { ...persistent };
    result[String(placementCellIndex(cell))] = cell.blockId;
  }
  return result ?? persistent;
}

export interface EventPlacementCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: BlockRenderState;
}

export interface WorldSnapshotCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: BlockRenderState;
  readonly chest?: Array<ItemStack | null>;
  readonly furnace?: FurnaceState;
  readonly sign?: SignLines;
}

export interface ActiveWorldEvent {
  readonly type: 'resource_chest';
  readonly id: string;
  phase: WorldEventPhase;
  readonly worldId: string;
  readonly templateName: string;
  readonly rotation: TemplateYaw;
  chest?: BlockPos;
  volume?: SelectionVolume;
  protectionVolume?: SelectionVolume;
  placement?: EventPlacementCell[];
  chestSlots?: Array<ItemStack | null>;
  spawnAt: number;
  warningAt: number;
  unlockAt: number;
  cleanupAt: number;
  loot?: ItemStack[];
  snapshot?: WorldSnapshotCell[];
  chestLocked: boolean;
}

interface WorldEventsJournal {
  phase: WorldEventJournalPhase;
  event: ActiveWorldEvent;
}

interface WorldEventsStore {
  lastSpawnDayKey?: string;
  active?: ActiveWorldEvent;
  journal?: WorldEventsJournal;
  templates: EventTemplate[];
}

interface SearchJob {
  attempts: number;
  yaw: TemplateYaw;
  template: EventTemplate;
  timeline: EventTimeline;
  day: string;
  countsAsDaily: boolean;
  context?: SpawnValidationContext;
  pending?: {
    x: number;
    z: number;
    chunks: Array<{ cx: number; cz: number }>;
  };
}

export interface WorldEventsHost {
  readonly world: VoxelWorld;
  worldId(): string;
  now(): number;
  random(): number;
  spawn(): readonly [number, number, number];
  loadStore(): unknown;
  saveStore(store: unknown): void;
  createValidationContext(): SpawnValidationContext;
  homes(): readonly { readonly x: number; readonly z: number }[];
  players(): readonly { readonly x: number; readonly y: number; readonly z: number }[];
  flush(): void;
  markDirty(): void;
  persistWorld?: () => void;
  closeChestWindow(x: number, y: number, z: number): void;
  broadcast(text: string): void;
  send(playerId: string, text: string): void;
  log(message: string): void;
  loadedWorldgenVersion?(): number | undefined;
  acknowledgeWorldgenMigration?(): void;
}

export type ForceSpawnResult =
  | { ok: true; event: ActiveWorldEvent }
  | { ok: true; searching: true }
  | { ok: false; error: string };

const PLAYERISH = new Set<number>([
  BlockId.Chest,
  BlockId.EventChest,
  BlockId.PortalChest,
  BlockId.Furnace,
  BlockId.CraftingTable,
  BlockId.OakPlanks,
  BlockId.BirchPlanks,
  BlockId.SprucePlanks,
  BlockId.WhiteWool,
  BlockId.RedWool,
  BlockId.OakDoor,
  BlockId.OakSign,
  BlockId.WhiteBed,
  BlockId.RedstoneWire,
  BlockId.RedstoneTorch,
  BlockId.Lever,
  BlockId.StoneButton,
  BlockId.OakPressurePlate,
  BlockId.StonePressurePlate,
  BlockId.Tnt,
  BlockId.TntPowerful,
  BlockId.TntDestructive,
  BlockId.Torch,
  BlockId.Lantern,
  BlockId.Rail,
  BlockId.Glowstone,
  BlockId.Ladder,
]);

function randomYaw(random: () => number): TemplateYaw {
  return ([0, 90, 180, 270] as const)[Math.floor(random() * 4)]!;
}

function footprintChunkCoords(
  template: EventTemplate,
  x: number,
  z: number,
  yaw: TemplateYaw,
): Array<{ cx: number; cz: number }> {
  const footprint = templateFootprint(template, yaw);
  const minCx = floorDiv(x + footprint.minX, CHUNK_SIZE);
  const maxCx = floorDiv(x + footprint.maxX, CHUNK_SIZE);
  const minCz = floorDiv(z + footprint.minZ, CHUNK_SIZE);
  const maxCz = floorDiv(z + footprint.maxZ, CHUNK_SIZE);
  const coords: Array<{ cx: number; cz: number }> = [];
  for (let cz = minCz; cz <= maxCz; cz += 1) {
    for (let cx = minCx; cx <= maxCx; cx += 1) coords.push({ cx, cz });
  }
  return coords;
}

function serializeStack(stack: ItemStack | null): ItemStack | null {
  return cloneStack(stack);
}

function parseStack(raw: unknown): ItemStack | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { itemId?: unknown; count?: unknown; durability?: unknown; metadata?: unknown };
  if (typeof record.itemId !== 'string' || typeof record.count !== 'number') return null;
  try {
    const stack = createItemStack(record.itemId, record.count);
    return {
      ...stack,
      ...(typeof record.durability === 'number' ? { durability: record.durability } : {}),
      ...(record.metadata ? { metadata: record.metadata as ItemStack['metadata'] } : {}),
    };
  } catch {
    return null;
  }
}

function parseFurnace(raw: unknown): FurnaceState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as { slots?: unknown; burnTime?: unknown; burnTotal?: unknown; cookTime?: unknown };
  if (!Array.isArray(value.slots) || value.slots.length !== 3) return undefined;
  return {
    slots: [parseStack(value.slots[0]), parseStack(value.slots[1]), parseStack(value.slots[2])],
    burnTime: typeof value.burnTime === 'number' ? value.burnTime : 0,
    burnTotal: typeof value.burnTotal === 'number' ? value.burnTotal : 0,
    cookTime: typeof value.cookTime === 'number' ? value.cookTime : 0,
  };
}

function parsePhase(raw: unknown): WorldEventPhase | undefined {
  if (raw === 'scheduled' || raw === 'warning_sent' || raw === 'spawned_locked'
    || raw === 'active_unlocked' || raw === 'completed') return raw;
  return undefined;
}

function parseYaw(raw: unknown): TemplateYaw {
  return raw === 90 || raw === 180 || raw === 270 ? raw : 0;
}

function parsePos(raw: unknown): BlockPos | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (![value.x, value.y, value.z].every((entry) => Number.isInteger(entry))) return undefined;
  return { x: value.x as number, y: value.y as number, z: value.z as number };
}

function parseVolume(raw: unknown): SelectionVolume | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const keys = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'] as const;
  if (!keys.every((key) => Number.isInteger(value[key]))) return undefined;
  return {
    minX: value.minX as number,
    minY: value.minY as number,
    minZ: value.minZ as number,
    maxX: value.maxX as number,
    maxY: value.maxY as number,
    maxZ: value.maxZ as number,
  };
}

function cloneEvent(event: ActiveWorldEvent): ActiveWorldEvent {
  return JSON.parse(JSON.stringify(event)) as ActiveWorldEvent;
}

function volumeHasModifications(world: VoxelWorld, volume: SelectionVolume): boolean {
  for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
    for (let x = volume.minX; x <= volume.maxX; x += 1) {
      const delta = world.modifications.get(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
      if (!delta || delta.size === 0) continue;
      const localX = positiveMod(x, CHUNK_SIZE);
      const localZ = positiveMod(z, CHUNK_SIZE);
      for (let y = volume.minY; y <= volume.maxY; y += 1) {
        if (delta.has(Chunk.index(localX, y, localZ))) return true;
      }
    }
  }
  return false;
}

function volumeHasPersistentRecords(world: VoxelWorld, volume: SelectionVolume): boolean {
  for (let y = volume.minY; y <= volume.maxY; y += 1) {
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        const key = blockKey(x, y, z);
        if (world.chests.has(key) || world.furnaces.has(key) || world.signs.has(key)) return true;
        const block = world.getBlock(x, y, z);
        if (PLAYERISH.has(block)) return true;
      }
    }
  }
  return false;
}

export function snapshotVolumeDetailed(world: VoxelWorld, volume: SelectionVolume): WorldSnapshotCell[] {
  const cells: WorldSnapshotCell[] = [];
  for (let y = volume.minY; y <= volume.maxY; y += 1) {
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        const blockId = world.getBlock(x, y, z);
        const state = world.getBlockState(x, y, z);
        const key = blockKey(x, y, z);
        const stored = world.chests.get(key);
        const furnace = world.furnaces.get(key);
        const sign = world.signs.get(key);
        cells.push({
          x, y, z, blockId,
          ...(state ? { state } : {}),
          ...(stored ? { chest: stored.slots.map(serializeStack) } : {}),
          ...(furnace ? {
            furnace: {
              slots: [
                serializeStack(furnace.slots[0]),
                serializeStack(furnace.slots[1]),
                serializeStack(furnace.slots[2]),
              ],
              burnTime: furnace.burnTime,
              burnTotal: furnace.burnTotal,
              cookTime: furnace.cookTime,
            },
          } : {}),
          ...(sign ? { sign } : {}),
        });
      }
    }
  }
  return cells;
}

export function restoreSnapshot(world: VoxelWorld, snapshot: readonly WorldSnapshotCell[]): void {
  world.applyBlockBatch(
    snapshot.map((cell) => ({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      block: isKnownBlockId(cell.blockId) ? cell.blockId : BlockId.Air,
    })),
    EVENT_TRANSIENT_BATCH,
  );
  for (const cell of snapshot) {
    const key = blockKey(cell.x, cell.y, cell.z);
    world.replaceBlockState(cell.x, cell.y, cell.z, cell.state);
    if (cell.chest) {
      const chest = world.getChest(cell.x, cell.y, cell.z);
      chest.slots = cell.chest.map(serializeStack);
    } else {
      world.chests.delete(key);
    }
    if (cell.furnace) {
      world.furnaces.set(key, {
        slots: [
          serializeStack(cell.furnace.slots[0]),
          serializeStack(cell.furnace.slots[1]),
          serializeStack(cell.furnace.slots[2]),
        ],
        burnTime: cell.furnace.burnTime,
        burnTotal: cell.furnace.burnTotal,
        cookTime: cell.furnace.cookTime,
      });
    } else {
      world.furnaces.delete(key);
    }
    if (cell.sign) {
      world.signs.set(key, cell.sign);
      world.signVersion += 1;
    } else if (world.signs.delete(key)) {
      world.signVersion += 1;
    }
  }
}

export class WorldEventsManager {
  enabled = false;
  config: WorldEventsConfig = { ...DEFAULT_WORLD_EVENTS_CONFIG };
  lastSearchError?: string;
  lastValidationStoreReads = 0;
  lastSearchChunkCommits = 0;
  lastSearchGenerationMs = 0;
  searchGenerationBudgetMs = EVENT_SEARCH_GENERATION_BUDGET_MS;
  searchMaxChunkCommitsPerTick = EVENT_SEARCH_MAX_CHUNK_COMMITS_PER_TICK;
  searchClock?: () => number;
  private store: WorldEventsStore = { templates: [] };
  private search: SearchJob | undefined;
  private searchRetryAt = 0;
  private generatorMigrationHandled = false;

  constructor(private readonly host: WorldEventsHost) {}

  load(): void {
    try {
      this.store = this.parseStore(this.host.loadStore());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.log(`failed to load world-events store: ${message}`);
      this.store = { templates: [createDefaultChestShrineTemplate()] };
    }
    if (!this.store.templates.some((template) => template.name === DEFAULT_EVENT_TEMPLATE_NAME)) {
      this.store.templates.unshift(createDefaultChestShrineTemplate());
    }
    this.persist();
    this.rebaseTransientEventIfGeneratorMigrated();
    this.recover(this.host.now());
  }

  persist(): void {
    this.host.saveStore(this.store);
  }

  /**
   * V2→V3 migration A: never restore a V2 event snapshot onto V3 terrain.
   * Recapture the current generated+persistent volume before overlay re-apply.
   * One-shot per manager instance so plugin disable→load→enable cannot rebase twice.
   *
   * When a placing journal exists, that event is the recovery authority.
   */
  private rebaseTransientEventIfGeneratorMigrated(): void {
    // Hosts that do not track save worldgen (unit tests) must not rebase every load.
    // A missing numeric version on a real save (V1) still migrates.
    if (!this.host.loadedWorldgenVersion) return;
    const loaded = this.host.loadedWorldgenVersion();
    if (loaded !== undefined && loaded >= WORLDGEN_VERSION) return;
    if (this.generatorMigrationHandled) return;
    this.generatorMigrationHandled = true;
    const journal = this.store.journal;
    if (journal?.phase === 'cleaning') {
      this.store.journal = undefined;
      this.store.active = undefined;
      this.persist();
      this.host.log('world-events: skipped V2 snapshot restore during V3 terrain migration');
      this.finishGeneratorMigration();
      return;
    }
    const placing = journal?.phase === 'placing' ? journal.event : undefined;
    const source = placing ?? this.store.active;
    if (!source?.volume) {
      this.finishGeneratorMigration();
      return;
    }
    if (source.phase !== 'spawned_locked' && source.phase !== 'active_unlocked' && !placing) {
      this.finishGeneratorMigration();
      return;
    }
    source.snapshot = snapshotVolumeDetailed(this.host.world, source.volume);
    if (placing) this.store.active = placing;
    this.persist();
    this.host.log('world-events: rebased event snapshot onto Worldgen V3 terrain');
    this.finishGeneratorMigration();
  }

  private finishGeneratorMigration(): void {
    this.host.acknowledgeWorldgenMigration?.();
    this.host.persistWorld?.();
  }

  setConfig(config: WorldEventsConfig): void {
    this.config = { ...config, timeZone: normalizeTimeZone(config.timeZone) };
    this.rescheduleFuture(this.host.now());
  }

  get active(): ActiveWorldEvent | undefined {
    return this.store.active;
  }

  /**
   * Live overlay cells for network bootstrap. Empty unless the shrine is
   * actually in the authoritative world (`spawned_locked` / `active_unlocked`).
   */
  networkPlacement(): readonly EventPlacementCell[] | undefined {
    const active = this.store.active;
    if (!active?.placement) return undefined;
    if (active.phase !== 'spawned_locked' && active.phase !== 'active_unlocked') return undefined;
    return active.placement;
  }

  listTemplates(): readonly EventTemplate[] {
    return this.store.templates;
  }

  getTemplate(name: string): EventTemplate | undefined {
    const key = parseEventTemplateName(name);
    if (!key) return undefined;
    return this.store.templates.find((template) => template.name === key);
  }

  saveTemplate(name: string, volume: SelectionVolume): { ok: true; template: EventTemplate } | { ok: false; error: string } {
    const captured = captureTemplateFromWorld(this.host.world, volume, name);
    if (!captured.ok) return captured;
    const existing = this.store.templates.findIndex((template) => template.name === captured.template.name);
    if (existing >= 0) this.store.templates[existing] = captured.template;
    else this.store.templates.push(captured.template);
    this.persist();
    return captured;
  }

  deleteTemplate(name: string): { ok: true } | { ok: false; error: string } {
    const key = parseEventTemplateName(name);
    if (!key) return { ok: false, error: 'Некорректное имя шаблона.' };
    if (key === DEFAULT_EVENT_TEMPLATE_NAME) return { ok: false, error: 'Встроенный шаблон нельзя удалить.' };
    const next = this.store.templates.filter((template) => template.name !== key);
    if (next.length === this.store.templates.length) return { ok: false, error: `Шаблон '${key}' не найден.` };
    this.store.templates = next;
    this.persist();
    return { ok: true };
  }

  structureVolume(): SelectionVolume | undefined {
    return this.protectedEvent()?.volume;
  }

  protectionVolume(): SelectionVolume | undefined {
    const event = this.protectedEvent();
    if (!event) return undefined;
    return event.protectionVolume ?? (event.volume ? eventProtectionVolume(event.volume) : undefined);
  }

  systemClaim(): Claim | undefined {
    const event = this.protectedEvent();
    const protection = this.protectionVolume();
    if (!event || !protection) return undefined;
    return buildEventSystemClaim({
      eventId: event.id,
      worldId: event.worldId || this.host.worldId(),
      protection,
    });
  }

  overlapsProtection(volume: SelectionVolume): boolean {
    return volumeOverlapsEventProtection(volume, this.protectionVolume());
  }

  isProtected(x: number, y: number, z: number): boolean {
    return pointInEventProtection(this.protectionVolume(), x, y, z);
  }

  isLockedChest(x: number, y: number, z: number): boolean {
    const active = this.store.active;
    if (!active?.chest || !active.chestLocked) return false;
    if (active.phase !== 'spawned_locked') return false;
    return active.chest.x === x && active.chest.y === y && active.chest.z === z;
  }

  unlockRemainingMs(now = this.host.now()): number {
    const active = this.store.active;
    if (!active || active.phase !== 'spawned_locked') return 0;
    return Math.max(0, active.unlockAt - now);
  }

  tick(now = this.host.now()): void {
    if (!this.enabled || !this.config.enabled) return;
    if (this.search) {
      this.stepSearch(now);
      return;
    }
    const active = this.store.active;
    if (active && (active.phase === 'spawned_locked' || active.phase === 'active_unlocked')) {
      if (now >= active.cleanupAt) {
        this.cleanup('expired');
        return;
      }
      if (active.phase === 'spawned_locked' && now >= active.unlockAt) this.unlock();
      return;
    }
    if (this.store.journal?.phase === 'cleaning') return;
    this.ensureSchedule(now);
    const scheduled = this.store.active;
    if (!scheduled || (scheduled.phase !== 'scheduled' && scheduled.phase !== 'warning_sent')) return;
    if (scheduled.phase === 'scheduled' && now >= scheduled.warningAt && now < scheduled.spawnAt) {
      this.sendWarning(scheduled);
    }
    if (now >= scheduled.spawnAt) {
      if (now >= scheduled.cleanupAt) {
        this.discardUnplacedOccurrence(
          true,
          'Окно ежедневного ивента истекло, сундук не появился.',
        );
        this.ensureSchedule(now);
        return;
      }
      if (now < this.searchRetryAt) return;
      this.beginSpawn(now);
    }
  }

  forceSpawn(options: { at?: BlockPos; yaw?: TemplateYaw } = {}, now = this.host.now()): ForceSpawnResult {
    if (this.store.journal?.phase === 'cleaning') {
      return { ok: false, error: 'Ивент ещё сохраняется. Подождите.' };
    }
    if (this.hasPlacedEvent()) return { ok: false, error: 'Уже есть активный ивент. Сначала выполните cleanup.' };
    const template = this.getTemplate(this.config.templateName) ?? this.getTemplate(DEFAULT_EVENT_TEMPLATE_NAME);
    if (!template) return { ok: false, error: 'Шаблон ивента не найден.' };
    const yaw = options.yaw ?? randomYaw(this.host.random);
    const timeline = eventTimeline(now, this.config);
    if (options.at) {
      const placed = this.placeAt(template, options.at, yaw, timeline, dayKey(now, this.timeZone()), false);
      return placed.ok ? { ok: true, event: placed.event } : placed;
    }
    this.search = {
      attempts: 0,
      yaw,
      template,
      timeline,
      day: dayKey(now, this.timeZone()),
      countsAsDaily: false,
      context: this.freshValidationContext(),
    };
    this.lastSearchError = undefined;
    return { ok: true, searching: true };
  }

  forceCleanup(): { ok: true } | { ok: false; error: string } {
    if (this.search && !this.hasPlacedEvent() && !this.store.journal && !this.store.active) {
      this.search = undefined;
      return { ok: true };
    }
    if (!this.hasPlacedEvent() && !this.store.active && !this.store.journal) {
      return { ok: false, error: 'Активного ивента нет.' };
    }
    this.cleanup('manual');
    return { ok: true };
  }

  acknowledgeWorldSaved(): void {
    const journal = this.store.journal;
    if (!journal) return;
    if (journal.phase === 'placing' && this.hasPlacedEvent()) {
      this.store.journal = undefined;
      this.persist();
      return;
    }
    if (journal.phase === 'cleaning' && !this.store.active) {
      this.store.journal = undefined;
      this.persist();
    }
  }

  statusLines(now = this.host.now()): string[] {
    const time = parseDailyTime(this.config.dailyTime);
    const lines = [
      `World events: ${this.config.enabled && this.enabled ? 'включены' : 'выключены'}`,
      `Ежедневное время: ${time ? formatDailyTime(time) : this.config.dailyTime} (${this.timeZone()})`,
      `Шаблон: ${this.config.templateName}`,
    ];
    const active = this.store.active;
    if (!active) {
      if (time) {
        const next = nextDailyOccurrence(now, time, this.timeZone());
        lines.push(`Следующий ивент: ${new Date(next).toISOString()} (через ${minutesRemaining(next, now)} мин)`);
      }
      return lines;
    }
    lines.push(`Фаза: ${active.phase}`);
    if (active.chest) {
      lines.push(`Сундук: ${active.chest.x} ${active.chest.y} ${active.chest.z}`);
      lines.push(`Поворот: ${active.rotation}°`);
      lines.push(`Сундук: ${active.chestLocked ? 'закрыт' : 'открыт'}`);
    }
    if (active.phase === 'scheduled' || active.phase === 'warning_sent') {
      lines.push(`Спавн через: ${minutesRemaining(active.spawnAt, now)} мин`);
    } else if (active.phase === 'spawned_locked') {
      lines.push(`Открытие через: ${minutesRemaining(active.unlockAt, now)} мин`);
      lines.push(`Очистка через: ${minutesRemaining(active.cleanupAt, now)} мин`);
    } else if (active.phase === 'active_unlocked') {
      lines.push(`Очистка через: ${minutesRemaining(active.cleanupAt, now)} мин`);
    }
    if (this.lastSearchError) lines.push(`Поиск: ${this.lastSearchError}`);
    return lines;
  }

  private timeZone(): string {
    return normalizeTimeZone(this.config.timeZone);
  }

  private hasPlacedEvent(): boolean {
    const phase = this.store.active?.phase;
    return phase === 'spawned_locked' || phase === 'active_unlocked';
  }

  private protectedEvent(): ActiveWorldEvent | undefined {
    if (this.store.journal?.phase === 'cleaning') return this.store.journal.event;
    if (this.store.journal?.phase === 'placing') return this.store.journal.event;
    const active = this.store.active;
    if (!active) return undefined;
    if (active.phase !== 'spawned_locked' && active.phase !== 'active_unlocked') return undefined;
    return active;
  }

  private freshValidationContext(): SpawnValidationContext {
    const context = this.host.createValidationContext?.() ?? emptyValidationContext();
    this.lastValidationStoreReads = context.storeReads;
    return context;
  }

  private rescheduleFuture(now: number): void {
    const active = this.store.active;
    if (!active) return;
    if (active.phase !== 'scheduled' && active.phase !== 'warning_sent') return;
    const time = parseDailyTime(this.config.dailyTime);
    if (!time) return;
    const decided = decideDailySpawn(now, time, this.timeZone(), this.config.durationMinutes, this.store.lastSpawnDayKey);
    const timeline = eventTimeline(decided.spawnAt, this.config);
    active.spawnAt = timeline.spawnAt;
    active.warningAt = timeline.warningAt;
    active.unlockAt = timeline.unlockAt;
    active.cleanupAt = timeline.cleanupAt;
    if (now < timeline.warningAt) active.phase = 'scheduled';
    this.persist();
  }

  private ensureSchedule(now: number): void {
    const time = parseDailyTime(this.config.dailyTime);
    if (!time) {
      this.host.log(`invalid dailyTime '${this.config.dailyTime}'`);
      return;
    }
    const today = dayKey(now, this.timeZone());
    if (this.store.lastSpawnDayKey === today && !this.store.active) return;
    if (this.store.active) return;
    const decided = decideDailySpawn(
      now,
      time,
      this.timeZone(),
      this.config.durationMinutes,
      this.store.lastSpawnDayKey,
    );
    const spawnDay = dayKey(decided.spawnAt, this.timeZone());
    if (this.store.lastSpawnDayKey === spawnDay) return;
    const timeline = eventTimeline(decided.spawnAt, this.config);
    const template = this.getTemplate(this.config.templateName) ?? this.getTemplate(DEFAULT_EVENT_TEMPLATE_NAME);
    this.store.active = {
      type: 'resource_chest',
      id: `chest-${decided.spawnAt}`,
      phase: 'scheduled',
      worldId: this.host.worldId(),
      templateName: template?.name ?? DEFAULT_EVENT_TEMPLATE_NAME,
      rotation: 0,
      spawnAt: timeline.spawnAt,
      warningAt: timeline.warningAt,
      unlockAt: timeline.unlockAt,
      cleanupAt: timeline.cleanupAt,
      chestLocked: true,
    };
    this.persist();
  }

  private sendWarning(event: ActiveWorldEvent): void {
    event.phase = 'warning_sent';
    this.persist();
    const remain = Math.max(1, minutesRemaining(event.spawnAt, this.host.now()));
    this.host.broadcast(`Через ${remain} мин появится ивентовый сундук с редким лутом!`);
  }

  private beginSpawn(now: number): void {
    const today = dayKey(now, this.timeZone());
    if (this.store.lastSpawnDayKey === today) {
      this.store.active = undefined;
      this.persist();
      return;
    }
    const template = this.getTemplate(this.store.active?.templateName ?? this.config.templateName)
      ?? this.getTemplate(DEFAULT_EVENT_TEMPLATE_NAME);
    if (!template) {
      this.lastSearchError = 'Шаблон ивента не найден.';
      this.host.log(this.lastSearchError);
      this.searchRetryAt = now + SEARCH_RETRY_MS;
      return;
    }
    const timeline = this.store.active
      ? {
          spawnAt: this.store.active.spawnAt,
          warningAt: this.store.active.warningAt,
          unlockAt: this.store.active.unlockAt,
          cleanupAt: this.store.active.cleanupAt,
        }
      : eventTimeline(now, this.config);
    if (now >= timeline.cleanupAt) {
      this.discardUnplacedOccurrence(true, 'Окно ежедневного ивента истекло, сундук не появился.');
      this.ensureSchedule(now);
      return;
    }
    this.search = {
      attempts: 0,
      yaw: randomYaw(this.host.random),
      template,
      timeline,
      day: today,
      countsAsDaily: true,
      context: this.freshValidationContext(),
    };
    this.stepSearch(now);
  }

  private stepSearch(now: number): void {
    const job = this.search;
    if (!job) return;
    if (now >= job.timeline.cleanupAt) {
      this.discardUnplacedOccurrence(
        job.countsAsDaily,
        'Окно ивента истекло до появления сундука.',
      );
      if (job.countsAsDaily) this.ensureSchedule(now);
      return;
    }
    if (!job.context) job.context = this.freshValidationContext();
    else {
      job.context.homes = this.host.homes();
      job.context.players = this.host.players();
    }
    this.lastSearchChunkCommits = 0;
    this.lastSearchGenerationMs = 0;
    let validated = 0;
    if (job.pending) {
      if (!this.advancePendingGeneration(job)) return;
      const candidate = this.candidateFromPending(job);
      job.pending = undefined;
      job.attempts += 1;
      validated += 1;
      if (candidate && this.tryPlaceCandidate(job, candidate)) return;
      if (this.failSearchIfExhausted(job, now)) return;
    }
    const budget = Math.max(1, this.config.attemptsPerTick);
    while (validated < budget) {
      const xz = this.randomCandidateXz();
      if (!xz) {
        job.attempts += 1;
        validated += 1;
        if (this.failSearchIfExhausted(job, now)) return;
        continue;
      }
      const chunks = footprintChunkCoords(job.template, xz.x, xz.z, job.yaw);
      if (!this.chunksReady(chunks)) {
        job.pending = { x: xz.x, z: xz.z, chunks };
        this.advancePendingGeneration(job);
        return;
      }
      job.attempts += 1;
      validated += 1;
      const candidate = { x: xz.x, y: this.host.world.surfaceY(xz.x, xz.z) + 1, z: xz.z };
      if (this.tryPlaceCandidate(job, candidate)) return;
      if (this.failSearchIfExhausted(job, now)) return;
    }
  }

  private searchNow(): number {
    return this.searchClock?.() ?? performance.now();
  }

  private chunksReady(chunks: readonly { cx: number; cz: number }[]): boolean {
    return chunks.every(({ cx, cz }) => this.host.world.getChunk(cx, cz, false)?.generated === true);
  }

  private advancePendingGeneration(job: SearchJob): boolean {
    if (!job.pending) return true;
    if (this.chunksReady(job.pending.chunks)) return true;
    const budgetMs = Math.max(0.5, this.searchGenerationBudgetMs);
    const maxCommits = Math.max(1, this.searchMaxChunkCommitsPerTick);
    const start = this.searchNow();
    let commits = 0;
    for (const { cx, cz } of job.pending.chunks) {
      if (this.host.world.getChunk(cx, cz, false)?.generated) continue;
      const before = this.host.world.generationCommitCount;
      this.host.world.continueGeneration(cx, cz, budgetMs, {
        maxColumns: 16,
        now: this.searchClock,
      });
      const added = this.host.world.generationCommitCount - before;
      if (added > 0) {
        commits += added;
        this.lastSearchChunkCommits += added;
      }
      this.lastSearchGenerationMs = this.searchNow() - start;
      if (commits >= maxCommits) break;
      if (this.searchNow() - start >= budgetMs) break;
    }
    return this.chunksReady(job.pending.chunks);
  }

  private candidateFromPending(job: SearchJob): BlockPos | undefined {
    const pending = job.pending;
    if (!pending) return undefined;
    const surface = this.host.world.surfaceY(pending.x, pending.z);
    return { x: pending.x, y: surface + 1, z: pending.z };
  }

  private tryPlaceCandidate(job: SearchJob, candidate: BlockPos): boolean {
    const cached = job.context ?? emptyValidationContext();
    if (!this.validateCandidate(job.template, candidate, job.yaw, cached)) return false;
    const fresh = this.freshValidationContext();
    job.context = fresh;
    if (!this.validateCandidate(job.template, candidate, job.yaw, fresh)) return false;
    const placed = this.placeAt(job.template, candidate, job.yaw, job.timeline, job.day, job.countsAsDaily);
    this.search = undefined;
    if (!placed.ok) {
      this.lastSearchError = placed.error;
      this.host.log(placed.error);
    }
    return true;
  }

  private failSearchIfExhausted(job: SearchJob, now: number): boolean {
    if (job.attempts < this.config.maxSearchAttempts) return false;
    if (now >= job.timeline.cleanupAt) {
      this.discardUnplacedOccurrence(job.countsAsDaily, 'Окно ивента истекло до появления сундука.');
      if (job.countsAsDaily) this.ensureSchedule(now);
      return true;
    }
    this.lastSearchError = `Не найдено место для ивента после ${job.attempts} попыток (кольцо ${this.config.spawnMinDistance}–${this.config.spawnMaxDistance}).`;
    this.host.log(this.lastSearchError);
    this.searchRetryAt = now + SEARCH_RETRY_MS;
    this.search = undefined;
    return true;
  }

  private discardUnplacedOccurrence(countsAsDaily: boolean, message: string): void {
    this.search = undefined;
    this.searchRetryAt = 0;
    this.lastSearchError = message;
    this.host.log(message);
    if (!countsAsDaily) return;
    const active = this.store.active;
    if (!active) return;
    if (active.phase !== 'scheduled' && active.phase !== 'warning_sent') return;
    this.store.active = undefined;
    this.persist();
  }

  private randomCandidateXz(): { x: number; z: number } | undefined {
    const spawn = this.host.spawn();
    const minR = this.config.spawnMinDistance;
    const maxR = this.config.spawnMaxDistance;
    const border = this.config.worldBorder;
    for (let i = 0; i < 8; i += 1) {
      const angle = this.host.random() * Math.PI * 2;
      const radius = minR + this.host.random() * (maxR - minR);
      const x = Math.round(spawn[0] + Math.cos(angle) * radius);
      const z = Math.round(spawn[2] + Math.sin(angle) * radius);
      if (!isInsidePlayableBlock(x, z) || Math.abs(x) >= border || Math.abs(z) >= border) continue;
      const dist = Math.hypot(x - spawn[0], z - spawn[2]);
      if (dist < minR || dist > maxR) continue;
      return { x, z };
    }
    return undefined;
  }

  validateCandidate(
    template: EventTemplate,
    chest: BlockPos,
    yaw: TemplateYaw,
    context: SpawnValidationContext = emptyValidationContext(),
  ): boolean {
    const volume = placedVolume(template, chest, yaw);
    if (!isValidWorldY(volume.minY) || !isValidWorldY(volume.maxY)) return false;
    if (volume.maxY > MAX_WORLD_Y || volume.minY < MIN_WORLD_Y) return false;
    if (!isVolumeInsidePlayableWorld(volume) || !isInsidePlayableBlock(chest.x, chest.z)) return false;
    const originSurface = this.host.world.surfaceY(chest.x, chest.z);
    if (chest.y !== originSurface + 1) return false;
    const ground = this.host.world.getBlock(chest.x, originSurface, chest.z);
    const groundDef = getBlockDefinition(ground);
    if (!groundDef.solid || groundDef.liquid || isDangerousBlock(ground) || ground === BlockId.OakLeaves) return false;
    if (this.host.world.isLiquid(chest.x, originSurface, chest.z) || this.host.world.isLiquid(chest.x, chest.y, chest.z)) {
      return false;
    }
    if (volumeHasModifications(this.host.world, volume)) return false;
    if (volumeHasPersistentRecords(this.host.world, volume)) return false;
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        if (!isInsidePlayableBlock(x, z)) return false;
        const surface = this.host.world.surfaceY(x, z);
        if (Math.abs(surface - originSurface) > 2) return false;
        const top = this.host.world.getBlock(x, surface, z);
        if (this.host.world.isLiquid(x, surface, z) || this.host.world.isLiquid(x, surface + 1, z)) return false;
        if (isDangerousBlock(top) || isDangerousBlock(this.host.world.getBlock(x, surface + 1, z))) return false;
        for (let y = volume.minY; y <= volume.maxY; y += 1) {
          if (reservedAt(context, x, y, z)) return false;
        }
      }
    }
    for (const home of context.homes) {
      if (Math.hypot(home.x - chest.x, home.z - chest.z) < this.config.homeAvoidRadius) return false;
    }
    for (const player of context.players) {
      if (Math.hypot(player.x - chest.x, player.z - chest.z) < this.config.playerAvoidRadius) return false;
    }
    return true;
  }

  private placeAt(
    template: EventTemplate,
    chest: BlockPos,
    yaw: TemplateYaw,
    timeline: EventTimeline,
    day: string,
    countsAsDaily: boolean,
  ): { ok: true; event: ActiveWorldEvent } | { ok: false; error: string } {
    const now = this.host.now();
    if (now >= timeline.cleanupAt) {
      return { ok: false, error: 'Окно ивента уже истекло.' };
    }
    const volume = placedVolume(template, chest, yaw);
    const snapshot = snapshotVolumeDetailed(this.host.world, volume);
    const loot = generateEventChestLoot(this.host.random);
    const chestSlots = fillChestSlots(loot, this.host.random);
    const placement: EventPlacementCell[] = template.blocks.map((cell) => {
      const offset = rotateOffset(cell.dx, cell.dy, cell.dz, yaw);
      const isAnchor = cell.dx === 0 && cell.dy === 0 && cell.dz === 0;
      const blockId = isAnchor || isSharedWorldChestBlock(cell.blockId as BlockId)
        ? BlockId.EventChest
        : isKnownBlockId(cell.blockId) ? cell.blockId : BlockId.Air;
      const state = rotateBlockState(cell.state, yaw);
      return {
        x: chest.x + offset.x,
        y: chest.y + offset.y,
        z: chest.z + offset.z,
        blockId,
        ...(state ? { state } : {}),
      };
    });
    const locked = now < timeline.unlockAt;
    const event: ActiveWorldEvent = {
      type: 'resource_chest',
      id: `chest-${timeline.spawnAt}`,
      phase: locked ? 'spawned_locked' : 'active_unlocked',
      worldId: this.host.worldId(),
      templateName: template.name,
      rotation: yaw,
      chest,
      volume,
      protectionVolume: eventProtectionVolume(volume),
      placement,
      spawnAt: timeline.spawnAt,
      warningAt: timeline.warningAt,
      unlockAt: timeline.unlockAt,
      cleanupAt: timeline.cleanupAt,
      loot,
      chestSlots,
      snapshot,
      chestLocked: locked,
    };
    this.store.journal = { phase: 'placing', event: cloneEvent(event) };
    this.persist();
    this.applyPlacement(event);
    this.store.active = event;
    if (countsAsDaily) this.store.lastSpawnDayKey = day;
    this.persist();
    this.host.markDirty();
    this.host.flush();
    this.host.persistWorld?.();
    const coords = this.config.announceCoordinates ? ` Координаты: ${chest.x} ${chest.y} ${chest.z}.` : '';
    if (locked) {
      const remain = Math.max(1, minutesRemaining(timeline.unlockAt, now));
      this.host.broadcast(`Ивентовый сундук появился.${coords} Сундук откроется через ${remain} мин.`);
    } else {
      this.host.broadcast(`Ивентовый сундук появился.${coords} Сундук открыт!`);
    }
    return { ok: true, event };
  }

  private applyPlacement(event: ActiveWorldEvent): void {
    if (!event.placement || !event.chest) return;
    this.host.world.applyBlockBatch(
      event.placement.map((cell) => ({
        x: cell.x,
        y: cell.y,
        z: cell.z,
        block: isKnownBlockId(cell.blockId) ? cell.blockId : BlockId.Air,
      })),
      EVENT_TRANSIENT_BATCH,
    );
    for (const cell of event.placement) {
      this.host.world.replaceBlockState(cell.x, cell.y, cell.z, cell.state);
    }
    const loot = event.loot ?? [];
    const slots = event.chestSlots?.map(serializeStack) ?? fillChestSlots(loot, () => 0);
    const chestState = this.host.world.getChest(event.chest.x, event.chest.y, event.chest.z);
    chestState.slots = slots;
  }

  private unlock(): void {
    const active = this.store.active;
    if (!active?.chest) return;
    active.phase = 'active_unlocked';
    active.chestLocked = false;
    this.persist();
    this.host.broadcast('Ивентовый сундук открыт!');
  }

  private cleanup(reason: 'expired' | 'manual'): void {
    this.search = undefined;
    const active = this.store.active ?? this.store.journal?.event;
    if (active) {
      this.store.journal = { phase: 'cleaning', event: cloneEvent(active) };
      this.persist();
    }
    if (active?.chest) this.host.closeChestWindow(active.chest.x, active.chest.y, active.chest.z);
    if (active?.snapshot) restoreSnapshot(this.host.world, active.snapshot);
    else if (active?.chest) {
      this.host.world.chests.delete(blockKey(active.chest.x, active.chest.y, active.chest.z));
      this.host.world.applyBlockBatch(
        [{ x: active.chest.x, y: active.chest.y, z: active.chest.z, block: BlockId.Air }],
        EVENT_TRANSIENT_BATCH,
      );
    }
    this.store.active = undefined;
    this.persist();
    this.host.markDirty();
    this.host.flush();
    this.host.persistWorld?.();
    this.host.broadcast(reason === 'manual' ? 'Ивентовый сундук убран администратором.' : 'Ивентовый сундук исчез, место восстановлено.');
  }

  private recover(now: number): void {
    const journal = this.store.journal;
    if (journal?.phase === 'cleaning') {
      this.finishJournalCleanup(journal.event);
      return;
    }
    if (journal?.phase === 'placing') {
      this.reapplyStored(journal.event);
      this.store.active = journal.event;
      if (now >= journal.event.cleanupAt) {
        this.cleanup('expired');
        return;
      }
      if (journal.event.phase === 'spawned_locked' && now >= journal.event.unlockAt) this.unlock();
      return;
    }
    const active = this.store.active;
    if (!active) return;
    if (active.phase === 'completed') {
      this.store.active = undefined;
      this.persist();
      return;
    }
    if (active.phase === 'spawned_locked' || active.phase === 'active_unlocked') {
      this.ensureWorldMatches(active);
      if (now >= active.cleanupAt) {
        this.cleanup('expired');
        return;
      }
      if (active.phase === 'spawned_locked' && now >= active.unlockAt) this.unlock();
      return;
    }
    if (now >= active.cleanupAt || now >= active.spawnAt + this.config.durationMinutes * 60_000) {
      this.store.active = undefined;
      this.persist();
    }
  }

  private finishJournalCleanup(event: ActiveWorldEvent): void {
    if (event.chest) this.host.closeChestWindow(event.chest.x, event.chest.y, event.chest.z);
    if (event.snapshot) restoreSnapshot(this.host.world, event.snapshot);
    this.store.active = undefined;
    this.persist();
    this.host.markDirty();
    this.host.flush();
    this.host.persistWorld?.();
  }

  private reapplyStored(event: ActiveWorldEvent): void {
    if (!event.placement || !event.chest) return;
    this.applyPlacement(event);
    this.host.markDirty();
    this.host.flush();
    this.host.persistWorld?.();
  }

  private ensureWorldMatches(event: ActiveWorldEvent): void {
    if (!event.chest) return;
    if (this.host.world.getBlock(event.chest.x, event.chest.y, event.chest.z) === BlockId.EventChest) return;
    this.reapplyStored(event);
  }

  private parseEvent(raw: Record<string, unknown>): ActiveWorldEvent | undefined {
    const phase = parsePhase(raw.phase);
    const spawnAt = typeof raw.spawnAt === 'number' ? raw.spawnAt : undefined;
    if (!phase || spawnAt === undefined || typeof raw.unlockAt !== 'number' || typeof raw.cleanupAt !== 'number') {
      return undefined;
    }
    const volume = parseVolume(raw.volume);
    const protection = parseVolume(raw.protectionVolume) ?? (volume ? eventProtectionVolume(volume) : undefined);
    const placement = Array.isArray(raw.placement)
      ? raw.placement.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const cell = entry as Record<string, unknown>;
        if (![cell.x, cell.y, cell.z, cell.blockId].every((value) => Number.isInteger(value))) return [];
        return [{
          x: cell.x as number,
          y: cell.y as number,
          z: cell.z as number,
          blockId: cell.blockId as number,
          ...(cell.state && typeof cell.state === 'object' ? { state: cell.state as BlockRenderState } : {}),
        }];
      })
      : undefined;
    const snapshot = Array.isArray(raw.snapshot)
      ? raw.snapshot.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const cell = entry as Record<string, unknown>;
        if (![cell.x, cell.y, cell.z, cell.blockId].every((value) => Number.isInteger(value))) return [];
        const furnace = parseFurnace(cell.furnace);
        const sign = sanitizeSignLines(cell.sign);
        return [{
          x: cell.x as number,
          y: cell.y as number,
          z: cell.z as number,
          blockId: cell.blockId as number,
          ...(cell.state && typeof cell.state === 'object' ? { state: cell.state as BlockRenderState } : {}),
          ...(Array.isArray(cell.chest) ? { chest: cell.chest.map(parseStack) } : {}),
          ...(furnace ? { furnace } : {}),
          ...(sign ? { sign } : {}),
        }];
      })
      : undefined;
    return {
      type: 'resource_chest',
      id: typeof raw.id === 'string' ? raw.id : `chest-${spawnAt}`,
      phase,
      worldId: typeof raw.worldId === 'string' ? raw.worldId : this.host.worldId(),
      templateName: typeof raw.templateName === 'string' ? raw.templateName : DEFAULT_EVENT_TEMPLATE_NAME,
      rotation: parseYaw(raw.rotation),
      chest: parsePos(raw.chest),
      volume,
      protectionVolume: protection,
      placement,
      spawnAt,
      warningAt: typeof raw.warningAt === 'number' ? raw.warningAt : spawnAt,
      unlockAt: raw.unlockAt,
      cleanupAt: raw.cleanupAt,
      loot: Array.isArray(raw.loot) ? raw.loot.map(parseStack).filter((stack): stack is ItemStack => Boolean(stack)) : undefined,
      chestSlots: Array.isArray(raw.chestSlots) ? raw.chestSlots.map(parseStack) : undefined,
      snapshot,
      chestLocked: raw.chestLocked !== false && phase === 'spawned_locked',
    };
  }

  private parseStore(raw: unknown): WorldEventsStore {
    const fallback: WorldEventsStore = { templates: [createDefaultChestShrineTemplate()] };
    if (!raw || typeof raw !== 'object') return fallback;
    const value = raw as Record<string, unknown>;
    const templates: EventTemplate[] = [];
    if (Array.isArray(value.templates)) {
      for (const entry of value.templates) {
        const parsed = parseStoredTemplate(entry);
        if (parsed) templates.push(parsed);
      }
    }
    if (templates.length === 0) templates.push(createDefaultChestShrineTemplate());
    const store: WorldEventsStore = {
      templates,
      ...(typeof value.lastSpawnDayKey === 'string' ? { lastSpawnDayKey: value.lastSpawnDayKey } : {}),
    };
    if (value.active && typeof value.active === 'object') {
      const parsed = this.parseEvent(value.active as Record<string, unknown>);
      if (parsed) store.active = parsed;
    }
    if (value.journal && typeof value.journal === 'object') {
      const journal = value.journal as Record<string, unknown>;
      const phase = journal.phase === 'placing' || journal.phase === 'cleaning' ? journal.phase : undefined;
      const event = journal.event && typeof journal.event === 'object'
        ? this.parseEvent(journal.event as Record<string, unknown>)
        : undefined;
      if (phase && event) store.journal = { phase, event };
    }
    return store;
  }
}

export { secondsRemaining, timezonePolicy } from './eventScheduler';
