import { BlockId, getBlockDefinition, isKnownBlockId, type BlockRenderState } from '../../src/blocks';
import { isValidWorldY, MAX_WORLD_Y, MIN_WORLD_Y, blockKey } from '../../src/core/constants';
import { cloneStack, createItemStack, isSharedWorldChestBlock, type ItemStack } from '../../src/inventory';
import type { VoxelWorld } from '../../src/world/World';
import { isDangerousBlock } from './rtp';
import { volumeContains, type BlockPos, type SelectionVolume } from './selection';
import {
  dayKey,
  eventTimeline,
  formatDailyTime,
  minutesRemaining,
  nextDailyOccurrence,
  parseDailyTime,
  secondsRemaining,
  timezonePolicy,
  type EventTimeline,
  type TimeZonePolicy,
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
  type EventTemplate,
  type TemplateYaw,
} from './eventTemplates';

export type WorldEventPhase =
  | 'scheduled'
  | 'warning_sent'
  | 'spawned_locked'
  | 'active_unlocked'
  | 'completed';

export interface WorldEventsConfig {
  enabled: boolean;
  dailyTime: string;
  useServerLocalTime: boolean;
  warningMinutes: number;
  unlockDelayMinutes: number;
  durationMinutes: number;
  spawnMinDistance: number;
  spawnMaxDistance: number;
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
  useServerLocalTime: true,
  warningMinutes: 15,
  unlockDelayMinutes: 5,
  durationMinutes: 120,
  spawnMinDistance: 3000,
  spawnMaxDistance: 5000,
  worldBorder: 10_000,
  templateName: DEFAULT_EVENT_TEMPLATE_NAME,
  announceCoordinates: true,
  playerAvoidRadius: 64,
  homeAvoidRadius: 48,
  maxSearchAttempts: 80,
  attemptsPerTick: 4,
};

export interface WorldSnapshotCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: BlockRenderState;
  readonly chest?: Array<ItemStack | null>;
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
  readonly spawnAt: number;
  readonly warningAt: number;
  readonly unlockAt: number;
  readonly cleanupAt: number;
  loot?: ItemStack[];
  snapshot?: WorldSnapshotCell[];
  chestLocked: boolean;
}

interface WorldEventsStore {
  lastSpawnDayKey?: string;
  active?: ActiveWorldEvent;
  templates: EventTemplate[];
}

interface SearchJob {
  attempts: number;
  yaw: TemplateYaw;
  template: EventTemplate;
  timeline: EventTimeline;
  day: string;
}

export interface WorldEventsHost {
  readonly world: VoxelWorld;
  worldId(): string;
  now(): number;
  random(): number;
  spawn(): readonly [number, number, number];
  loadStore(): unknown;
  saveStore(store: unknown): void;
  claimsAt(x: number, y: number, z: number): boolean;
  autoMineAt(x: number, y: number, z: number): boolean;
  specialZoneAt(x: number, y: number, z: number): boolean;
  homes(): readonly { readonly x: number; readonly z: number }[];
  players(): readonly { readonly x: number; readonly y: number; readonly z: number }[];
  flush(): void;
  markDirty(): void;
  closeChestWindow(x: number, y: number, z: number): void;
  broadcast(text: string): void;
  send(playerId: string, text: string): void;
  log(message: string): void;
}

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
]);

