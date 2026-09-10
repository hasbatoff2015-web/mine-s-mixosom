import { BlockId, getBlockDefinition, isKnownBlockId } from '../../src/blocks';
import { isValidWorldY } from '../../src/core/constants';
import { ItemId } from '../../src/items';
import type { VoxelWorld } from '../../src/world/World';
import { volumeContains, volumeFromCorners, type BlockPos, type SelectionVolume } from './selection';

/** WorldEdit-style wooden axe. Not a new item; clicks are intercepted only for AutoMine admins. */
export const AUTOMINE_WAND_ITEM = ItemId.WoodenAxe;

export const AUTOMINE_MIN_INTERVAL_SECONDS = 5;
export const AUTOMINE_MAX_INTERVAL_SECONDS = 86_400;
export const AUTOMINE_MAX_EDGE = 32;
export const AUTOMINE_MAX_VOLUME = 32 * 32 * 32;
export const AUTOMINE_BLOCKS_PER_TICK = 64;
export const AUTOMINE_NAME_MAX = 24;
export const AUTOMINE_WEIGHT_TOTAL = 10_000;

export type AutoMineStatus = 'READY' | 'RESETTING';

export interface AutoMineBlockWeight {
  readonly blockId: BlockId;
  readonly weight: number;
}

/**
 * Fixed composition. Weights are hundredths of a percent and sum to 10_000 (100%).
 * Lower list entries are rarer; Obsidian matches Coal; Titanium is the rarest.
 */
export const AUTOMINE_COMPOSITION: readonly AutoMineBlockWeight[] = Object.freeze([
  { blockId: BlockId.OakLog, weight: 1800 },
  { blockId: BlockId.BirchLog, weight: 1400 },
  { blockId: BlockId.SpruceLog, weight: 1400 },
  { blockId: BlockId.Stone, weight: 2500 },
  { blockId: BlockId.Gravel, weight: 1000 },
  { blockId: BlockId.CoalOre, weight: 500 },
  { blockId: BlockId.RedstoneOre, weight: 400 },
  { blockId: BlockId.GoldOre, weight: 250 },
  { blockId: BlockId.IronOre, weight: 200 },
  { blockId: BlockId.Obsidian, weight: 500 },
  { blockId: BlockId.DiamondOre, weight: 45 },
  { blockId: BlockId.TitaniumOre, weight: 5 },
]);

const CUMULATIVE: readonly number[] = (() => {
  const out: number[] = [];
  let sum = 0;
  for (const entry of AUTOMINE_COMPOSITION) {
    sum += entry.weight;
    out.push(sum);
  }
  return out;
})();

export const AUTOMINE_ALLOWED_BLOCKS: ReadonlySet<BlockId> = new Set(
  AUTOMINE_COMPOSITION.map((entry) => entry.blockId),
);

