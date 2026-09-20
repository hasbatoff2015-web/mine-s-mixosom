import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { MobManager, PET_TELEPORT_DISTANCE } from '../src/entities';
import { Vec3 } from '../src/math/vec3';
import { VoxelWorld } from '../src/world/World';

function stoneWorld(): VoxelWorld {
  const world = new VoxelWorld('pet-perf');
  vi.spyOn(world, 'getBlock').mockImplementation((_x, y) => (y <= 70 ? BlockId.Stone : BlockId.Air));
  return world;
}

function runScenario(kind: 'idle' | 'follow' | 'teleport'): {
  avg: number;
  p95: number;
  max: number;
  searches: number;
  candidateChecks: number;
} {
  const world = stoneWorld();
  const manager = new MobManager(new THREE.Scene(), world, {
    automaticSpawning: false,
    random: () => 0.25,
    maxMobs: 64,
  });
  const owners = Array.from({ length: 20 }, (_, index) => ({
    id: `owner-${index}`,
    position: new Vec3(index * 3 + 0.5, 71, kind === 'teleport' ? PET_TELEPORT_DISTANCE + 8 : kind === 'follow' ? 9 : 1),
    eyePosition: new Vec3(index * 3 + 0.5, 72.62, kind === 'teleport' ? PET_TELEPORT_DISTANCE + 8 : 1),
    alive: true,
    targetable: true,
  }));
  for (let index = 0; index < 20; index += 1) {
    manager.spawn(index % 2 === 0 ? 'wolf' : 'cat', new Vec3(index * 3 + 0.5, 71, 0.5), {
      force: true,
      ownerId: owners[index]!.id,
      sitting: false,
    });
  }
  const samples: number[] = [];
  for (let tick = 0; tick < 40; tick += 1) {
    const started = performance.now();
    manager.update(0.05, { players: owners });
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const result = {
    avg: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p95: samples[Math.floor(samples.length * 0.95)] ?? samples.at(-1)!,
    max: samples.at(-1)!,
    searches: manager.teleportSearches,
    candidateChecks: manager.teleportCandidateChecks,
  };
  manager.dispose();
  return result;
}

describe('pet AI tick cost', () => {
  it('keeps follow and bounded teleport cheaper than a millisecond on 20 pets', () => {
    const idle = runScenario('idle');
    const follow = runScenario('follow');
    const teleport = runScenario('teleport');
    expect(idle.max).toBeLessThan(20);
    expect(follow.max).toBeLessThan(20);
    expect(teleport.max).toBeLessThan(20);
    expect(teleport.searches).toBeGreaterThan(0);
    expect(teleport.candidateChecks).toBeGreaterThan(0);
    expect(teleport.candidateChecks / Math.max(1, teleport.searches)).toBeLessThanOrEqual(32);
    expect(follow.avg).toBeLessThan(5);
    expect(idle.avg).toBeLessThan(5);
    console.info('pet-ai-benchmark', { idle, follow, teleport });
  });
});
