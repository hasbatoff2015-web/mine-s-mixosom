import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { HeadlessEntityHost } from '../src/entities/EntityHost';
import { DroppedItemManager } from '../src/entities/DroppedItemManager';
import { FallingBlockManager } from '../src/entities/FallingBlockManager';
import { MinecartManager } from '../src/entities/MinecartManager';
import {
  MOB_DEATH_ANIMATION_SECONDS,
  MOB_HURT_FLASH_SECONDS,
  MobManager,
  mobDeathVisualSeconds,
  type MobEntity,
} from '../src/entities/MobManager';
import {
  applyEntitySnapshots,
  applyInterpolatedEntityVisuals,
  applyNetworkEntityEvents,
} from '../src/net/applyEntitySnapshots';
import { EntityInterpolationBuffer } from '../src/net/entitySnapshotInterpolation';
import { RedstoneSystem } from '../src/redstone';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { VoxelWorld } from '../src/world/World';

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.();
});

function sessionOf(world: VoxelWorld, host?: HeadlessEntityHost) {
  const sceneOrHost = host ?? new THREE.Scene();
  const visuals = host ? undefined : new ItemVisualFactory();
  const mobs = new MobManager(sceneOrHost, world, { automaticSpawning: false });
  cleanup.push(() => mobs.dispose());
  return {
    drops: new DroppedItemManager(sceneOrHost, world, visuals ? { visualFactory: visuals } : undefined),
    falling: new FallingBlockManager(sceneOrHost, world, visuals),
    mobs,
    arrows: new PlayerArrowManager(sceneOrHost, world, mobs),
    minecarts: new MinecartManager(sceneOrHost, world, visuals),
    redstone: new RedstoneSystem(world, host ? undefined : { root: sceneOrHost as THREE.Scene }),
  };
}

function spawnDyingZombie(mobs: MobManager, id: string): MobEntity {
  const mob = mobs.spawn('zombie', new THREE.Vector3(2, 64, 2), { force: true, id })!;
  expect(mob).toBeDefined();
  mobs.applyAuthoritativeDeath(id);
  return mob;
}

describe('mobDeathVisualSeconds', () => {
  it('uses render elapsed when the visual clock is active', () => {
    expect(mobDeathVisualSeconds(0.05, 1, 0.123)).toBeCloseTo(0.123, 6);
  });

  it('interpolates 20 TPS deathSeconds when render elapsed is absent', () => {
    expect(mobDeathVisualSeconds(0.1, 1)).toBeCloseTo(0.1, 6);
    expect(mobDeathVisualSeconds(0.1, 0)).toBeCloseTo(0.05, 6);
    expect(mobDeathVisualSeconds(0.1, 0.5)).toBeCloseTo(0.075, 6);
  });
});

