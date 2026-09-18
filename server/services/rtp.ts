import { BlockId, getBlockDefinition } from '../../src/blocks';
import { CHUNK_SIZE, MAX_WORLD_Y, MIN_WORLD_Y, floorDiv, isValidWorldY } from '../../src/core/constants';
import type { VoxelWorld } from '../../src/world/World';

export const RTP_MIN = -10_000;
export const RTP_MAX = 10_000;

export interface RtpSearchOptions {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly attemptsPerTick: number;
  readonly maxAttempts: number;
  readonly maxChunkGenerates: number;
}

export interface RtpDestination {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RtpSearchState {
  attempts: number;
  generates: number;
  found?: RtpDestination;
  exhausted: boolean;
  tried?: Set<string>;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function clampRtpBounds(options: {
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
}): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const minX = clampInt(options.minX ?? RTP_MIN, RTP_MIN, RTP_MAX);
  const maxX = clampInt(options.maxX ?? RTP_MAX, RTP_MIN, RTP_MAX);
  const minZ = clampInt(options.minZ ?? RTP_MIN, RTP_MIN, RTP_MAX);
  const maxZ = clampInt(options.maxZ ?? RTP_MAX, RTP_MIN, RTP_MAX);
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
  };
}

export function randomRtpColumn(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  random: () => number = Math.random,
): { x: number; z: number } {
  const x = Math.floor(minX + random() * (maxX - minX + 1));
  const z = Math.floor(minZ + random() * (maxZ - minZ + 1));
  return { x, z };
}

/** Next unused column. Prevents RNG repeats from stalling the search forever. */
export function nextUntriedRtpColumn(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  tried: ReadonlySet<string>,
  random: () => number = Math.random,
): { x: number; z: number } | undefined {
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const area = width * depth;
  if (tried.size >= area || area <= 0) return undefined;
  const start = Math.floor(random() * area);
  for (let i = 0; i < area; i += 1) {
    const index = (start + i) % area;
    const x = minX + (index % width);
    const z = minZ + Math.floor(index / width);
    if (!tried.has(`${x},${z}`)) return { x, z };
  }
  return undefined;
}

export function isDangerousBlock(blockId: number): boolean {
  return blockId === BlockId.Lava || blockId === BlockId.Fire || blockId === BlockId.Cactus;
}

export function isSafeRtpStand(world: VoxelWorld, x: number, y: number, z: number): boolean {
  if (!isValidWorldY(y) || y < MIN_WORLD_Y + 1 || y > MAX_WORLD_Y - 2) return false;
  const ground = world.getBlock(x, y, z, false);
  const feet = world.getBlock(x, y + 1, z, false);
  const head = world.getBlock(x, y + 2, z, false);
  const groundDef = getBlockDefinition(ground);
  if (!groundDef.solid || ground === BlockId.OakLeaves || isDangerousBlock(ground)) return false;
  if (feet !== BlockId.Air || head !== BlockId.Air) return false;
  if (isDangerousBlock(world.getBlock(x, y - 1, z, false))) return false;
  return true;
}

export class RtpService {
  constructor(private readonly world: VoxelWorld) {}

  createSearch(options: RtpSearchOptions): RtpSearchState {
    return { attempts: 0, generates: 0, exhausted: false };
  }

