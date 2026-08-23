import { describe, expect, it } from 'vitest';
import {
  chunksInSquareRadius,
  initialReadyChunkRadius,
  monotonicPercent,
  worldLoadPercent,
} from '../src/core/worldLoading';
import { playerGameplayAllowed, worldSimulationActive } from '../src/core/gameplayModal';
import { shouldRequestPointerLock } from '../src/input/pointerLock';
import { VoxelWorld } from '../src/world/World';
import { initialAreaReady, countInitialAreaProgress } from '../src/world/worldJobs';

describe('world loading readiness', () => {
  it('keeps gameplay and pointer lock off while LOADING_WORLD', () => {
    expect(worldSimulationActive('LOADING_WORLD')).toBe(false);
    expect(playerGameplayAllowed('LOADING_WORLD', false)).toBe(false);
    expect(shouldRequestPointerLock({
      canCapture: false,
      coarsePointer: false,
      lockedToCanvas: false,
    })).toBe(false);
  });

  it('uses the current render distance as the initial ready radius', () => {
    expect(initialReadyChunkRadius(4)).toBe(4);
    expect(chunksInSquareRadius(2)).toBe(25);
  });

  it('progress is monotonic and reaches 100 only when ready', () => {
    const generating = worldLoadPercent({
      phase: 'generate',
      generated: 10,
      generateTotal: 25,
      lit: 4,
      litTotal: 25,
      meshed: 0,
      meshTotal: 25,
    });
    const meshing = worldLoadPercent({
      phase: 'mesh',
      generated: 25,
      generateTotal: 25,
      lit: 25,
      litTotal: 25,
      meshed: 20,
      meshTotal: 25,
    });
    expect(meshing).toBeGreaterThanOrEqual(generating);
    expect(monotonicPercent(generating, generating - 5)).toBe(generating);
    expect(worldLoadPercent({
      phase: 'ready',
      generated: 25,
      generateTotal: 25,
      lit: 25,
      litTotal: 25,
      meshed: 25,
      meshTotal: 25,
    })).toBe(100);
    expect(worldLoadPercent({
      phase: 'error',
      generated: 24,
      generateTotal: 25,
      lit: 20,
      litTotal: 25,
      meshed: 18,
      meshTotal: 25,
      error: 'boom',
    })).toBeLessThan(100);
  });

  it('initialAreaReady requires generated, lit and meshed chunks in the radius', () => {
    const world = new VoxelWorld('ready-radius');
    world.ensureChunks(0, 0, 1);
    for (const chunk of world.chunks.values()) world.ensureChunkLighting(chunk);
    const meshes = new Set<string>();
    expect(initialAreaReady(world, (key) => meshes.has(key), 0, 0, 1)).toBe(false);
    for (const key of world.chunks.keys()) meshes.add(key);
    for (const chunk of world.chunks.values()) chunk.dirty = false;
    expect(initialAreaReady(world, (key) => meshes.has(key), 0, 0, 1)).toBe(true);
    const progress = countInitialAreaProgress(world, (key) => meshes.has(key), 0, 0, 1);
    expect(progress.generated).toBe(progress.total);
    expect(progress.lit).toBe(progress.total);
    expect(progress.meshed).toBe(progress.total);
  });
});
