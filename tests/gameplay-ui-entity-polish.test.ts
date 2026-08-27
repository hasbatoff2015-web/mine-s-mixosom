import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BlockId,
  HORIZONTAL_OFFSET,
  counterClockwiseFacing,
  oppositeFacing,
  type HorizontalFacing,
  type StairShape,
} from '../src/blocks';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { MobManager } from '../src/entities/MobManager';
import { Inventory } from '../src/inventory';
import { itemIconDescriptor, usesBlockModelIcon } from '../src/items';
import { CHUNK_SIZE, floorDiv, positiveMod } from '../src/core/constants';
import {
  resolveStairShape,
  stairLocalBoxes,
  type LocalBox,
} from '../src/rendering/specialBlockGeometry';
import { SurvivalSystem } from '../src/survival';
import { blockCollisionBoxes } from '../src/world/collision';
import { VoxelWorld } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import uiSource from '../src/ui/GameUI.ts?raw';
import playerSource from '../src/player/PlayerController.ts?raw';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

const FACINGS: readonly HorizontalFacing[] = ['north', 'south', 'east', 'west'];

function writeBlock(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  const chunk = world.getChunk(floorDiv(x, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))!;
  chunk.set(positiveMod(x, CHUNK_SIZE), y, positiveMod(z, CHUNK_SIZE), block);
}

function occupiedUpper(boxes: readonly LocalBox[]): Set<string> {
  const samples: Record<string, readonly [number, number]> = {
    nw: [0.25, 0.25],
    ne: [0.75, 0.25],
    sw: [0.25, 0.75],
    se: [0.75, 0.75],
  };
  const hit = new Set<string>();
  for (const [name, sample] of Object.entries(samples)) {
    if (boxes.some((box) => box.maxY > 0.5 + 1e-9
      && box.minX <= sample[0] && box.maxX >= sample[0]
      && box.minZ <= sample[1] && box.maxZ >= sample[1])) {
      hit.add(name);
    }
  }
  return hit;
}

function clockwiseFacing(facing: HorizontalFacing): HorizontalFacing {
  return oppositeFacing(counterClockwiseFacing(facing));
}

describe('3D inventory block icons', () => {
  it('bakes placeable block models and leaves generated items as sprites', () => {
    expect(usesBlockModelIcon('stone')).toBe(true);
    expect(usesBlockModelIcon('grass_block')).toBe(true);
    expect(usesBlockModelIcon('oak_log')).toBe(true);
    expect(usesBlockModelIcon('furnace')).toBe(true);
    expect(usesBlockModelIcon('oak_stairs')).toBe(true);
    expect(usesBlockModelIcon('oak_slab')).toBe(true);
    expect(usesBlockModelIcon('chest')).toBe(true);
    expect(itemIconDescriptor('stone')).toEqual({ kind: 'special_preview', category: 'generic' });
    expect(itemIconDescriptor('apple').kind).toBe('texture');
    expect(itemIconDescriptor('diamond_sword').kind).toBe('texture');
    expect(itemIconDescriptor('bow').kind).toBe('texture');
    expect(itemIconDescriptor('arrow').kind).toBe('texture');
    expect(itemIconDescriptor('torch').kind).toBe('texture');
    expect(usesBlockModelIcon('apple')).toBe(false);
  });
});

describe('inventory close control', () => {
  it('renders the close button as a stage sibling, not over the inventory tab', () => {
    expect(uiSource).toContain('${this.closeButtonHtml()}');
    expect(uiSource).not.toMatch(/mc-panel[^>]*>\s*<button type="button" class="mc-close"/);
    expect(playerSource.includes('sprintNeedsRelease')).toBe(false);
    expect(playerSource.includes('resetSprintAfterHit')).toBe(false);
  });
});

