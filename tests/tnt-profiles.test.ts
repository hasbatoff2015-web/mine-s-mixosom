import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition, isTntBlock, tntTextureKey } from '../src/blocks';
import { flamingArrowBlockHit } from '../src/combat/fireArrow';
import { PRIMED_TNT_TEXTURE_KEY, RedstoneSystem } from '../src/redstone';
import { createThreeEntityHost } from '../src/entities/ThreeEntityHost';
import {
  DESTRUCTIVE_TNT_PROFILE,
  ORDINARY_TNT_PROFILE,
  ORDINARY_TNT_RADIUS,
  POWERFUL_TNT_PROFILE,
  POWERFUL_TNT_RADIUS,
  getTntProfile,
} from '../src/world/tnt';
import { resolveExplosion } from '../src/world/Explosion';
import { VoxelWorld } from '../src/world/World';

const alwaysBreak = (): number => 1;

function jobAt(
  x: number,
  y: number,
  z: number,
  blockId: BlockId,
  extra: { canDestroy?: (cx: number, cy: number, cz: number) => boolean } = {},
) {
  const profile = getTntProfile(blockId);
  return {
    x: x + 0.5,
    y: y + 0.5,
    z: z + 0.5,
    radius: profile.radius,
    power: profile.power,
    profile,
    ...extra,
  };
}

function prepare(world: VoxelWorld, x: number, z: number): void {
  world.getChunk(Math.floor(x / 16), Math.floor(z / 16));
}