export interface AutoMineTeleport {
  readonly worldId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface AutoMineRecord {
  readonly name: string;
  readonly worldId: string;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  intervalSeconds: number | null;
  teleport: AutoMineTeleport | null;
  nextResetAt: number | null;
}

export interface AutoMineStore {
  mines: AutoMineRecord[];
}

export interface AutoMineCuboidSize {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly blocks: number;
}

export interface AutoMineSelection {
  pos1?: BlockPos;
  pos2?: BlockPos;
}

export interface AutoMineJob {
  readonly name: string;
  readonly kind: 'fill' | 'restore';
  readonly volume: SelectionVolume;
  readonly total: number;
  offset: number;
  readonly originals?: readonly number[];
}

export interface AutoMineHost {
  readonly world: VoxelWorld;
  worldId(): string;
  now(): number;
  random(): number;
  loadStore(): AutoMineStore;
  saveStore(store: AutoMineStore): void;
  loadOriginals(name: string): unknown;
  saveOriginals(name: string, blocks: readonly number[]): void;
  players(): readonly AutoMinePlayerRef[];
  teleport(playerId: string, dest: AutoMineTeleport): { ok: boolean; error?: string };
  send(playerId: string, text: string): void;
  notifyAdmins(text: string): void;
  log(message: string): void;
  /** Economy uses this to forget player-placed marks when AutoMine overwrites voxels. */
  onBlocksWritten?(cells: readonly { x: number; y: number; z: number }[]): void;
}

export interface AutoMinePlayerRef {
  readonly id: string;
  position(): { readonly x: number; readonly y: number; readonly z: number };
  snapshot(): { readonly yaw: number; readonly pitch: number };
}

export function automineWeightSum(): number {
  return AUTOMINE_COMPOSITION.reduce((sum, entry) => sum + entry.weight, 0);
}

export function formatAutoMinePercent(weight: number): string {
  const pct = weight / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function formatAutoMineCompositionLines(): string[] {
  return AUTOMINE_COMPOSITION.map((entry) => (
    `${getBlockDefinition(entry.blockId).name} — ${formatAutoMinePercent(entry.weight)}`
  ));
}

/** `unit` is in [0, 1). 1.0 maps to the last bucket so the table stays closed. */
export function selectAutoMineBlock(unit: number): BlockId {
  const total = AUTOMINE_WEIGHT_TOTAL;
  const slot = !Number.isFinite(unit) || unit < 0
    ? 0
    : unit >= 1
      ? total - 1
      : Math.floor(unit * total);
  return selectAutoMineBlockSlot(slot);
}

export function selectAutoMineBlockSlot(slot: number): BlockId {
  const clamped = Math.min(Math.max(Math.floor(slot), 0), AUTOMINE_WEIGHT_TOTAL - 1);
  for (let i = 0; i < CUMULATIVE.length; i += 1) {
    if (clamped < CUMULATIVE[i]!) return AUTOMINE_COMPOSITION[i]!.blockId;
  }
  return AUTOMINE_COMPOSITION[AUTOMINE_COMPOSITION.length - 1]!.blockId;
}

export function parseAutoMineName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const name = raw.trim().toLowerCase();
  if (!new RegExp(`^[a-z0-9_]{1,${AUTOMINE_NAME_MAX}}$`).test(name)) return undefined;
  return name;
}

export function cuboidSize(volume: SelectionVolume): AutoMineCuboidSize {
  const width = volume.maxX - volume.minX + 1;
  const height = volume.maxY - volume.minY + 1;
  const depth = volume.maxZ - volume.minZ + 1;
  return { width, height, depth, blocks: width * height * depth };
}

export function volumeFromSelection(selection: AutoMineSelection): SelectionVolume | undefined {
  if (!selection.pos1 || !selection.pos2) return undefined;
  return volumeFromCorners(selection.pos1, selection.pos2);
}

export function validateAutoMineVolume(
  volume: SelectionVolume,
  worldId: string,
  expectedWorldId: string,
): string | undefined {
  if (worldId !== expectedWorldId) return 'Авто-шахта должна находиться в текущем мире.';
  if (![volume.minX, volume.minY, volume.minZ, volume.maxX, volume.maxY, volume.maxZ].every(Number.isInteger)) {
    return 'Координаты авто-шахты должны быть целыми.';
  }
  if (!isValidWorldY(volume.minY) || !isValidWorldY(volume.maxY)) {
    return 'Авто-шахта выходит за границы мира по Y.';
  }
  const size = cuboidSize(volume);
  if (size.width < 1 || size.height < 1 || size.depth < 1) return 'Некорректный размер авто-шахты.';
  if (size.width > AUTOMINE_MAX_EDGE || size.height > AUTOMINE_MAX_EDGE || size.depth > AUTOMINE_MAX_EDGE) {
    return `Сторона авто-шахты не может быть больше ${AUTOMINE_MAX_EDGE}.`;
  }
  if (size.blocks > AUTOMINE_MAX_VOLUME) {
    return `Авто-шахта слишком большая (${size.blocks} блоков, максимум ${AUTOMINE_MAX_VOLUME}).`;
  }
  return undefined;
}

export function voxelIndex(volume: SelectionVolume, x: number, y: number, z: number): number {
  const size = cuboidSize(volume);
  return ((y - volume.minY) * size.depth + (z - volume.minZ)) * size.width + (x - volume.minX);
}

export function voxelAt(volume: SelectionVolume, index: number): BlockPos {
  const size = cuboidSize(volume);
  const width = size.width;
  const layer = size.width * size.depth;
  const y = volume.minY + Math.floor(index / layer);
  const rem = index % layer;
  const z = volume.minZ + Math.floor(rem / width);
  const x = volume.minX + (rem % width);
  return { x, y, z };
}

export function playerBlockPos(pos: { readonly x: number; readonly y: number; readonly z: number }): BlockPos {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

export function playerInsideVolume(
  pos: { readonly x: number; readonly y: number; readonly z: number },
  volume: SelectionVolume,
): boolean {
  const feet = playerBlockPos(pos);
  return volumeContains(volume, feet.x, feet.y, feet.z);
}

export function mineVolume(mine: Pick<AutoMineRecord, 'minX' | 'minY' | 'minZ' | 'maxX' | 'maxY' | 'maxZ'>): SelectionVolume {
  return {
    minX: mine.minX,
    minY: mine.minY,
    minZ: mine.minZ,
    maxX: mine.maxX,
    maxY: mine.maxY,
    maxZ: mine.maxZ,
  };
}

export function secondsUntil(nextResetAt: number | null, now: number): number | null {
  if (nextResetAt === null) return null;
  return Math.max(0, Math.ceil((nextResetAt - now) / 1000));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseTeleport(raw: unknown): AutoMineTeleport | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.worldId !== 'string' || !value.worldId) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)
    || !isFiniteNumber(value.yaw) || !isFiniteNumber(value.pitch)) {
    return null;
  }
  return {
    worldId: value.worldId,
    x: value.x,
    y: value.y,
    z: value.z,
    yaw: value.yaw,
    pitch: value.pitch,
  };
}

