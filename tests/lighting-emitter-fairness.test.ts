import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { WORLD_LIGHT_BUDGET_MS } from '../src/core/constants';
import {
  LIGHT_FLOOD_ADD_EMITTER,
  lightingBlockOverrideCount,
  lightingFloodOwner,
  lightingMemoryUsage,
  lightFrameStats,
  readMeshBlockLight,
} from '../src/world/LightEngine';
import { EDIT_LIGHT_MAX_WAIT_MS, EDIT_LIGHT_QUEUE_LIMIT, VoxelWorld } from '../src/world/World';

/**
 * Same fake-clock bound as the 60 FPS edit-queue stream: 75 cap-slices plus
 * two overdue intervals of slack. Slice-budget age prices each slice at
 * WORLD_LIGHT_BUDGET_MS and stays under twice EDIT_LIGHT_MAX_WAIT_MS.
 */
const STREAM_FRAME_MS = 1000 / 60;
const STREAM_AGE_LIMIT_MS = 75 * STREAM_FRAME_MS + EDIT_LIGHT_MAX_WAIT_MS * 2;
const options = { deferLighting: true, scheduleNeighbors: false, skipSupport: true } as const;
const TORCH = { x: 3, y: 60, z: 8 } as const;
const EXTRA = { x: 6, y: 60, z: 8 } as const;
const SAMPLE = { x: 12, y: 60, z: 8 } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function settle(world: VoxelWorld, x = 8, z = 8): void {
  for (let step = 0; step < 8000; step += 1) {
    if (world.pendingLightJobs === 0 && lightingFloodOwner(world) === '') return;
    world.processLighting(WORLD_LIGHT_BUDGET_MS, x, z);
  }
  throw new Error(`lighting did not settle pending=${world.pendingLightJobs} owner=${lightingFloodOwner(world)}`);
}

function withClock(now: number, jumpAfterReads: number, run: () => void): void {
  let reads = 0;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
    reads += 1;
    return reads > jumpAfterReads ? now + 100 : now;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
}

function at(now: number, run: () => void): void {
  withClock(now, Number.POSITIVE_INFINITY, run);
}

function preparePlatform(seed: string): { world: VoxelWorld; cells: Array<{ x: number; y: number; z: number }> } {
  const world = new VoxelWorld(seed);
  world.ensureChunks(8, 8, 1);
  const air = [];
  for (let x = 0; x <= 16; x += 1) {
    for (let z = 0; z <= 16; z += 1) {
      for (let y = 30; y <= 80; y += 1) air.push({ x, y, z, block: BlockId.Air });
    }
  }
  world.applyBlockBatch(air, { scheduleNeighbors: false, skipSupport: true });
  const cells = [];
  const stones = [];
  for (let x = 2; x <= 13; x += 1) {
    for (let z = 2; z <= 13; z += 1) {
      cells.push({ x, y: 42, z });
      stones.push({ x, y: 42, z, block: BlockId.Stone });
    }
  }
  world.applyBlockBatch(stones, { scheduleNeighbors: false, skipSupport: true });
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  return { world, cells };
}

function makeRoom(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  world.ensureChunks(8, 8, 0);
  const stone = [];
  for (let x = 0; x <= 15; x += 1) {
    for (let z = 0; z <= 15; z += 1) {
      for (let y = 56; y <= 64; y += 1) stone.push({ x, y, z, block: BlockId.Stone });
    }
  }
  world.applyBlockBatch(stone, { scheduleNeighbors: false, skipSupport: true });
  const air = [];
  for (let x = 1; x <= 14; x += 1) {
    for (let z = 1; z <= 14; z += 1) {
      for (let y = 58; y <= 62; y += 1) air.push({ x, y, z, block: BlockId.Air });
    }
  }
  world.applyBlockBatch(air, { scheduleNeighbors: false, skipSupport: true });
  for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
  return world;
}