describe('TNT explosion profiles', () => {
  it('keeps ordinary radius 4, powerful ~6, destructive equal to ordinary', () => {
    expect(ORDINARY_TNT_PROFILE.radius).toBe(ORDINARY_TNT_RADIUS);
    expect(ORDINARY_TNT_RADIUS).toBe(4);
    expect(POWERFUL_TNT_PROFILE.radius).toBe(POWERFUL_TNT_RADIUS);
    expect(POWERFUL_TNT_RADIUS).toBe(6);
    expect(DESTRUCTIVE_TNT_PROFILE.radius).toBe(ORDINARY_TNT_RADIUS);
    expect(getTntProfile(BlockId.Tnt).canBreakBlockClaims).toBe(false);
    expect(getTntProfile(BlockId.TntPowerful).canBreakBlockClaims).toBe(true);
    expect(getTntProfile(BlockId.TntDestructive).canBreakObsidian).toBe(true);
  });

  it('lets powerful TNT reach about 6 blocks while ordinary and destructive stop at 4', () => {
    const world = new VoxelWorld('tnt-radius');
    const y = 40;
    for (let x = 0; x <= 20; x += 1) prepare(world, x, 4);
    world.setBlock(4, y, 4, BlockId.Dirt);
    world.setBlock(8, y, 4, BlockId.Dirt);
    world.setBlock(10, y, 4, BlockId.Dirt);
    const ordinary = resolveExplosion(world, jobAt(4, y, 4, BlockId.Tnt), { random: alwaysBreak });
    const powerful = resolveExplosion(world, jobAt(4, y, 4, BlockId.TntPowerful), { random: alwaysBreak });
    const destructive = resolveExplosion(world, jobAt(4, y, 4, BlockId.TntDestructive), { random: alwaysBreak });
    const destroyed = (result: typeof ordinary, x: number) =>
      result.destroyed.some((entry) => entry.x === x && entry.y === y && entry.z === 4);
    expect(destroyed(ordinary, 8)).toBe(true);
    expect(destroyed(ordinary, 10)).toBe(false);
    expect(destroyed(destructive, 8)).toBe(true);
    expect(destroyed(destructive, 10)).toBe(false);
    expect(destroyed(powerful, 10)).toBe(true);
  });

  it('uses obsidian as a local blast shield for ordinary and powerful TNT only', () => {
    const world = new VoxelWorld('tnt-obsidian');
    const y = 40;
    prepare(world, 4, 4);
    prepare(world, 8, 4);
    for (let wallY = y - 1; wallY <= y + 1; wallY += 1) {
      for (let wallZ = 3; wallZ <= 5; wallZ += 1) {
        world.setBlock(6, wallY, wallZ, BlockId.Obsidian);
      }
    }
    world.setBlock(8, y, 4, BlockId.Dirt);
    world.setBlock(4, y, 7, BlockId.Dirt);

    const ordinary = resolveExplosion(world, jobAt(4, y, 4, BlockId.Tnt), { random: alwaysBreak });
    expect(ordinary.destroyed.some((entry) => entry.x === 6 && entry.previous === BlockId.Obsidian)).toBe(false);
    expect(ordinary.destroyed.some((entry) => entry.x === 8 && entry.z === 4)).toBe(false);
    expect(ordinary.destroyed.some((entry) => entry.x === 4 && entry.z === 7)).toBe(true);

    const powerful = resolveExplosion(world, jobAt(4, y, 4, BlockId.TntPowerful), { random: alwaysBreak });
    expect(powerful.destroyed.some((entry) => entry.previous === BlockId.Obsidian)).toBe(false);
    expect(powerful.destroyed.some((entry) => entry.x === 8 && entry.z === 4)).toBe(false);
    expect(powerful.destroyed.some((entry) => entry.x === 4 && entry.z === 7)).toBe(true);

    const destructive = resolveExplosion(world, jobAt(4, y, 4, BlockId.TntDestructive), { random: alwaysBreak });
    expect(destructive.destroyed.some((entry) => entry.x === 6 && entry.y === y && entry.z === 4 && entry.previous === BlockId.Obsidian)).toBe(true);
    expect(destructive.destroyed.some((entry) => entry.x === 8 && entry.z === 4 && entry.previous === BlockId.Dirt)).toBe(true);
  });

  it('skips iron/gold/diamond anchors for ordinary TNT and breaks them for the other types', () => {
    const world = new VoxelWorld('tnt-anchors');
    const y = 40;
    prepare(world, 4, 4);
    const anchors = [BlockId.IronBlock, BlockId.GoldBlock, BlockId.DiamondBlock] as const;
    for (const anchor of anchors) {
      world.setBlock(5, y, 4, anchor);
      const ordinary = resolveExplosion(world, jobAt(4, y, 4, BlockId.Tnt), { random: alwaysBreak });
      expect(ordinary.destroyed.some((entry) => entry.previous === anchor)).toBe(false);
      world.setBlock(5, y, 4, anchor);
      const powerful = resolveExplosion(world, jobAt(4, y, 4, BlockId.TntPowerful), { random: alwaysBreak });
      expect(powerful.destroyed.some((entry) => entry.previous === anchor)).toBe(true);
      world.setBlock(5, y, 4, anchor);
      const destructive = resolveExplosion(world, jobAt(4, y, 4, BlockId.TntDestructive), { random: alwaysBreak });
      expect(destructive.destroyed.some((entry) => entry.previous === anchor)).toBe(true);
    }
  });

  it('honors canDestroy so regular /claim volumes survive every TNT type', () => {
    const world = new VoxelWorld('tnt-regular-claim');
    const y = 40;
    prepare(world, 4, 4);
    world.setBlock(5, y, 4, BlockId.Dirt);
    world.setBlock(4, y, 5, BlockId.Dirt);
    const canDestroy = (x: number, _y: number, z: number) => !(x === 5 && z === 4);
    for (const blockId of [BlockId.Tnt, BlockId.TntPowerful, BlockId.TntDestructive]) {
      world.setBlock(5, y, 4, BlockId.Dirt);
      world.setBlock(4, y, 5, BlockId.Dirt);
      const result = resolveExplosion(world, jobAt(4, y, 4, blockId, { canDestroy }), { random: alwaysBreak });
      expect(result.destroyed.some((entry) => entry.x === 5 && entry.z === 4)).toBe(false);
      expect(result.destroyed.some((entry) => entry.x === 4 && entry.z === 5)).toBe(true);
    }
  });

  it('chains a second TNT type with its own block id', () => {
    const world = new VoxelWorld('tnt-chain');
    const y = 40;
    prepare(world, 4, 4);
    world.setBlock(5, y, 4, BlockId.TntPowerful);
    world.setBlock(4, y, 5, BlockId.TntDestructive);
    const result = resolveExplosion(world, jobAt(4, y, 4, BlockId.Tnt), { random: alwaysBreak });
    expect(result.chainedTnt.map((entry) => entry.blockId).sort()).toEqual(
      [BlockId.TntDestructive, BlockId.TntPowerful].sort(),
    );
    const powerful = getTntProfile(result.chainedTnt.find((entry) => entry.blockId === BlockId.TntPowerful)!.blockId);
    expect(powerful.radius).toBe(6);
    expect(powerful.canBreakBlockClaims).toBe(true);
  });

  it('wires new TNT blocks to the existing primed mesh and fuse pulse, changing only the texture key', () => {
    const world = new VoxelWorld('tnt-visual');
    const scene = new THREE.Scene();
    const host = createThreeEntityHost(scene);
    const redstone = new RedstoneSystem(world, { host });
    prepare(world, 4, 4);
    const names: string[] = [];
    let sharedGeometry: THREE.BufferGeometry | undefined;
    for (const blockId of [BlockId.Tnt, BlockId.TntPowerful, BlockId.TntDestructive]) {
      world.setBlock(4, 70, 4, blockId);
      const primed = redstone.primeTnt(4, 70, 4);
      expect(primed).toBeDefined();
      const mesh = primed!.visual as THREE.Mesh;
      sharedGeometry ??= mesh.geometry;
      expect(mesh.geometry).toBe(sharedGeometry);
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.map?.name).toBe(tntTextureKey(blockId));
      names.push(material.map!.name);
      host.pulsePrimedTnt(mesh, 0.4, 0.5);
      expect(mesh.rotation.y).toBeCloseTo(0.3);
      redstone.syncNetworkPrimed([]);
    }
    expect(names).toEqual([
      PRIMED_TNT_TEXTURE_KEY,
      'block/tnt_powerful',
      'block/tnt_destructive',
    ]);
    expect(getBlockDefinition(BlockId.TntPowerful).textures.all).toBe('block/tnt_powerful');
    expect(isTntBlock(BlockId.TntDestructive)).toBe(true);
    expect(flamingArrowBlockHit(BlockId.TntPowerful)).toBe('prime_tnt');
    expect(flamingArrowBlockHit(BlockId.TntDestructive)).toBe('prime_tnt');
    redstone.dispose();
  });
});