  /**
   * Bounded search: at most `attemptsPerTick` evaluated columns and
   * `maxChunkGenerates` new chunks *per call*. Generate-budget skips do not
   * consume `maxAttempts`. Duplicate columns are skipped.
   */
  step(state: RtpSearchState, options: RtpSearchOptions, random: () => number = Math.random): RtpSearchState {
    if (state.found || state.exhausted) return state;
    const bounds = clampRtpBounds(options);
    const attemptBudget = Math.max(1, options.attemptsPerTick);
    const generateBudget = Math.max(0, options.maxChunkGenerates);
    const tried = state.tried ?? (state.tried = new Set<string>());
    const area = (bounds.maxX - bounds.minX + 1) * (bounds.maxZ - bounds.minZ + 1);
    let generates = 0;
    for (let i = 0; i < attemptBudget; i += 1) {
      if (state.attempts >= options.maxAttempts || tried.size >= area) {
        if (!state.found) state.exhausted = true;
        state.generates += generates;
        return state;
      }
      let column = randomRtpColumn(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, random);
      let key = `${column.x},${column.z}`;
      if (tried.has(key)) {
        const next = nextUntriedRtpColumn(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, tried, random);
        if (!next) {
          if (!state.found) state.exhausted = true;
          state.generates += generates;
          return state;
        }
        column = next;
        key = `${column.x},${column.z}`;
      }
      const cx = floorDiv(column.x, CHUNK_SIZE);
      const cz = floorDiv(column.z, CHUNK_SIZE);
      const existing = this.world.getChunk(cx, cz, false);
      if (!existing) {
        if (generates >= generateBudget) continue;
        this.world.getChunk(cx, cz, true);
        generates += 1;
      }
      tried.add(key);
      state.attempts += 1;
      const y = this.world.surfaceY(column.x, column.z);
      if (isSafeRtpStand(this.world, column.x, y, column.z)) {
        state.found = { x: column.x + 0.5, y: y + 1, z: column.z + 0.5 };
        state.generates += generates;
        return state;
      }
    }
    state.generates += generates;
    if (state.attempts >= options.maxAttempts || tried.size >= area) state.exhausted = true;
    return state;
  }
}

export interface RtpRequest {
  readonly playerId: string;
  readonly options: RtpSearchOptions;
  readonly state: RtpSearchState;
  readonly reason: 'rtp' | 'portal';
  readonly warmupMs: number;
  readonly cooldownMs: number;
  readonly cancelOnMove: boolean;
  readonly cancelOnDamage: boolean;
}

export interface RtpEnqueueOptions {
  readonly reason?: 'rtp' | 'portal';
  readonly warmupMs?: number;
  readonly cooldownMs?: number;
  readonly cancelOnMove?: boolean;
  readonly cancelOnDamage?: boolean;
}

export class RtpSessionManager {
  private readonly requests = new Map<string, RtpRequest>();

  constructor(private readonly rtp: RtpService) {}

  has(playerId: string): boolean {
    return this.requests.has(playerId);
  }

  enqueue(playerId: string, options: RtpSearchOptions, extra: RtpEnqueueOptions = {}): { ok: boolean; error?: string } {
    if (this.requests.has(playerId)) return { ok: false, error: 'Already searching for a safe location.' };
    this.requests.set(playerId, {
      playerId,
      options,
      state: this.rtp.createSearch(options),
      reason: extra.reason ?? 'rtp',
      warmupMs: extra.warmupMs ?? 0,
      cooldownMs: extra.cooldownMs ?? 0,
      cancelOnMove: extra.cancelOnMove !== false,
      cancelOnDamage: extra.cancelOnDamage !== false,
    });
    return { ok: true };
  }

  cancel(playerId: string): void {
    this.requests.delete(playerId);
  }

  tick(random: () => number = Math.random): Array<{
    playerId: string;
    dest?: RtpDestination;
    exhausted?: boolean;
    request: RtpRequest;
  }> {
    const done: Array<{ playerId: string; dest?: RtpDestination; exhausted?: boolean; request: RtpRequest }> = [];
    for (const request of [...this.requests.values()]) {
      this.rtp.step(request.state, request.options, random);
      if (request.state.found) {
        this.requests.delete(request.playerId);
        done.push({ playerId: request.playerId, dest: request.state.found, request });
      } else if (request.state.exhausted) {
        this.requests.delete(request.playerId);
        done.push({ playerId: request.playerId, exhausted: true, request });
      }
    }
    return done;
  }
}

