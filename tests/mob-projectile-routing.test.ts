import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../src/core/constants';
import { HeadlessEntityHost } from '../src/entities/EntityHost';
import {
  LOCAL_PLAYER_FOCUS_ID,
  MobManager,
  nearestMobProjectilePlayerHit,
  skeletonArrowMuzzle,
  type MobPlayerDamageEvent,
  type MobPlayerFocus,
} from '../src/entities/MobManager';
import { Vec3 } from '../src/math/vec3';
import { VoxelWorld } from '../src/world/World';

function focus(id: string, x: number, y: number, z: number, targetable = true): MobPlayerFocus {
  return {
    id,
    position: new Vec3(x, y, z),
    eyePosition: new Vec3(x, y + 1.62, z),
    alive: true,
    targetable,
  };
}

function emptyWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) chunk.set(x, 39, z, BlockId.Stone);
  }
  return world;
}

function runSkeletonShot(
  seed: string,
  targetZ: number,
  wallZ?: number,
): { events: MobPlayerDamageEvent[]; manager: MobManager; blockHits: number[] } {
  const world = emptyWorld(seed);
  const events: MobPlayerDamageEvent[] = [];
  const blockHits: number[] = [];
  const manager = new MobManager(new HeadlessEntityHost(), world, {
    automaticSpawning: false,
    random: () => 0.5,
    onPlayerDamage: (event) => events.push(event),
    onArrowBlockHit: (_x, _y, z) => blockHits.push(z),
  });
  manager.spawn('skeleton', new Vec3(8, 40, 8), { force: true });
  const players = [
    focus('far-first', 13, 40, 13),
    focus('actual-target', 7.7, 40, targetZ),
  ];
  manager.update(0.05, { players, daylight: 0.2 });
  if (wallZ !== undefined) {
    const chunk = world.getChunk(0, 0)!;
    chunk.set(7, 40, wallZ, BlockId.Stone);
    chunk.set(7, 41, wallZ, BlockId.Stone);
  }
  for (let tick = 1; tick < 4; tick += 1) manager.update(0.05, { players, daylight: 0.2 });
  return { events, manager, blockHits };
}

describe('mob projectile player routing', () => {
  it('sweeps the canonical player dimensions and picks the nearest hit independent of array order', () => {
    expect(PLAYER_WIDTH).toBe(0.6);
    expect(PLAYER_HEIGHT).toBe(1.8);
    const from = new Vec3(0, 1, 0);
    const to = new Vec3(0, 1, 30);
    const players = Array.from({ length: 24 }, (_, index) => focus(`player-${index}`, 0, 0, 28 - index));
    const hit = nearestMobProjectilePlayerHit(from, to, players);
    expect(hit?.focus.id).toBe('player-23');
    expect(hit?.distance).toBeCloseTo(4.7, 6);
  });

  it('does not tunnel through a target crossed by one high-speed segment', () => {
    const hit = nearestMobProjectilePlayerHit(
      new Vec3(-20, 0.9, 0),
      new Vec3(20, 0.9, 0),
      [focus('runner', 0, 0, 0)],
    );
    expect(hit?.focus.id).toBe('runner');
    expect(hit?.distance).toBeCloseTo(20 - PLAYER_WIDTH / 2, 6);
  });

  it('ignores dead/non-targetable foci and emits the exact nearest target id once', () => {
    const { events, manager } = runSkeletonShot('mob-projectile-exact-target', 5.5);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetPlayerId: 'actual-target', source: 'arrow', mobKind: 'skeleton' });
    expect(manager.projectileCount).toBe(0);
    manager.dispose();

    const hidden = { ...focus('hidden', 0, 0, 2), targetable: false };
    const dead = { ...focus('dead', 0, 0, 1), alive: false };
    expect(nearestMobProjectilePlayerHit(new Vec3(0, 1, 0), new Vec3(0, 1, 4), [hidden, dead])).toBeUndefined();
  });

  it('lets the nearer player beat a wall later in the same swept segment', () => {
    const { events, manager, blockHits } = runSkeletonShot('mob-projectile-player-before-wall', 5.5, 4);
    expect(events).toHaveLength(1);
    expect(events[0]?.targetPlayerId).toBe('actual-target');
    expect(blockHits).toEqual([]);
    expect(manager.projectileCount).toBe(0);
    manager.dispose();
  });

  it('lets the nearer wall win and never emits player damage behind it', () => {
    const { events, manager, blockHits } = runSkeletonShot('mob-projectile-wall-before-player', 4.5, 6);
    expect(events).toEqual([]);
    expect(blockHits.length).toBeGreaterThan(0);
    expect(blockHits.every((z) => z === 6)).toBe(true);
    expect(manager.projectileCount).toBe(1);
    manager.dispose();
  });

  it('preserves the singleplayer context through a stable synthetic target id', () => {
    const world = emptyWorld('mob-projectile-singleplayer');
    const manager = new MobManager(new HeadlessEntityHost(), world, { automaticSpawning: false, random: () => 0.5 });
    manager.spawn('zombie', new Vec3(8, 40, 8), { force: true });
    manager.update(0.05, { playerPosition: new Vec3(8, 40, 9), daylight: 0.2 });
    expect(manager.consumePlayerDamage()[0]?.targetPlayerId).toBe(LOCAL_PLAYER_FOCUS_ID);
    manager.dispose();
  });

  it('spawns from the deterministic simulation bow hand instead of the head centre', () => {
    const owner = new Vec3(8, 40, 8);
    expect(skeletonArrowMuzzle(owner, 0)).toEqual(new Vec3(7.7, 41.36, 7.82));
    expect(skeletonArrowMuzzle(owner, Math.PI / 2).x).toBeCloseTo(7.82, 8);
    expect(skeletonArrowMuzzle(owner, Math.PI / 2).z).toBeCloseTo(8.3, 8);
  });
});