export function parseAutoMineStore(raw: unknown, log?: (message: string) => void): AutoMineStore {
  const fallback: AutoMineStore = { mines: [] };
  if (!raw || typeof raw !== 'object') return fallback;
  const mines = (raw as { mines?: unknown }).mines;
  if (!Array.isArray(mines)) return fallback;
  const parsed: AutoMineRecord[] = [];
  const seen = new Set<string>();
  for (const entry of mines) {
    if (!entry || typeof entry !== 'object') {
      log?.('skip malformed automine entry');
      continue;
    }
    const value = entry as Record<string, unknown>;
    const name = parseAutoMineName(typeof value.name === 'string' ? value.name : undefined);
    if (!name) {
      log?.('skip automine with invalid name');
      continue;
    }
    if (seen.has(name)) {
      log?.(`skip duplicate automine '${name}'`);
      continue;
    }
    if (typeof value.worldId !== 'string' || !value.worldId) {
      log?.(`skip automine '${name}' without worldId`);
      continue;
    }
    const coords = [value.minX, value.minY, value.minZ, value.maxX, value.maxY, value.maxZ];
    if (!coords.every((coord) => Number.isInteger(coord))) {
      log?.(`skip automine '${name}' with invalid bounds`);
      continue;
    }
    const volume: SelectionVolume = {
      minX: value.minX as number,
      minY: value.minY as number,
      minZ: value.minZ as number,
      maxX: value.maxX as number,
      maxY: value.maxY as number,
      maxZ: value.maxZ as number,
    };
    if (validateAutoMineVolume(volume, value.worldId, value.worldId)) {
      log?.(`skip automine '${name}' with invalid volume`);
      continue;
    }
    const intervalSeconds = value.intervalSeconds === null || value.intervalSeconds === undefined
      ? null
      : (Number.isInteger(value.intervalSeconds) && (value.intervalSeconds as number) >= AUTOMINE_MIN_INTERVAL_SECONDS
        ? value.intervalSeconds as number
        : null);
    const nextResetAt = value.nextResetAt === null || value.nextResetAt === undefined
      ? null
      : (isFiniteNumber(value.nextResetAt) ? value.nextResetAt : null);
    seen.add(name);
    parsed.push({
      name,
      worldId: value.worldId,
      minX: volume.minX,
      minY: volume.minY,
      minZ: volume.minZ,
      maxX: volume.maxX,
      maxY: volume.maxY,
      maxZ: volume.maxZ,
      intervalSeconds,
      teleport: parseTeleport(value.teleport),
      nextResetAt,
    });
  }
  return { mines: parsed };
}