describe('entity death animation smoothness', () => {
  it('starts the visual death clock once on the first death event (headless, no WebGL pose)', () => {
    const world = new VoxelWorld('death-start');
    const mobs = new MobManager(new HeadlessEntityHost(), world, { automaticSpawning: false });
    cleanup.push(() => mobs.dispose());
    const mob = spawnDyingZombie(mobs, 'z-start');

    expect(mob.deathVisualActive).toBe(false);
    expect(mob.deathVisualElapsed).toBe(0);

    mobs.advanceDeathVisuals(1 / 60);
    expect(mob.deathVisualActive).toBe(true);
    expect(mob.deathVisualElapsed).toBeGreaterThan(0);
    expect(mob.deathVisualElapsed).toBeLessThan(0.05);

    const first = mob.deathVisualElapsed;
    mobs.advanceDeathVisuals(1 / 60);
    expect(mob.deathVisualElapsed).toBeCloseTo(first + 1 / 60, 6);
  });

  it('does not restart the visual clock on repeated dead snapshots or death events', () => {
    const world = new VoxelWorld('death-once');
    const session = sessionOf(world, new HeadlessEntityHost());
    const mob = spawnDyingZombie(session.mobs, 'z-once');
    session.mobs.advanceDeathVisuals(0.1);
    const elapsedAfterStart = mob.deathVisualElapsed;
    expect(elapsedAfterStart).toBeGreaterThan(0.09);

    applyNetworkEntityEvents(session, [{ entityId: 'z-once', kind: 'death' }]);
    applyEntitySnapshots(session, [{
      id: 'z-once',
      kind: 'mob',
      mobKind: 'zombie',
      x: 2,
      y: 64,
      z: 2,
      yaw: 1.2,
      health: 0,
      state: 'die',
    }], { tick: 2, now: 1_050 });
    applyEntitySnapshots(session, [{
      id: 'z-once',
      kind: 'mob',
      mobKind: 'zombie',
      x: 2.1,
      y: 64,
      z: 2.1,
      yaw: 1.4,
      health: 0,
      state: 'die',
    }], { tick: 3, now: 1_100 });

    expect(mob.state).toBe('die');
    expect(mob.deathSeconds).toBe(0);
    expect(mob.deathVisualElapsed).toBeCloseTo(elapsedAfterStart, 6);
    expect(mob.deathVisualActive).toBe(true);

    session.mobs.advanceDeathVisuals(0.05);
    expect(mob.deathVisualElapsed).toBeCloseTo(elapsedAfterStart + 0.05, 5);
  });

  it('progresses independently of server snapshot rate using render delta', () => {
    const world = new VoxelWorld('death-smooth');
    const mobs = new MobManager(new HeadlessEntityHost(), world, { automaticSpawning: false });
    cleanup.push(() => mobs.dispose());
    const mob = spawnDyingZombie(mobs, 'z-smooth');

    let visual = 0;
    for (let i = 0; i < 42; i += 1) {
      visual += 1 / 60;
      mobs.advanceDeathVisuals(1 / 60);
    }
    expect(mob.deathVisualElapsed).toBeCloseTo(visual, 3);
    expect(mob.deathSeconds).toBe(0);

    for (let i = 0; i < 4; i += 1) mobs.tickRemoteVisuals(0.05);
    expect(mob.deathSeconds).toBeCloseTo(0.2, 6);
    expect(mob.deathVisualElapsed).toBeCloseTo(visual, 3);
  });

  it('does not let interpolated yaw/position overwrite death rotation.z / scale', () => {
    const world = new VoxelWorld('death-pose');
    const session = sessionOf(world);
    const interpolator = new EntityInterpolationBuffer();
    interpolator.ingest('z-pose', { x: 4, y: 64, z: 1, yaw: 0.8 }, 1, 1_000);
    interpolator.ingest('z-pose', { x: 5, y: 64, z: 2, yaw: 1.2 }, 2, 1_050);

    const mob = spawnDyingZombie(session.mobs, 'z-pose');
    for (let i = 0; i < 7; i += 1) session.mobs.advanceDeathVisuals(0.05);
    applyInterpolatedEntityVisuals(session, interpolator, 1_050 + 80);

    expect(mob.visual).toBeDefined();
    expect(mob.deathVisualElapsed).toBeCloseTo(0.35, 5);
    const progress = 0.35 / MOB_DEATH_ANIMATION_SECONDS;
    expect(mob.visual!.rotation.y).toBeCloseTo(1.2, 3);
    expect(mob.visual!.rotation.z).toBeCloseTo(progress * Math.PI * 0.5, 4);
    expect(mob.visual!.scale.x).toBeCloseTo(1 - progress * 0.25, 4);
    expect(mob.visual!.position.x).toBeCloseTo(5, 3);
    expect(mob.visual!.position.z).toBeCloseTo(2, 3);
  });

  it('samples more than 20 TPS poses when the render clock advances every frame', () => {
    const world = new VoxelWorld('death-frames');
    const session = sessionOf(world);
    const mob = spawnDyingZombie(session.mobs, 'z-frames');
    const poses = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      session.mobs.advanceDeathVisuals(1 / 60);
      session.mobs.interpolateVisuals(1);
      poses.add(mob.visual!.rotation.z.toFixed(5));
    }
    expect(poses.size).toBeGreaterThan(20);
  });

  it('keeps death visual state strictly per entityId', () => {
    const world = new VoxelWorld('death-isolate');
    const mobs = new MobManager(new HeadlessEntityHost(), world, { automaticSpawning: false });
    cleanup.push(() => mobs.dispose());
    spawnDyingZombie(mobs, 'z-a');
    const living = mobs.spawn('zombie', new THREE.Vector3(8, 64, 8), { force: true, id: 'z-b' })!;

    mobs.advanceDeathVisuals(0.2);
    const dead = mobs.get('z-a')!;
    expect(dead.deathVisualActive).toBe(true);
    expect(dead.deathVisualElapsed).toBeCloseTo(0.2, 4);
    expect(living.state).toBe('idle');
    expect(living.deathVisualActive).toBe(false);
    expect(living.deathVisualElapsed).toBe(0);
  });

  it('clears death visual state on removal and starts fresh for a new entity id', () => {
    const world = new VoxelWorld('death-remove');
    const mobs = new MobManager(new HeadlessEntityHost(), world, { automaticSpawning: false });
    cleanup.push(() => mobs.dispose());
    spawnDyingZombie(mobs, 'z-old');
    for (let i = 0; i < 8; i += 1) mobs.advanceDeathVisuals(0.05);
    expect(mobs.get('z-old')!.deathVisualElapsed).toBeGreaterThan(0.3);

    mobs.remove('z-old');
    expect(mobs.get('z-old')).toBeUndefined();
    expect(mobs.count).toBe(0);

    const next = spawnDyingZombie(mobs, 'z-new');
    expect(next.deathVisualActive).toBe(false);
    expect(next.deathVisualElapsed).toBe(0);
    mobs.advanceDeathVisuals(1 / 60);
    expect(next.deathVisualElapsed).toBeLessThan(0.05);
    expect(next.deathVisualElapsed).toBeGreaterThan(0);
  });

  it('keeps per-entity hurt flash after the death visual clock is added', () => {
    const world = new VoxelWorld('death-hurt');
    const session = sessionOf(world);
    applyEntitySnapshots(session, [
      { id: 'hurt-a', kind: 'mob', mobKind: 'zombie', x: 5.5, y: 41, z: 5.5, hurt: false, health: 20 },
      { id: 'hurt-b', kind: 'mob', mobKind: 'zombie', x: 8.5, y: 41, z: 5.5, hurt: false, health: 20 },
    ], { tick: 1, now: 1_000 });
    applyEntitySnapshots(session, [
      { id: 'hurt-a', kind: 'mob', mobKind: 'zombie', x: 5.5, y: 41, z: 5.5, hurt: true, health: 12 },
      { id: 'hurt-b', kind: 'mob', mobKind: 'zombie', x: 8.5, y: 41, z: 5.5, hurt: false, health: 20 },
    ], { tick: 2, now: 1_050 });

    expect(session.mobs.get('hurt-a')?.hurtFlashSeconds).toBe(MOB_HURT_FLASH_SECONDS);
    expect(session.mobs.get('hurt-b')?.hurtFlashSeconds).toBe(0);
  });

  it('still uses tick deathSeconds for tests that never call advanceDeathVisuals', () => {
    const world = new VoxelWorld('death-fallback');
    const session = sessionOf(world);
    const mob = session.mobs.spawn('creeper', new THREE.Vector3(0, 72, 2), { force: true })!;
    expect(session.mobs.damage(mob, 40)).toBe(true);
    for (let i = 0; i < 7; i += 1) session.mobs.update(0.05);
    session.mobs.interpolateVisuals(1);
    const progress = 0.35 / MOB_DEATH_ANIMATION_SECONDS;
    expect(mob.visual!.rotation.z).toBeCloseTo(progress * Math.PI * 0.5, 4);
    expect(mob.visual!.scale.x).toBeCloseTo(1 - progress * 0.25, 4);
  });
});
