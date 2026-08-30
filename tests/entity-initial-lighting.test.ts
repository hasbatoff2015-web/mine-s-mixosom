import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { BlockId } from '../src/blocks';
import { CHUNK_SIZE, WORLD_LIGHT_BUDGET_MS, floorDiv, positiveMod } from '../src/core/constants';
import {
  DroppedItemManager,
  FallingBlockManager,
  MinecartManager,
  MobManager,
} from '../src/entities';
import { createItemStack } from '../src/inventory';
import { applyEntitySnapshots, applyInterpolatedEntityVisuals } from '../src/net/applyEntitySnapshots';
import { EntityInterpolationBuffer } from '../src/net/entitySnapshotInterpolation';
import { daylightFactor } from '../src/gameplay/daylight';
import { setWorldDaylight } from '../src/rendering/worldLighting';
import { RedstoneSystem } from '../src/redstone';
import { recomputeChunkSky, seedChunkBlockLight } from '../src/world/LightEngine';
import { VoxelWorld } from '../src/world/World';

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function unlitSurface(world: VoxelWorld): void {
  world.deferredLighting = true;
  const chunk = world.getChunk(0, 0)!;
  chunk.blocks.fill(BlockId.Air);
  for (let x = 4; x <= 10; x += 1) {
    for (let z = 4; z <= 10; z += 1) writeBlock(world, x, 40, z, BlockId.GrassBlock);
  }
}

function lightSurface(world: VoxelWorld): void {
  const chunk = world.getChunk(0, 0)!;
  recomputeChunkSky(world, chunk);
  seedChunkBlockLight(world, chunk);
}

function luminance(light: THREE.Vector3 | undefined): number {
  if (!(light instanceof THREE.Vector3)) return 0;
  return (light.x + light.y + light.z) / 3;
}

function entityLight(visual: THREE.Object3D | undefined): THREE.Vector3 | undefined {
  return visual?.userData.entityLight as THREE.Vector3 | undefined;
}

describe('initial entity lighting (online join vs hurt vs dynamic spawn)', () => {
  afterEach(() => {
    setWorldDaylight(1);
  });

  it('does not raise the playing light budget', () => {
    expect(WORLD_LIGHT_BUDGET_MS).toBe(2);
  });

  it('refreshes join-time mob light after the chunk lights, without a hurt event', () => {
    const world = new VoxelWorld('initial-mob-unlit');
    unlitSurface(world);
    const mobs = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const mob = mobs.spawn('cow', new THREE.Vector3(6.5, 41, 6.5), { force: true, id: 'join-cow' })!;
    expect(mob.hurtFlashSeconds).toBe(0);
    expect(luminance(entityLight(mob.visual))).toBeLessThan(0.25);

    lightSurface(world);
    expect(mob.hurtFlashSeconds).toBe(0);
    mobs.interpolateVisuals(1);

    expect(mob.hurtFlashSeconds).toBe(0);
    expect(luminance(entityLight(mob.visual))).toBeGreaterThan(0.7);
    mobs.dispose();
  });

  it('lights a dynamically spawned mob immediately once the world is already lit', () => {
    const world = new VoxelWorld('dynamic-mob-lit');
    unlitSurface(world);
    lightSurface(world);
    const mobs = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const mob = mobs.spawn('zombie', new THREE.Vector3(7.5, 41, 7.5), { force: true })!;
    expect(mob.hurtFlashSeconds).toBe(0);
    expect(luminance(entityLight(mob.visual))).toBeGreaterThan(0.7);
    mobs.dispose();
  });

  it('already has correct light before a later hurt flash', () => {
    const world = new VoxelWorld('hurt-not-required');
    unlitSurface(world);
    const mobs = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const mob = mobs.spawn('pig', new THREE.Vector3(6.5, 41, 6.5), { force: true })!;
    lightSurface(world);
    mobs.interpolateVisuals(1);
    const beforeHurt = luminance(entityLight(mob.visual));
    expect(beforeHurt).toBeGreaterThan(0.7);
    expect(mob.hurtFlashSeconds).toBe(0);

    mobs.applyAuthoritativeHurt(mob.id);
    expect(mob.hurtFlashSeconds).toBeGreaterThan(0);
    mobs.interpolateVisuals(1);
    expect(luminance(entityLight(mob.visual))).toBeGreaterThan(0.5);
    mobs.dispose();
  });

  it('applies day and night compose without waiting for hurt', () => {
    const world = new VoxelWorld('initial-mob-night');
    unlitSurface(world);
    const mobs = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const mob = mobs.spawn('chicken', new THREE.Vector3(6.5, 41, 6.5), { force: true })!;
    lightSurface(world);

    setWorldDaylight(1);
    mobs.interpolateVisuals(1);
    const day = luminance(entityLight(mob.visual));

    setWorldDaylight(daylightFactor(18_000));
    mobs.interpolateVisuals(1);
    const night = luminance(entityLight(mob.visual));

    expect(mob.hurtFlashSeconds).toBe(0);
    expect(day).toBeGreaterThan(0.7);
    expect(night).toBeGreaterThan(0.08);
    expect(night).toBeLessThan(day * 0.5);
    mobs.dispose();
  });

  it('applies the same refresh through entity_snapshot restore + interpolate', () => {
    const world = new VoxelWorld('snapshot-join-mob');
    unlitSurface(world);
    const scene = new THREE.Scene();
    const mobs = new MobManager(scene, world, { automaticSpawning: false });
    const session = {
      drops: new DroppedItemManager(scene, world),
      falling: new FallingBlockManager(scene, world),
      mobs,
      arrows: new PlayerArrowManager(scene, world, mobs),
      minecarts: new MinecartManager(scene, world),
      redstone: new RedstoneSystem(world),
    };
    const interpolator = new EntityInterpolationBuffer();
    applyEntitySnapshots(session, [{
      id: 'net-cow',
      kind: 'mob',
      x: 6.5, y: 41, z: 6.5,
      vx: 0, vy: 0, vz: 0,
      mobKind: 'cow',
      health: 10,
    }], { interpolator, tick: 1, now: 1_000 });
    const mob = mobs.get('net-cow')!;
    expect(luminance(entityLight(mob.visual))).toBeLessThan(0.25);

    lightSurface(world);
    applyInterpolatedEntityVisuals(session, interpolator, 1_080);
    expect(mob.hurtFlashSeconds).toBe(0);
    expect(luminance(entityLight(mob.visual))).toBeGreaterThan(0.7);
    mobs.dispose();
    session.drops.dispose();
    session.falling.dispose();
    session.arrows.dispose();
    session.minecarts.dispose();
    session.redstone.dispose();
  });

  it('refreshes join-time dropped item light on visual sync without a sim tick', () => {
    const world = new VoxelWorld('initial-drop-unlit');
    unlitSurface(world);
    const drops = new DroppedItemManager(new THREE.Scene(), world);
    const item = drops.spawn(createItemStack('dirt', 1), new THREE.Vector3(6.5, 41.2, 6.5), {
      id: 'join-dirt',
      merge: false,
    });
    expect(luminance(entityLight(item.visual))).toBeLessThan(0.25);
    lightSurface(world);
    drops.interpolateVisuals(1);
    expect(luminance(entityLight(item.visual))).toBeGreaterThan(0.7);
    drops.dispose();
  });
});