export function parseOriginalBlocks(raw: unknown, expected: number): number[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const blocks = (raw as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length !== expected) return undefined;
  const out: number[] = [];
  for (const block of blocks) {
    if (!Number.isInteger(block) || !isKnownBlockId(block)) return undefined;
    out.push(block);
  }
  return out;
}

export function snapshotVolume(world: VoxelWorld, volume: SelectionVolume): number[] {
  const size = cuboidSize(volume);
  const blocks = new Array<number>(size.blocks);
  for (let i = 0; i < size.blocks; i += 1) {
    const pos = voxelAt(volume, i);
    blocks[i] = world.getBlock(pos.x, pos.y, pos.z);
  }
  return blocks;
}

export class AutoMineManager {
  enabled = false;
  blocksPerTick = AUTOMINE_BLOCKS_PER_TICK;
  private readonly selections = new Map<string, AutoMineSelection>();
  private mines: AutoMineRecord[] = [];
  private readonly jobs = new Map<string, AutoMineJob>();
  private readonly originals = new Map<string, number[]>();

  constructor(private readonly host: AutoMineHost) {}

  load(): void {
    try {
      const store = parseAutoMineStore(this.host.loadStore(), (message) => this.host.log(message));
      this.mines = store.mines;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.log(`failed to load automines: ${message}`);
      this.mines = [];
    }
    this.originals.clear();
    for (const mine of this.mines) {
      const size = cuboidSize(mineVolume(mine));
      try {
        const blocks = parseOriginalBlocks(this.host.loadOriginals(mine.name), size.blocks);
        if (blocks) this.originals.set(mine.name, blocks);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.host.log(`failed to load original snapshot for '${mine.name}': ${message}`);
      }
    }
  }

  persist(): void {
    this.host.saveStore({ mines: this.mines });
  }

  list(): readonly AutoMineRecord[] {
    return this.mines;
  }

  get(name: string): AutoMineRecord | undefined {
    const key = name.toLowerCase();
    return this.mines.find((mine) => mine.name === key);
  }

  statusOf(name: string): AutoMineStatus {
    return this.jobs.has(name.toLowerCase()) ? 'RESETTING' : 'READY';
  }

  isResetting(name: string): boolean {
    return this.jobs.has(name.toLowerCase());
  }

  selectionOf(playerId: string): AutoMineSelection {
    return { ...(this.selections.get(playerId) ?? {}) };
  }

  setSelectionPoint(playerId: string, pos: BlockPos): { slot: 1 | 2; volume?: SelectionVolume } {
    const current = this.selections.get(playerId) ?? {};
    const slot: 1 | 2 = !current.pos1 || (current.pos1 && current.pos2) ? 1 : 2;
    if (slot === 1) {
      current.pos1 = pos;
      current.pos2 = undefined;
    } else {
      current.pos2 = pos;
    }
    this.selections.set(playerId, current);
    return { slot, volume: volumeFromSelection(current) };
  }

  clearSelection(playerId: string): void {
    this.selections.delete(playerId);
  }

  create(name: string, volume: SelectionVolume, worldId: string): { ok: true; mine: AutoMineRecord } | { ok: false; error: string } {
    const parsed = parseAutoMineName(name);
    if (!parsed) return { ok: false, error: `Некорректное имя авто-шахты. Используйте 1–${AUTOMINE_NAME_MAX} символов: a-z, 0-9, _.` };
    if (this.get(parsed)) return { ok: false, error: `Авто-шахта '${parsed}' уже существует.` };
    const invalid = validateAutoMineVolume(volume, worldId, this.host.worldId());
    if (invalid) return { ok: false, error: invalid };
    const originals = snapshotVolume(this.host.world, volume);
    const mine: AutoMineRecord = {
      name: parsed,
      worldId,
      minX: volume.minX,
      minY: volume.minY,
      minZ: volume.minZ,
      maxX: volume.maxX,
      maxY: volume.maxY,
      maxZ: volume.maxZ,
      intervalSeconds: null,
      teleport: null,
      nextResetAt: null,
    };
    this.mines.push(mine);
    this.originals.set(parsed, originals);
    this.host.saveOriginals(parsed, originals);
    this.persist();
    const started = this.enqueueJob(mine, 'fill');
    if (!started.ok) return { ok: false, error: started.error };
    return { ok: true, mine };
  }

