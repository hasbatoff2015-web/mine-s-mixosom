import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { MAX_SEPARATION_PAIR_CHECKS, MobManager, PET_TELEPORT_DISTANCE } from '../src/entities';
import { Vec3 } from '../src/math/vec3';
import { VoxelWorld } from '../src/world/World';

function stoneWorld(): VoxelWorld {
  const world = new VoxelWorld('pet-perf');
  vi.spyOn(world, 'getBlock').mockImplementation((_x, y) => (y <= 70 ? BlockId.Stone : BlockId.Air));
  return world;
}

function runScenario(
  kind: 'idle' | 'follow' | 'teleport',
  petCount: number,
  ownerCount = petCount,
): {
  avg: number;
  p95: number;
  max: number;
  searches: number;
  candidateChecks: number;
  separationChecks: number;
} {
  const world = stoneWorld();
  const manager = new MobManager(new THREE.Scene(), world, {
    automaticSpawning: false,
    random: () => 0.25,
    maxMobs: 64,
    maxTamedPets: Math.max(80, petCount),
  });
  const owners = Array.from({ length: ownerCount }, (_, index) => ({
    id: `owner-${index}`,
    position: new Vec3(index * 3 + 0.5, 71, kind === 'teleport' ? PET_TELEPORT_DISTANCE + 8 : kind === 'follow' ? 9 : 1),
    eyePosition: new Vec3(index * 3 + 0.5, 72.62, kind === 'teleport' ? PET_TELEPORT_DISTANCE + 8 : 1),
    alive: true,
    targetable: true,
  }));
  for (let index = 0; index < petCount; index += 1) {
    const owner = owners[index % owners.length]!;
    manager.spawn(index % 2 === 0 ? 'wolf' : 'cat', new Vec3((index % ownerCount) * 3 + 0.5, 71, 0.5), {
      force: true,
      ownerId: owner.id,
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
    separationChecks: manager.lastSeparationPairChecks,
  };
  manager.dispose();
  return result;
}

describe('pet AI tick cost', () => {
  it('keeps follow and bounded teleport cheaper than a millisecond on 20 pets', () => {
    const idle = runScenario('idle', 20);
    const follow = runScenario('follow', 20);
    const teleport = runScenario('teleport', 20);
    expect(idle.max).toBeLessThan(20);
    expect(follow.max).toBeLessThan(20);
    expect(teleport.max).toBeLessThan(20);
    expect(teleport.searches).toBeGreaterThan(0);
    expect(teleport.candidateChecks).toBeGreaterThan(0);
    expect(teleport.candidateChecks / Math.max(1, teleport.searches)).toBeLessThanOrEqual(32);
    expect(follow.avg).toBeLessThan(5);
    expect(idle.avg).toBeLessThan(5);
    expect(follow.separationChecks).toBeLessThanOrEqual(MAX_SEPARATION_PAIR_CHECKS);
    console.info('pet-ai-benchmark-20', { idle, follow, teleport });
  });

  it('stays bounded at 48 pets and a high-role 8×10 population', () => {
    const mid = runScenario('follow', 48);
    const highIdle = runScenario('idle', 80, 8);
    const highFollow = runScenario('follow', 80, 8);
    const highTeleport = runScenario('teleport', 80, 8);
    expect(mid.avg).toBeLessThan(10);
    expect(mid.max).toBeLessThan(30);
    expect(highFollow.avg).toBeLessThan(15);
    expect(highFollow.max).toBeLessThan(40);
    expect(highIdle.max).toBeLessThan(40);
    expect(highTeleport.searches).toBeGreaterThan(0);
    expect(highTeleport.candidateChecks / Math.max(1, highTeleport.searches)).toBeLessThanOrEqual(32);
    expect(highFollow.separationChecks).toBeLessThanOrEqual(MAX_SEPARATION_PAIR_CHECKS);
    console.info('pet-ai-benchmark-high', { mid, highIdle, highFollow, highTeleport });
  });
});