function roomCells(): Array<readonly [number, number, number]> {
  const cells = [];
  for (let x = 1; x <= 14; x += 1) {
    for (let z = 1; z <= 14; z += 1) {
      for (let y = 58; y <= 62; y += 1) cells.push([x, y, z] as const);
    }
  }
  return cells;
}

function wallMutations(): Array<{ x: number; y: number; z: number; block: BlockId }> {
  const wall = [];
  for (let z = 1; z <= 14; z += 1) {
    for (let y = 58; y <= 62; y += 1) wall.push({ x: 8, y, z, block: BlockId.Stone });
  }
  return wall;
}

function lightMismatch(
  actual: VoxelWorld,
  reference: VoxelWorld,
  cells: ReadonlyArray<readonly [number, number, number]>,
  sky = false,
): string {
  const mismatches: string[] = [];
  for (const [x, y, z] of cells) {
    const block = actual.blockLightAt(x, y, z);
    const expected = reference.blockLightAt(x, y, z);
    if (block !== expected) mismatches.push(`block ${x},${y},${z} ${block}!=${expected}`);
    if (sky) {
      const actualSky = actual.skyLightAt(x, y, z);
      const expectedSky = reference.skyLightAt(x, y, z);
      if (actualSky !== expectedSky) mismatches.push(`sky ${x},${y},${z} ${actualSky}!=${expectedSky}`);
    }
    if (mismatches.length >= 6) break;
  }
  return mismatches.join('; ');
}

function findPartialJump(): number {
  for (let jump = 2; jump <= 80; jump += 1) {
    const world = makeRoom(`emitter-jump-${jump}`);
    world.deferredLighting = true;
    at(10_000, () => world.applyBlockBatch([{ ...TORCH, block: BlockId.Torch }], options));
    withClock(10_000, jump, () => world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8));
    const partial = world.emitterLightActive
      && lightingFloodOwner(world) === LIGHT_FLOOD_ADD_EMITTER
      && world.emitterLightCommits === 0
      && lightFrameStats.nodes > 0
      && lightFrameStats.nodes < 4096
      && world.blockLightAt(TORCH.x, TORCH.y, TORCH.z) > 0
      && world.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z) === 0;
    if (partial) return jump;
  }
  throw new Error('could not yield an add-emitter flood before the far sample was lit');
}

let partialJump: number | undefined;

function yieldEmitter(world: VoxelWorld, now: number): void {
  partialJump ??= findPartialJump();
  withClock(now, partialJump, () => world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8));
}

function pumpUntilEmitterCommit(world: VoxelWorld, now: number): number {
  const before = world.emitterLightCommits;
  for (let step = 0; step < 40; step += 1) {
    at(now, () => world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8));
    now += 16;
    if (world.emitterLightCommits > before && !world.emitterLightActive) return now;
  }
  throw new Error(`add-emitter batch did not commit owner=${lightingFloodOwner(world)}`);
}