function randomYaw(random: () => number): TemplateYaw {
  return ([0, 90, 180, 270] as const)[Math.floor(random() * 4)]!;
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

export function snapshotVolumeDetailed(world: VoxelWorld, volume: SelectionVolume): WorldSnapshotCell[] {
  const cells: WorldSnapshotCell[] = [];
  for (let y = volume.minY; y <= volume.maxY; y += 1) {
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        const blockId = world.getBlock(x, y, z);
        const state = world.getBlockState(x, y, z);
        const stored = world.chests.get(blockKey(x, y, z));
        cells.push({
          x, y, z, blockId,
          ...(state ? { state } : {}),
          ...(stored ? { chest: stored.slots.map(serializeStack) } : {}),
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
    { skipSupport: true, deferLighting: true },
  );
  for (const cell of snapshot) {
    const key = blockKey(cell.x, cell.y, cell.z);
    if (cell.state) world.replaceBlockState(cell.x, cell.y, cell.z, cell.state);
    if (cell.chest) {
      const chest = world.getChest(cell.x, cell.y, cell.z);
      chest.slots = cell.chest.map(serializeStack);
    } else {
      world.chests.delete(key);
    }
  }
}

export class WorldEventsManager {
  enabled = false;
  config: WorldEventsConfig = { ...DEFAULT_WORLD_EVENTS_CONFIG };
  lastSearchError?: string;
  private store: WorldEventsStore = { templates: [] };
  private search: SearchJob | undefined;

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
    this.recover(this.host.now());
  }

  persist(): void {
    this.host.saveStore(this.store);
  }

  setConfig(config: WorldEventsConfig): void {
    this.config = { ...config };
  }

  get active(): ActiveWorldEvent | undefined {
    return this.store.active;
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

  isProtected(x: number, y: number, z: number): boolean {
    const active = this.store.active;
    if (!active?.volume) return false;
    if (active.phase !== 'spawned_locked' && active.phase !== 'active_unlocked') return false;
    return volumeContains(active.volume, x, y, z);
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
    this.ensureSchedule(now);
    const scheduled = this.store.active;
    if (!scheduled || (scheduled.phase !== 'scheduled' && scheduled.phase !== 'warning_sent')) return;
    if (scheduled.phase === 'scheduled' && now >= scheduled.warningAt && now < scheduled.spawnAt) {
      this.sendWarning(scheduled);
    }
    if (now >= scheduled.spawnAt) this.beginSpawn(now);
  }

  forceSpawn(options: { at?: BlockPos; yaw?: TemplateYaw } = {}, now = this.host.now()): { ok: true; event: ActiveWorldEvent } | { ok: false; error: string } {
    if (this.hasPlacedEvent()) return { ok: false, error: 'Уже есть активный ивент. Сначала выполните cleanup.' };
    const template = this.getTemplate(this.config.templateName) ?? this.getTemplate(DEFAULT_EVENT_TEMPLATE_NAME);
    if (!template) return { ok: false, error: 'Шаблон ивента не найден.' };
    const yaw = options.yaw ?? randomYaw(this.host.random);
    const timeline = eventTimeline(now, this.config);
    if (options.at) {
      const placed = this.placeAt(template, options.at, yaw, timeline, dayKey(now, this.policy()));
      return placed.ok ? { ok: true, event: placed.event } : placed;
    }
    this.search = { attempts: 0, yaw, template, timeline, day: dayKey(now, this.policy()) };
    this.store.active = {
      type: 'resource_chest',
      id: `chest-${now}`,
      phase: 'scheduled',
      worldId: this.host.worldId(),
      templateName: template.name,
      rotation: yaw,
      spawnAt: timeline.spawnAt,
      warningAt: timeline.warningAt,
      unlockAt: timeline.unlockAt,
      cleanupAt: timeline.cleanupAt,
      chestLocked: true,
    };
    this.persist();
    this.stepSearch(now, true);
    if (this.hasPlacedEvent() && this.store.active) return { ok: true, event: this.store.active };
    return { ok: false, error: this.lastSearchError ?? 'Не удалось найти место для ивента.' };
  }

  forceCleanup(): { ok: true } | { ok: false; error: string } {
    if (!this.hasPlacedEvent() && !this.store.active) return { ok: false, error: 'Активного ивента нет.' };
    this.cleanup('manual');
    return { ok: true };
  }

  statusLines(now = this.host.now()): string[] {
    const time = parseDailyTime(this.config.dailyTime);
    const lines = [
      `World events: ${this.config.enabled && this.enabled ? 'включены' : 'выключены'}`,
      `Ежедневное время: ${time ? formatDailyTime(time) : this.config.dailyTime} (${this.config.useServerLocalTime ? 'локальное время сервера' : 'UTC'})`,
      `Шаблон: ${this.config.templateName}`,
    ];
    const active = this.store.active;
    if (!active) {
      if (time) {
        const next = nextDailyOccurrence(now, time, this.policy());
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

  private policy(): TimeZonePolicy {
    return timezonePolicy(this.config.useServerLocalTime);
  }

  private hasPlacedEvent(): boolean {
    const phase = this.store.active?.phase;
    return phase === 'spawned_locked' || phase === 'active_unlocked';
  }

  private ensureSchedule(now: number): void {
    const time = parseDailyTime(this.config.dailyTime);
    if (!time) {
      this.host.log(`invalid dailyTime '${this.config.dailyTime}'`);
      return;
    }
    const today = dayKey(now, this.policy());
    if (this.store.lastSpawnDayKey === today && !this.store.active) return;
    if (this.store.active) return;
    const spawnAt = nextDailyOccurrence(now, time, this.policy());
    const spawnDay = dayKey(spawnAt, this.policy());
    if (this.store.lastSpawnDayKey === spawnDay) return;
    const timeline = eventTimeline(spawnAt, this.config);
    const template = this.getTemplate(this.config.templateName) ?? this.getTemplate(DEFAULT_EVENT_TEMPLATE_NAME);
    this.store.active = {
      type: 'resource_chest',
      id: `chest-${spawnAt}`,
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
    const today = dayKey(now, this.policy());
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
      this.store.lastSpawnDayKey = today;
      this.store.active = undefined;
      this.persist();
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
    this.search = {
      attempts: 0,
      yaw: randomYaw(this.host.random),
      template,
      timeline,
      day: today,
    };
    this.stepSearch(now);
  }

  private stepSearch(now: number, drain = false): void {
    const job = this.search;
    if (!job) return;
    const budget = drain ? this.config.maxSearchAttempts : Math.max(1, this.config.attemptsPerTick);
    for (let i = 0; i < budget; i += 1) {
      job.attempts += 1;
      const candidate = this.randomCandidate();
      if (candidate && this.validateCandidate(job.template, candidate, job.yaw)) {
        const placed = this.placeAt(job.template, candidate, job.yaw, job.timeline, job.day);
        this.search = undefined;
        if (!placed.ok) {
          this.lastSearchError = placed.error;
          this.host.log(placed.error);
        }
        return;
      }
      if (job.attempts >= this.config.maxSearchAttempts) {
        this.lastSearchError = `Не найдено место для ивента после ${job.attempts} попыток (кольцо ${this.config.spawnMinDistance}–${this.config.spawnMaxDistance}).`;
        this.host.log(this.lastSearchError);
        this.store.lastSpawnDayKey = job.day;
        this.store.active = undefined;
        this.search = undefined;
        this.persist();
        return;
      }
    }
  }

  private randomCandidate(): BlockPos | undefined {
    const spawn = this.host.spawn();
    const minR = this.config.spawnMinDistance;
    const maxR = this.config.spawnMaxDistance;
    const border = this.config.worldBorder;
    for (let i = 0; i < 8; i += 1) {
      const angle = this.host.random() * Math.PI * 2;
      const radius = minR + this.host.random() * (maxR - minR);
      const x = Math.round(spawn[0] + Math.cos(angle) * radius);
      const z = Math.round(spawn[2] + Math.sin(angle) * radius);
      if (Math.abs(x) > border || Math.abs(z) > border) continue;
      const dist = Math.hypot(x - spawn[0], z - spawn[2]);
      if (dist < minR || dist > maxR) continue;
      const surface = this.host.world.surfaceY(x, z);
      return { x, y: surface + 1, z };
    }
    return undefined;
  }

  validateCandidate(template: EventTemplate, chest: BlockPos, yaw: TemplateYaw): boolean {
    const volume = placedVolume(template, chest, yaw);
    if (!isValidWorldY(volume.minY) || !isValidWorldY(volume.maxY)) return false;
    if (volume.maxY > MAX_WORLD_Y || volume.minY < MIN_WORLD_Y) return false;
    if (Math.abs(chest.x) > this.config.worldBorder || Math.abs(chest.z) > this.config.worldBorder) return false;
    const originSurface = this.host.world.surfaceY(chest.x, chest.z);
    if (chest.y !== originSurface + 1) return false;
    const ground = this.host.world.getBlock(chest.x, originSurface, chest.z);
    const groundDef = getBlockDefinition(ground);
    if (!groundDef.solid || groundDef.liquid || isDangerousBlock(ground) || ground === BlockId.OakLeaves) return false;
    if (this.host.world.isLiquid(chest.x, originSurface, chest.z) || this.host.world.isLiquid(chest.x, chest.y, chest.z)) {
      return false;
    }
    for (let z = volume.minZ; z <= volume.maxZ; z += 1) {
      for (let x = volume.minX; x <= volume.maxX; x += 1) {
        if (Math.abs(x) > this.config.worldBorder || Math.abs(z) > this.config.worldBorder) return false;
        const surface = this.host.world.surfaceY(x, z);
        if (Math.abs(surface - originSurface) > 2) return false;
        const top = this.host.world.getBlock(x, surface, z);
        if (this.host.world.isLiquid(x, surface, z) || this.host.world.isLiquid(x, surface + 1, z)) return false;
        if (isDangerousBlock(top) || isDangerousBlock(this.host.world.getBlock(x, surface + 1, z))) return false;
        if (PLAYERISH.has(top)) return false;
        for (let y = volume.minY; y <= volume.maxY; y += 1) {
          if (this.host.claimsAt(x, y, z) || this.host.autoMineAt(x, y, z) || this.host.specialZoneAt(x, y, z)) {
            return false;
          }
        }
      }
    }
    for (const home of this.host.homes()) {
      if (Math.hypot(home.x - chest.x, home.z - chest.z) < this.config.homeAvoidRadius) return false;
    }
    for (const player of this.host.players()) {
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
  ): { ok: true; event: ActiveWorldEvent } | { ok: false; error: string } {
    const volume = placedVolume(template, chest, yaw);
    const snapshot = snapshotVolumeDetailed(this.host.world, volume);
    const loot = generateEventChestLoot(this.host.random);
    const mutations = template.blocks.map((cell) => {
      const offset = rotateOffset(cell.dx, cell.dy, cell.dz, yaw);
      const isAnchor = cell.dx === 0 && cell.dy === 0 && cell.dz === 0;
      const blockId = isAnchor || isSharedWorldChestBlock(cell.blockId as BlockId)
        ? BlockId.EventChest
        : isKnownBlockId(cell.blockId) ? cell.blockId : BlockId.Air;
      return { x: chest.x + offset.x, y: chest.y + offset.y, z: chest.z + offset.z, block: blockId, state: rotateBlockState(cell.state, yaw) };
    });
    this.host.world.applyBlockBatch(mutations.map(({ x, y, z, block }) => ({ x, y, z, block })), {
      skipSupport: true,
      deferLighting: true,
    });
    for (const mutation of mutations) {
      if (mutation.state) this.host.world.replaceBlockState(mutation.x, mutation.y, mutation.z, mutation.state);
    }
    const slots = fillChestSlots(loot, this.host.random);
    const chestState = this.host.world.getChest(chest.x, chest.y, chest.z);
    chestState.slots = slots;
    const event: ActiveWorldEvent = {
      type: 'resource_chest',
      id: `chest-${timeline.spawnAt}`,
      phase: 'spawned_locked',
      worldId: this.host.worldId(),
      templateName: template.name,
      rotation: yaw,
      chest,
      volume,
      spawnAt: timeline.spawnAt,
      warningAt: timeline.warningAt,
      unlockAt: timeline.unlockAt,
      cleanupAt: timeline.cleanupAt,
      loot,
      snapshot,
      chestLocked: true,
    };
    this.store.active = event;
    this.store.lastSpawnDayKey = day;
    this.persist();
    this.host.markDirty();
    this.host.flush();
    const coords = this.config.announceCoordinates ? ` Координаты: ${chest.x} ${chest.y} ${chest.z}.` : '';
    this.host.broadcast(`Ивентовый сундук появился.${coords} Сундук откроется через ${this.config.unlockDelayMinutes} мин.`);
    return { ok: true, event };
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
    const active = this.store.active;
    if (active?.chest) this.host.closeChestWindow(active.chest.x, active.chest.y, active.chest.z);
    if (active?.snapshot) restoreSnapshot(this.host.world, active.snapshot);
    else if (active?.chest) {
      this.host.world.chests.delete(blockKey(active.chest.x, active.chest.y, active.chest.z));
      this.host.world.setBlock(active.chest.x, active.chest.y, active.chest.z, BlockId.Air);
    }
    this.store.active = undefined;
    this.persist();
    this.host.markDirty();
    this.host.flush();
    this.host.broadcast(reason === 'manual' ? 'Ивентовый сундук убран администратором.' : 'Ивентовый сундук исчез, место восстановлено.');
  }

  private recover(now: number): void {
    const active = this.store.active;
    if (!active) return;
    if (active.phase === 'completed') {
      this.store.active = undefined;
      this.persist();
      return;
    }
    if (active.phase === 'spawned_locked' || active.phase === 'active_unlocked') {
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
      const active = value.active as Record<string, unknown>;
      const phase = parsePhase(active.phase);
      const spawnAt = typeof active.spawnAt === 'number' ? active.spawnAt : undefined;
      if (phase && spawnAt !== undefined && typeof active.unlockAt === 'number' && typeof active.cleanupAt === 'number') {
        store.active = {
          type: 'resource_chest',
          id: typeof active.id === 'string' ? active.id : `chest-${spawnAt}`,
          phase,
          worldId: typeof active.worldId === 'string' ? active.worldId : this.host.worldId(),
          templateName: typeof active.templateName === 'string' ? active.templateName : DEFAULT_EVENT_TEMPLATE_NAME,
          rotation: parseYaw(active.rotation),
          chest: parsePos(active.chest),
          volume: parseVolume(active.volume),
          spawnAt,
          warningAt: typeof active.warningAt === 'number' ? active.warningAt : spawnAt,
          unlockAt: active.unlockAt,
          cleanupAt: active.cleanupAt,
          loot: Array.isArray(active.loot) ? active.loot.map(parseStack).filter((stack): stack is ItemStack => Boolean(stack)) : undefined,
          snapshot: Array.isArray(active.snapshot) ? active.snapshot as WorldSnapshotCell[] : undefined,
          chestLocked: active.chestLocked !== false && phase === 'spawned_locked',
        };
      }
    }
    return store;
  }
}

export { secondsRemaining };