  delete(name: string): { ok: true; restoring: boolean } | { ok: false; error: string } {
    const mine = this.get(name);
    if (!mine) return { ok: false, error: `Авто-шахта '${name}' не найдена.` };
    this.jobs.delete(mine.name);
    const originals = this.originals.get(mine.name) ?? parseOriginalBlocks(
      this.host.loadOriginals(mine.name),
      cuboidSize(mineVolume(mine)).blocks,
    );
    if (!originals) {
      this.removeMine(mine.name);
      this.host.log(`deleted '${mine.name}' without original snapshot; generated blocks were left in place`);
      return { ok: true, restoring: false };
    }
    this.originals.set(mine.name, originals);
    const started = this.enqueueJob(mine, 'restore', originals);
    if (!started.ok) {
      this.removeMine(mine.name);
      return { ok: false, error: started.error };
    }
    return { ok: true, restoring: true };
  }

  setIntervalSeconds(name: string, seconds: number): { ok: true; mine: AutoMineRecord } | { ok: false; error: string } {
    const mine = this.get(name);
    if (!mine) return { ok: false, error: `Авто-шахта '${name}' не найдена.` };
    if (!Number.isInteger(seconds) || seconds < AUTOMINE_MIN_INTERVAL_SECONDS || seconds > AUTOMINE_MAX_INTERVAL_SECONDS) {
      return {
        ok: false,
        error: `Интервал должен быть целым числом секунд от ${AUTOMINE_MIN_INTERVAL_SECONDS} до ${AUTOMINE_MAX_INTERVAL_SECONDS}.`,
      };
    }
    mine.intervalSeconds = seconds;
    if (!this.jobs.has(mine.name) && mine.teleport) {
      mine.nextResetAt = this.host.now() + seconds * 1000;
    }
    this.persist();
    return { ok: true, mine };
  }

  setTeleport(name: string, teleport: AutoMineTeleport): { ok: true; mine: AutoMineRecord } | { ok: false; error: string } {
    const mine = this.get(name);
    if (!mine) return { ok: false, error: `Авто-шахта '${name}' не найдена.` };
    if (teleport.worldId !== mine.worldId) {
      return { ok: false, error: 'Точка телепорта должна быть в том же мире, что и авто-шахта.' };
    }
    mine.teleport = teleport;
    if (!this.jobs.has(mine.name) && mine.intervalSeconds) {
      mine.nextResetAt = this.host.now() + mine.intervalSeconds * 1000;
    }
    this.persist();
    return { ok: true, mine };
  }

  requestReset(name: string, options: { readonly manual?: boolean } = {}): { ok: true } | { ok: false; error: string } {
    const mine = this.get(name);
    if (!mine) return { ok: false, error: `Авто-шахта '${name}' не найдена.` };
    if (this.jobs.has(mine.name)) {
      return { ok: false, error: `Авто-шахта '${mine.name}' уже обновляется.` };
    }
    if (mine.worldId !== this.host.worldId()) {
      return { ok: false, error: 'Авто-шахта находится в другом мире.' };
    }
    if (!mine.teleport) {
      const error = 'Для авто-шахты не задана точка телепорта.';
      if (!options.manual) this.host.notifyAdmins(`Авто-шахта '${mine.name}': ${error}`);
      return { ok: false, error };
    }
    const evacuated = this.evacuate(mine);
    if (!evacuated.ok) return evacuated;
    return this.enqueueJob(mine, 'fill');
  }