describe('stair inner/outer occupancy', () => {
  it.each(FACINGS.flatMap((facing) => (
    ['left', 'right'] as const).flatMap((side) => [
      { facing, kind: 'inner', side, shape: `inner_${side}` as StairShape, count: 3 },
      { facing, kind: 'outer', side, shape: `outer_${side}` as StairShape, count: 1 },
    ])
  ))('occupies $count upper quadrants for $facing $shape', ({ facing, shape, count }) => {
    expect(occupiedUpper(stairLocalBoxes(facing, 'bottom', shape)).size).toBe(count);
  });

  it('resolves 16 facing×turn junctions onto matching occupancy, collision and selection', () => {
    for (const facing of FACINGS) {
      const origin = { x: 8, y: 40, z: 8 };
      const cases: Array<{ neighborFacing: HorizontalFacing; offset: readonly [number, number, number]; shape: StairShape }> = [
        { neighborFacing: counterClockwiseFacing(facing), offset: HORIZONTAL_OFFSET[facing], shape: 'outer_left' },
        { neighborFacing: clockwiseFacing(facing), offset: HORIZONTAL_OFFSET[facing], shape: 'outer_right' },
        { neighborFacing: counterClockwiseFacing(facing), offset: HORIZONTAL_OFFSET[oppositeFacing(facing)], shape: 'inner_left' },
        { neighborFacing: clockwiseFacing(facing), offset: HORIZONTAL_OFFSET[oppositeFacing(facing)], shape: 'inner_right' },
      ];
      for (const entry of cases) {
        const world = new VoxelWorld(`stair-${facing}-${entry.shape}`);
        world.getChunk(0, 0)!.blocks.fill(BlockId.Air);
        writeBlock(world, origin.x, origin.y, origin.z, BlockId.OakStairs);
        world.setBlockState(origin.x, origin.y, origin.z, { facing, stairHalf: 'bottom' });
        writeBlock(world, origin.x + entry.offset[0], origin.y, origin.z + entry.offset[2], BlockId.OakStairs);
        world.setBlockState(origin.x + entry.offset[0], origin.y, origin.z + entry.offset[2], {
          facing: entry.neighborFacing, stairHalf: 'bottom',
        });
        expect(resolveStairShape(world, origin.x, origin.y, origin.z, world.getBlockState(origin.x, origin.y, origin.z)), `${facing} ${entry.shape}`).toBe(entry.shape);
        const boxes = stairLocalBoxes(facing, 'bottom', entry.shape);
        const collision = blockCollisionBoxes(world, origin.x, origin.y, origin.z);
        expect(collision).toHaveLength(boxes.length);
        expect(occupiedUpper(boxes).size, `${facing} ${entry.shape}`).toBe(entry.shape.startsWith('inner') ? 3 : 1);
      }
    }
  });
});

describe('projectile vegetation collision', () => {
  function room(): VoxelWorld {
    const world = new VoxelWorld('arrow-vegetation');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    chunk.blocks.fill(BlockId.Air);
    return world;
  }

  it('ignores tall grass, flowers, bushes and fire, then embeds in stone behind them', () => {
    const world = room();
    world.getChunk(0, 0)!.set(8, 40, 6, BlockId.TallGrass);
    world.getChunk(0, 0)!.set(8, 40, 4, BlockId.Stone);
    const origin = new THREE.Vector3(8.5, 40.5, 8.5);
    const direction = new THREE.Vector3(0, 0, -1);
    expect(world.raycast(origin, direction, 6)).toMatchObject({ block: BlockId.TallGrass, z: 6 });
    expect(world.raycast(origin, direction, 6, { geometry: 'collision' })).toMatchObject({ block: BlockId.Stone, z: 4 });
    for (const plant of [BlockId.Dandelion, BlockId.Poppy, BlockId.DeadBush, BlockId.Fire, BlockId.Fern]) {
      world.getChunk(0, 0)!.set(8, 40, 6, plant);
      expect(world.raycast(origin, direction, 5, { geometry: 'collision' })?.block, String(plant)).toBe(BlockId.Stone);
      expect(world.raycast(origin, direction, 5)?.block, `selection ${plant}`).toBe(plant);
    }
  });

  it('still collides with stairs and continues through air after a flower', () => {
    const world = room();
    world.getChunk(0, 0)!.set(8, 40, 6, BlockId.OakStairs);
    world.setBlockState(8, 40, 6, { facing: 'east', stairHalf: 'bottom' });
    const origin = new THREE.Vector3(8.5, 40.25, 8.5);
    expect(world.raycast(origin, new THREE.Vector3(0, 0, -1), 5, { geometry: 'collision' })).toMatchObject({
      block: BlockId.OakStairs, z: 6,
    });
    world.getChunk(0, 0)!.set(8, 40, 6, BlockId.Dandelion);
    expect(world.raycast(origin, new THREE.Vector3(0, 0, -1), 5, { geometry: 'collision' })).toBeUndefined();
  });
});