describe('add-emitter fairness and consistent flood view', () => {
  it.each([BlockId.Torch, BlockId.Lantern])('commits %s light while a 20 TPS edit stream is still running', (source) => {
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
    const streamed = preparePlatform(`emit-stream-${source}`);
    streamed.world.deferredLighting = true;
    const count = 80;
    let now = 50_000;
    let applied = 0;
    let placed = false;
    let sawEmitterCommit = false;
    let editCommitsAfterEmitter = 0;
    let maxEmitterAge = 0;
    let maxEditAge = 0;
    let maxQueue = 0;
    const placeAt = 20;
    const frameMs = 1000 / 60;
    const frames = Math.ceil(5000 / frameMs);
    for (let frame = 0; frame < frames && applied < count; frame += 1) {
      now += frameMs;
      if (applied * 50 <= frame * frameMs) {
        const cell = streamed.cells[applied]!;
        at(now, () => streamed.world.applyBlockBatch([{ ...cell, block: BlockId.Air }], options));
        applied += 1;
      }
      if (!placed && applied >= placeAt) {
        at(now, () => streamed.world.applyBlockBatch([{ x: 8, y: 50, z: 8, block: source }], options));
        expect(streamed.world.getBlock(8, 50, 8)).toBe(source);
        expect(streamed.world.pendingEmitterCount).toBeGreaterThan(0);
        placed = true;
      }
      const editsBefore = streamed.world.editLightCommits;
      const emittersBefore = streamed.world.emitterLightCommits;
      at(now, () => streamed.world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8));
      if (placed && !sawEmitterCommit && streamed.world.emitterLightCommits > emittersBefore) {
        expect(applied).toBeLessThan(count);
        expect(streamed.world.blockLightAt(9, 50, 8)).toBeGreaterThan(0);
        expect(readMeshBlockLight(streamed.world, 9, 50, 8)).toBe(streamed.world.blockLightAt(9, 50, 8));
        expect(streamed.world.emitterLightActive).toBe(false);
        sawEmitterCommit = true;
      }
      if (sawEmitterCommit && applied < count) editCommitsAfterEmitter += streamed.world.editLightCommits - editsBefore;
      maxEmitterAge = Math.max(maxEmitterAge, streamed.world.emitterLightOldestAgeMs(now));
      maxEditAge = Math.max(maxEditAge, streamed.world.editLightOldestAgeMs(now));
      maxQueue = Math.max(maxQueue, streamed.world.editLightQueueLength, streamed.world.pendingEmitterCount);
    }
    expect(placed).toBe(true);
    expect(sawEmitterCommit).toBe(true);
    expect(editCommitsAfterEmitter).toBeGreaterThan(0);
    expect(maxEmitterAge).toBeLessThan(STREAM_AGE_LIMIT_MS);
    expect(maxEditAge).toBeLessThan(STREAM_AGE_LIMIT_MS);
    expect((maxEmitterAge / STREAM_FRAME_MS) * WORLD_LIGHT_BUDGET_MS).toBeLessThan(EDIT_LIGHT_MAX_WAIT_MS * 2);
    expect((maxEditAge / STREAM_FRAME_MS) * WORLD_LIGHT_BUDGET_MS).toBeLessThan(EDIT_LIGHT_MAX_WAIT_MS * 2);
    expect(maxQueue).toBeLessThanOrEqual(EDIT_LIGHT_QUEUE_LIMIT);
    expect(streamed.world.editLightRestarts).toBe(0);
  });

  it('does not commit a mixed view when a wall appears mid emitter flood', () => {
    const cells = roomCells();
    const open = makeRoom('emitter-wall-open');
    open.setBlock(TORCH.x, TORCH.y, TORCH.z, BlockId.Torch);
    const walled = makeRoom('emitter-wall-final');
    walled.setBlock(TORCH.x, TORCH.y, TORCH.z, BlockId.Torch);
    walled.applyBlockBatch(wallMutations(), { scheduleNeighbors: false, skipSupport: true });
    walled.setBlock(EXTRA.x, EXTRA.y, EXTRA.z, BlockId.Torch);
    expect(open.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBeGreaterThan(0);
    expect(walled.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBe(0);
    expect(walled.blockLightAt(EXTRA.x, EXTRA.y, EXTRA.z)).toBeGreaterThan(10);

    const world = makeRoom('emitter-wall-live');
    world.deferredLighting = true;
    let now = 80_000;
    at(now, () => world.applyBlockBatch([{ ...TORCH, block: BlockId.Torch }], options));
    yieldEmitter(world, now);
    expect(world.emitterLightActive).toBe(true);
    expect(world.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBe(0);
    expect(readMeshBlockLight(world, TORCH.x, TORCH.y, TORCH.z)).toBe(0);
    expect(world.blockLightAt(TORCH.x, TORCH.y, TORCH.z)).toBeGreaterThan(0);

    now += 16;
    at(now, () => {
      world.applyBlockBatch(wallMutations(), options);
      world.applyBlockBatch([{ ...EXTRA, block: BlockId.Torch }], options);
    });
    expect(world.getBlock(EXTRA.x, EXTRA.y, EXTRA.z)).toBe(BlockId.Torch);
    expect(world.emitterLightActive).toBe(true);
    expect(world.pendingEmitterCount).toBe(1);
    expect(lightingBlockOverrideCount(world)).toBeGreaterThan(0);
    expect(world.editLightRestarts).toBe(0);
    expect(readMeshBlockLight(world, TORCH.x, TORCH.y, TORCH.z)).toBe(0);

    now = pumpUntilEmitterCommit(world, now + 16);
    expect(world.pendingEmitterCount).toBe(1);
    expect(world.emitterLightActive).toBe(false);
    expect(lightMismatch(world, open, cells)).toBe('');
    expect(readMeshBlockLight(world, SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBe(open.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z));
    expect(world.blockLightAt(EXTRA.x, EXTRA.y, EXTRA.z)).toBe(open.blockLightAt(EXTRA.x, EXTRA.y, EXTRA.z));

    at(now, () => settle(world));
    expect(lightMismatch(world, walled, cells, true)).toBe('');
    expect(lightingBlockOverrideCount(world)).toBe(0);
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    expect(world.pendingEmitterCount).toBe(0);
    expect(lightingFloodOwner(world)).toBe('');
  });

  it('finishes a partial torch flood against the torch, then removal settles to darkness', () => {
    const cells = roomCells();
    const lit = makeRoom('emitter-break-lit');
    lit.setBlock(TORCH.x, TORCH.y, TORCH.z, BlockId.Torch);
    const dark = makeRoom('emitter-break-dark');
    expect(lit.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBeGreaterThan(0);
    expect(dark.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBe(0);

    const world = makeRoom('emitter-break-live');
    world.deferredLighting = true;
    let now = 90_000;
    at(now, () => world.applyBlockBatch([{ ...TORCH, block: BlockId.Torch }], options));
    yieldEmitter(world, now);
    expect(world.emitterLightActive).toBe(true);
    expect(world.blockLightAt(TORCH.x, TORCH.y, TORCH.z)).toBeGreaterThan(0);
    expect(readMeshBlockLight(world, TORCH.x, TORCH.y, TORCH.z)).toBe(0);
    expect(world.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBe(0);

    now += 16;
    at(now, () => world.applyBlockBatch([{ ...TORCH, block: BlockId.Air }], options));
    expect(world.getBlock(TORCH.x, TORCH.y, TORCH.z)).toBe(BlockId.Air);
    expect(world.emitterLightActive).toBe(true);
    expect(lightingBlockOverrideCount(world)).toBeGreaterThan(0);
    expect(world.editLightQueueLength).toBeGreaterThan(0);

    now = pumpUntilEmitterCommit(world, now + 16);
    expect(lightMismatch(world, lit, cells)).toBe('');
    expect(readMeshBlockLight(world, SAMPLE.x, SAMPLE.y, SAMPLE.z)).toBe(lit.blockLightAt(SAMPLE.x, SAMPLE.y, SAMPLE.z));
    expect(world.getBlock(TORCH.x, TORCH.y, TORCH.z)).toBe(BlockId.Air);

    at(now, () => settle(world));
    expect(lightMismatch(world, dark, cells, true)).toBe('');
    expect(lightingBlockOverrideCount(world)).toBe(0);
    expect(lightingMemoryUsage(world).snapshotBytes).toBe(0);
    expect(world.pendingLightJobs).toBe(0);
  });

  it('keeps queue bounds and exact light through source churn during edits', () => {
    const reference = preparePlatform('emitter-churn-ref');
    const streamed = preparePlatform('emitter-churn');
    streamed.world.deferredLighting = true;
    const count = 80;
    const flips: Array<{ at: number; block: BlockId }> = [
      { at: 10, block: BlockId.Torch },
      { at: 18, block: BlockId.Air },
      { at: 26, block: BlockId.Lantern },
      { at: 34, block: BlockId.Air },
      { at: 42, block: BlockId.RedstoneTorch },
      { at: 50, block: BlockId.Air },
    ];
    let now = 100_000;
    let applied = 0;
    let maxQueue = 0;
    let maxEmitterAge = 0;
    let emitterCommitsDuring = 0;
    let editCommitsDuring = 0;
    const frameMs = 1000 / 60;
    const frames = Math.ceil(6000 / frameMs);
    const source = { x: 8, y: 50, z: 8 };
    for (let frame = 0; frame < frames && applied < count; frame += 1) {
      now += frameMs;
      if (applied * 50 <= frame * frameMs) {
        const cell = streamed.cells[applied]!;
        const refCell = reference.cells[applied]!;
        at(now, () => streamed.world.applyBlockBatch([{ ...cell, block: BlockId.Air }], options));
        reference.world.applyBlockBatch([{ ...refCell, block: BlockId.Air }], { scheduleNeighbors: false, skipSupport: true });
        applied += 1;
        const flip = flips.find((item) => item.at === applied);
        if (flip) {
          at(now, () => streamed.world.applyBlockBatch([{ ...source, block: flip.block }], options));
          reference.world.applyBlockBatch([{ ...source, block: flip.block }], { scheduleNeighbors: false, skipSupport: true });
          expect(streamed.world.getBlock(source.x, source.y, source.z)).toBe(flip.block);
        }
      }
      const emittersBefore = streamed.world.emitterLightCommits;
      const editsBefore = streamed.world.editLightCommits;
      at(now, () => streamed.world.processLighting(WORLD_LIGHT_BUDGET_MS, 8, 8));
      if (applied < count) {
        emitterCommitsDuring += streamed.world.emitterLightCommits - emittersBefore;
        editCommitsDuring += streamed.world.editLightCommits - editsBefore;
      }
      maxQueue = Math.max(maxQueue, streamed.world.editLightQueueLength, streamed.world.pendingEmitterCount);
      maxEmitterAge = Math.max(maxEmitterAge, streamed.world.emitterLightOldestAgeMs(now));
    }
    expect(emitterCommitsDuring).toBeGreaterThan(0);
    expect(editCommitsDuring).toBeGreaterThan(0);
    expect(maxEmitterAge).toBeLessThan(STREAM_AGE_LIMIT_MS);
    expect((maxEmitterAge / STREAM_FRAME_MS) * WORLD_LIGHT_BUDGET_MS).toBeLessThan(EDIT_LIGHT_MAX_WAIT_MS * 2);
    expect(maxQueue).toBeLessThanOrEqual(EDIT_LIGHT_QUEUE_LIMIT);
    at(now, () => settle(streamed.world));
    const samples = [
      [8, 50, 8], [9, 50, 8], [8, 51, 8], [8, 43, 8], [4, 42, 4], [12, 42, 12],
    ] as const;
    expect(lightMismatch(streamed.world, reference.world, samples, true)).toBe('');
    for (let index = 0; index < count; index += 1) {
      const cell = reference.cells[index]!;
      expect(streamed.world.blockLightAt(cell.x, cell.y + 1, cell.z)).toBe(reference.world.blockLightAt(cell.x, cell.y + 1, cell.z));
      expect(streamed.world.skyLightAt(cell.x, cell.y + 1, cell.z)).toBe(reference.world.skyLightAt(cell.x, cell.y + 1, cell.z));
    }
    expect(lightingBlockOverrideCount(streamed.world)).toBe(0);
    expect(lightingMemoryUsage(streamed.world).snapshotBytes).toBe(0);
    expect(streamed.world.pendingEmitterCount).toBe(0);
    expect(streamed.world.pendingLightJobs).toBe(0);
    expect(streamed.world.editLightRestarts).toBe(0);
  });
});