  tick(now = this.host.now()): void {
    if (!this.enabled) return;
    this.processJobs();
    for (const mine of this.mines) {
      if (this.jobs.has(mine.name)) continue;
      if (mine.worldId !== this.host.worldId()) continue;
      if (!mine.intervalSeconds || !mine.teleport || mine.nextResetAt === null) continue;
      if (now < mine.nextResetAt) continue;
      const result = this.requestReset(mine.name);
      if (!result.ok) {
        mine.nextResetAt = now + mine.intervalSeconds * 1000;
        this.persist();
        this.host.log(`auto-reset '${mine.name}' aborted: ${result.error}`);
      }
    }
  }

  stop(): void {
    this.enabled = false;
    this.jobs.clear();
    this.selections.clear();
  }

  private removeMine(name: string): void {
    this.mines = this.mines.filter((mine) => mine.name !== name);
    this.jobs.delete(name);
    this.originals.delete(name);
    this.persist();
  }

  private enqueueJob(mine: AutoMineRecord, kind: 'fill' | 'restore', originals?: readonly number[]): { ok: true } | { ok: false; error: string } {
    if (this.jobs.has(mine.name)) {
      return { ok: false, error: `Авто-шахта '${mine.name}' уже обновляется.` };
    }
    const volume = mineVolume(mine);
    this.jobs.set(mine.name, {
      name: mine.name,
      kind,
      volume,
      total: cuboidSize(volume).blocks,
      offset: 0,
      originals,
    });
    return { ok: true };
  }

  private evacuate(mine: AutoMineRecord): { ok: true } | { ok: false; error: string } {
    const teleport = mine.teleport;
    if (!teleport) return { ok: false, error: 'Для авто-шахты не задана точка телепорта.' };
    const volume = mineVolume(mine);
    for (const player of this.host.players()) {
      const pos = player.position();
      if (!playerInsideVolume(pos, volume)) continue;
      const result = this.host.teleport(player.id, teleport);
      if (!result.ok) {
        this.host.log(`evacuate '${mine.name}' failed for ${player.id}: ${result.error ?? 'teleport failed'}`);
        this.host.send(player.id, result.error ?? 'Не удалось телепортировать из авто-шахты.');
        continue;
      }
      this.host.send(player.id, 'Авто-шахта обновляется.');
    }
    return { ok: true };
  }

  private processJobs(): void {
    const budget = Math.max(1, Math.floor(this.blocksPerTick));
    for (const job of [...this.jobs.values()]) {
      try {
        this.stepJob(job, budget);
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        this.jobs.delete(job.name);
        const mine = this.get(job.name);
        if (mine?.intervalSeconds && mine.teleport) {
          mine.nextResetAt = this.host.now() + mine.intervalSeconds * 1000;
          this.persist();
        }
        this.host.log(`job '${job.name}' failed: ${message}`);
        this.host.notifyAdmins(`Авто-шахта '${job.name}': сбой генерации. Статус сброшен.`);
      }
    }
  }

  private stepJob(job: AutoMineJob, budget: number): void {
    const mutations = [];
    const end = Math.min(job.total, job.offset + budget);
    for (let index = job.offset; index < end; index += 1) {
      const pos = voxelAt(job.volume, index);
      const block = job.kind === 'restore'
        ? (job.originals?.[index] ?? BlockId.Air)
        : selectAutoMineBlock(this.host.random());
      mutations.push({ x: pos.x, y: pos.y, z: pos.z, block });
    }
    if (mutations.length > 0) {
      this.host.world.applyBlockBatch(mutations, {
        skipSupport: true,
        scheduleNeighbors: false,
        updateLighting: true,
      });
      this.host.onBlocksWritten?.(mutations);
    }
    job.offset = end;
    if (job.offset < job.total) return;
    this.jobs.delete(job.name);
    if (job.kind === 'restore') {
      this.removeMine(job.name);
      this.host.log(`restored and deleted '${job.name}'`);
      return;
    }
    const mine = this.get(job.name);
    if (!mine) return;
    mine.nextResetAt = mine.intervalSeconds && mine.teleport
      ? this.host.now() + mine.intervalSeconds * 1000
      : null;
    this.persist();
  }
}