describe('player arrow pickup', () => {
  function manager() {
    const world = new VoxelWorld('arrow-pickup');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    chunk.set(8, 40, 8, BlockId.Stone);
    const scene = new THREE.Scene();
    const mobs = new MobManager(scene, world, { automaticSpawning: false, random: () => 0.5 });
    const arrows = new PlayerArrowManager(scene, world, mobs, { random: () => 0.5 });
    cleanup.push(() => { arrows.dispose(); mobs.dispose(); });
    arrows.spawn(new THREE.Vector3(8.5, 40.5, 10.5), new THREE.Vector3(0, 0, -1), 3, 6, false);
    arrows.tick(0.05);
    return { arrows, mobs, scene };
  }

  it('adds exactly one arrow once the resting projectile overlaps the player', () => {
    const { arrows } = manager();
    const inventory = new Inventory();
    const player = { minX: 8, minY: 40, minZ: 8, maxX: 9, maxY: 42, maxZ: 9 };
    expect(arrows.tryCollect(player, { mode: 'survival', addItem: (id, count) => inventory.addItem(id, count) })).toBe(0);
    for (let tick = 0; tick < 6; tick += 1) arrows.tick(0.05);
    expect(arrows.tryCollect(player, { mode: 'survival', addItem: (id, count) => inventory.addItem(id, count) })).toBe(1);
    expect(inventory.count('arrow')).toBe(1);
    expect(arrows.count).toBe(0);
    expect(arrows.tryCollect(player, { mode: 'survival', addItem: (id, count) => inventory.addItem(id, count) })).toBe(0);
  });

  it('leaves a resting arrow in the world when survival inventory is full', () => {
    const { arrows } = manager();
    for (let tick = 0; tick < 6; tick += 1) arrows.tick(0.05);
    const inventory = new Inventory();
    for (let slot = 0; slot < Inventory.SLOT_COUNT; slot += 1) inventory.addItem('dirt', 64);
    expect(arrows.tryCollect(
      { minX: 8, minY: 40, minZ: 8, maxX: 9, maxY: 42, maxZ: 9 },
      { mode: 'survival', addItem: (id, count) => inventory.addItem(id, count) },
    )).toBe(0);
    expect(arrows.count).toBe(1);
    expect(inventory.count('arrow')).toBe(0);
  });

  it('removes a creative-world arrow without granting extra inventory', () => {
    const { arrows } = manager();
    for (let tick = 0; tick < 6; tick += 1) arrows.tick(0.05);
    const inventory = new Inventory();
    expect(arrows.tryCollect(
      { minX: 8, minY: 40, minZ: 8, maxX: 9, maxY: 42, maxZ: 9 },
      { mode: 'creative', addItem: (id, count) => inventory.addItem(id, count) },
    )).toBe(1);
    expect(arrows.count).toBe(0);
    expect(inventory.count('arrow')).toBe(0);
  });

  it('does not collect flying player arrows or skeleton arrows', () => {
    const world = new VoxelWorld('arrow-no-pickup');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    const scene = new THREE.Scene();
    const mobs = new MobManager(scene, world, { automaticSpawning: false, random: () => 0.5 });
    const arrows = new PlayerArrowManager(scene, world, mobs, { random: () => 0.5 });
    cleanup.push(() => { arrows.dispose(); mobs.dispose(); });
    arrows.spawn(new THREE.Vector3(8.5, 42, 8.5), new THREE.Vector3(0, 1, 0), 1, 6, false);
    const inventory = new Inventory();
    expect(arrows.tryCollect(
      { minX: 8, minY: 41, minZ: 8, maxX: 9, maxY: 44, maxZ: 9 },
      { mode: 'survival', addItem: (id, count) => inventory.addItem(id, count) },
    )).toBe(0);
    expect(arrows.count).toBe(1);
    chunk.set(8, 40, 8, BlockId.Stone);
    const skeleton = mobs.spawn('skeleton', new THREE.Vector3(8.5, 39, 12.5), { force: true })!;
    (mobs as unknown as { spawnArrow: Function }).spawnArrow(skeleton, new THREE.Vector3(8.5, 40.5, 0), {});
    const projectile = [...(mobs as unknown as { projectiles: Map<string, { inGround: boolean; position: THREE.Vector3; velocity: THREE.Vector3 }> }).projectiles.values()][0]!;
    projectile.position.set(8.5, 40.5, 10.5);
    projectile.velocity.set(0, 0, -3);
    (mobs as unknown as { updateProjectiles: Function }).updateProjectiles(0.05, undefined, {});
    expect(projectile.inGround).toBe(true);
    expect(inventory.count('arrow')).toBe(0);
    expect(mobs.projectileCount).toBe(1);
  });
});

describe('golden apple absorption lifecycle', () => {
  it('consumes absorption before health and clears leftover HP when the effect expires', () => {
    const survival = new SurvivalSystem();
    expect(survival.health).toBe(20);
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 40 });
    expect(survival.absorption).toBe(4);
    expect(survival.damage(3, 'melee')).toMatchObject({ absorbed: 3, dealt: 0 });
    expect(survival.absorption).toBe(1);
    expect(survival.health).toBe(20);
    survival.hurtResistance.reset();
    expect(survival.damage(2, 'melee')).toMatchObject({ absorbed: 1, dealt: 1 });
    expect(survival.absorption).toBe(0);
    expect(survival.health).toBe(19);

    const expiring = new SurvivalSystem();
    expiring.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2 });
    expect(expiring.absorption).toBe(4);
    expiring.tick(0.1);
    expect(expiring.hasEffect('absorption')).toBe(false);
    expect(expiring.absorption).toBe(0);
    expect(expiring.health).toBe(20);
  });

  it('round-trips remaining absorption through serialize/restore without changing max health', () => {
    const survival = new SurvivalSystem();
    survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 2400 });
    survival.damage(1, 'generic', { ignoreInvulnerability: true });
    const saved = survival.serialize();
    expect(saved.absorption).toBe(3);
    expect(saved.absorptionTicks).toBeGreaterThan(0);
    const restored = new SurvivalSystem();
    restored.restore(saved);
    expect(restored.absorption).toBe(3);
    expect(restored.hasEffect('absorption')).toBe(true);
    expect(restored.health).toBe(20);
  });
});
