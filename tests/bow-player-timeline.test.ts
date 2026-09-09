import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { HeadlessEntityHost, type MobManager } from '../src/entities';
import { Vec3 } from '../src/math/vec3';
import type { PlayerAABB } from '../src/player';
import type { VoxelWorld } from '../src/world/World';

const emptyWorld = {
  raycast: () => undefined,
  getBlock: () => BlockId.Air,
} as unknown as VoxelWorld;

const noMobs = { raycast: () => undefined } as unknown as MobManager;

function box(x: number, z = 0): PlayerAABB {
  return { minX: x - 0.3, maxX: x + 0.3, minY: 0, maxY: 2, minZ: z - 0.3, maxZ: z + 0.3 };
}

describe('arrow historical player timeline', () => {
  it('misses the current AABB but hits the authoritative historical AABB', () => {
    const current = box(10);
    const hits: string[] = [];
    const uncompensated = new PlayerArrowManager(new HeadlessEntityHost(), emptyWorld, noMobs, { random: () => 0.5 });
    uncompensated.spawn(new Vec3(0, 1, 0), new Vec3(1, 0, 0), 3, 0, false, false, undefined, 'owner', 0);
    uncompensated.tick(0.05, { players: [{ id: 'target', aabb: current }], onPlayerHit: (id) => hits.push(id) });
    expect(hits).toEqual([]);
    expect(uncompensated.count).toBe(1);

    const compensated = new PlayerArrowManager(new HeadlessEntityHost(), emptyWorld, noMobs, { random: () => 0.5 });
    compensated.spawn(
      new Vec3(0, 1, 0), new Vec3(1, 0, 0), 3, 0, false, false, undefined, 'owner', 0, 10,
    );
    compensated.tick(0.05, {
      players: [{ id: 'target', aabb: current }],
      resolvePlayerAabb: (_id, tick) => tick === 10 ? box(2) : undefined,
      onPlayerHit: (id) => hits.push(id),
    });
    expect(hits).toEqual(['target']);
    expect(compensated.count).toBe(0);
  });

  it('registers a lead shot without a release-time target hint', () => {
    const manager = new PlayerArrowManager(new HeadlessEntityHost(), emptyWorld, noMobs, { random: () => 0.5 });
    const hits: string[] = [];
    manager.spawn(
      new Vec3(0, 1, 0), new Vec3(1, 0, 0), 1, 0, false, false, undefined, 'owner', 0, 20,
    );
    const options = {
      players: [{ id: 'runner', aabb: box(20) }],
      resolvePlayerAabb: (_id: string, tick: number) => tick === 20 ? box(2, 2) : box(2, 0),
      onPlayerHit: (id: string) => hits.push(id),
    };
    manager.tick(0.05, options);
    expect(hits).toEqual([]);
    manager.tick(0.05, options);
    expect(hits).toEqual(['runner']);
  });

  it('uses the same step kernel for catch-up and excludes the owner', () => {
    const manager = new PlayerArrowManager(new HeadlessEntityHost(), emptyWorld, noMobs, { random: () => 0.5 });
    const hits: string[] = [];
    const id = manager.spawn(
      new Vec3(0, 1, 0), new Vec3(1, 0, 0), 1, 0, false, false, undefined, 'owner', 0, 30,
    );
    manager.catchUp(id, 2, {
      players: [{ id: 'owner', aabb: box(0) }, { id: 'target', aabb: box(2) }],
      resolvePlayerAabb: (playerId) => playerId === 'owner' ? box(0) : box(2),
      onPlayerHit: (playerId) => hits.push(playerId),
    });
    expect(hits).toEqual(['target']);
    expect(manager.count).toBe(0);
  });
});
