import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition, type BlockRenderState } from '../src/blocks';
import { Game } from '../src/core/Game';
import { DroppedItemManager } from '../src/entities';
import { RedstoneSystem } from '../src/redstone';
import { PlayerArrowManager } from '../src/combat/PlayerArrowManager';
import { MobManager } from '../src/entities/MobManager';
import { ExplosionQueue } from '../src/world/ExplosionQueue';
import { attachmentNormal, selectionBoxesForBlock } from '../src/rendering/specialBlockGeometry';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { supportCellForBlock } from '../src/world/placement';
import { canReplaceWithFluid, readFluidLevel, readFluidFalling } from '../src/world/fluids';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
const facings = ['north', 'south', 'east', 'west'] as const;
const attachments = ['floor', 'wall', 'ceiling'] as const;
function worldFixture() {
  const world = new VoxelWorld('interaction-polish');
  world.chunks.set('0,0', new Chunk(0, 0));
  return world;
}
function set(world: VoxelWorld, x: number, y: number, z: number, block: BlockId, state?: BlockRenderState) {
  world.applyBlockBatch([{ x, y, z, block }], { deferLighting: true });
  if (state) world.setBlockState(x, y, z, state);
}
function supported(world: VoxelWorld, block: BlockId, state: BlockRenderState) {
  const support = supportCellForBlock(block, state, 8, 40, 8)!;
  set(world, support.x, support.y, support.z, BlockId.Stone);
  set(world, 8, 40, 8, block, state);
  world.processSupportIntegrity();
  expect(world.getBlock(8, 40, 8)).toBe(block);
  return support;
}
function gameDrops(world: VoxelWorld) {
  const drops = new DroppedItemManager(new THREE.Scene(), world);
  const redstone = new RedstoneSystem(world);
  const game = Object.create(Game.prototype) as any;
  game.session = { world, drops, redstone };
  cleanup.push(() => { drops.dispose(); redstone.dispose(); });
  return { drops, redstone, drain: () => game.processDetachedBlocks() };
}

describe('canonical controls: actual DDA, all mounts and states', () => {
  for (const block of [BlockId.StoneButton, BlockId.Lever]) for (const attachment of attachments) {
    it.each(facings)(`${BlockId[block]} ${attachment} %s centers, edges, oblique and near miss`, (facing) => {
      for (const powered of [false, true]) {
        const world = worldFixture(), state = { attachment, facing, powered };
        supported(world, block, state);
        const normal = attachmentNormal(attachment, facing);
        const boxes = selectionBoxesForBlock(getBlockDefinition(block), state, 8, 40, 8, world);
        expect(boxes).toHaveLength(block === BlockId.Lever ? 2 : 1);
        for (const box of boxes) for (const [u, v] of [[0, 0], [-0.48, -0.48], [0.48, 0.48]]) {
          const point = new THREE.Vector3(u, 0, v).applyMatrix4(box.matrix);
          const origin = point.clone().addScaledVector(normal, 2);
          expect(world.raycast(origin, normal.clone().negate(), 4)?.block).toBe(block);
          origin.add(new THREE.Vector3(0.09, 0.04, 0.08));
          expect(world.raycast(origin, point.clone().sub(origin), 4)?.block).toBe(block);
        }
        const tangent = normal.y ? new THREE.Vector3(1, 0, 1) : normal.x ? new THREE.Vector3(0, 1, 1) : new THREE.Vector3(1, 1, 0);
        const miss = new THREE.Vector3(8.5, 40.5, 8.5).addScaledVector(tangent, 0.47).addScaledVector(normal, 2);
        expect(world.raycast(miss, normal.clone().negate(), 4)?.block).toBe(BlockId.Stone);
      }
    });
  }
});

describe('local support integrity and world drops', () => {
  it('an actual explosion detaches local decorations, clears light/power and releases an arrow', () => {
    const world = worldFixture();
    const chunk = world.chunks.get('0,0')!;
    world.ensureChunkLighting(chunk);
    set(world, 8, 40, 8, BlockId.Stone);
    set(world, 8, 41, 8, BlockId.Torch, { attachment: 'floor' });
    set(world, 9, 40, 8, BlockId.Lever, { attachment: 'wall', facing: 'east' });
    set(world, 7, 40, 8, BlockId.StoneButton, { attachment: 'wall', facing: 'west' });
    const { drops, redstone, drain } = gameDrops(world);
    redstone.setLeverOrientation(9, 40, 8, 'wall', 'east');
    redstone.toggleLever(9, 40, 8);
    redstone.setButtonOrientation(7, 40, 8, 'wall', 'west');
    redstone.pressButton(7, 40, 8);
    world.processSupportIntegrity(); world.flushLighting();
    expect(world.blockLightAt(8, 41, 9)).toBeGreaterThan(0);
    const mobs = new MobManager(new THREE.Scene(), world, { automaticSpawning: false });
    const arrows = new PlayerArrowManager(new THREE.Scene(), world, mobs, { random: () => 0.5 });
    cleanup.push(() => { arrows.dispose(); mobs.dispose(); });
    arrows.spawn(new THREE.Vector3(8.5, 40.5, 10.5), new THREE.Vector3(0, 0, -1), 3, 6, false);
    arrows.tick(0.05);
    const arrow = (arrows as any).arrows[0];
    expect(arrow.inGround).toBe(true);
    const explosions = new ExplosionQueue();
    // Only the support is inside the blast; decorations must use neighbor integrity.
    explosions.enqueue({ x: 8.5, y: 40.5, z: 8.5, radius: 0.7, power: 4 });
    expect(explosions.process(world, { budgetMs: 10, maxJobs: 1, maxVoxels: 10,
      remainingPrimedCapacity: 0, random: () => 0 }).destroyed).toBe(1);
    expect(world.getBlock(8, 41, 8)).toBe(BlockId.Torch);
    world.processSupportIntegrity(); drain(); world.flushLighting(); arrows.tick(0.05);
    expect(arrow.inGround).toBe(false);
    expect(arrow.velocity.y).toBeLessThan(0);
    expect(world.blockLightAt(8, 41, 9)).toBe(0);
    expect(redstone.getSource(9, 40, 8)).toBeUndefined();
    expect(redstone.getSource(7, 40, 8)).toBeUndefined();
    expect(drops.entities).toHaveLength(3);
    world.processSupportIntegrity(); drain();
    expect(drops.entities).toHaveLength(3);
  });
  it('publishes real redstone orientation/power to DDA and support checks, including restore', () => {
    const world = worldFixture(), { redstone } = gameDrops(world);
    set(world, 7, 40, 8, BlockId.Stone);
    set(world, 8, 40, 8, BlockId.Lever);
    redstone.setLeverOrientation(8, 40, 8, 'wall', 'east');
    redstone.toggleLever(8, 40, 8);
    world.processSupportIntegrity();
    expect(world.getBlock(8, 40, 8)).toBe(BlockId.Lever);
    expect(world.getBlockState(8, 40, 8)).toMatchObject({ attachment: 'wall', facing: 'east', powered: true });
    const saved = redstone.serialize();
    redstone.restore(saved);
    expect(world.getBlockState(8, 40, 8)?.powered).toBe(true);
    const box = selectionBoxesForBlock(getBlockDefinition(BlockId.Lever), world.getBlockState(8, 40, 8), 8, 40, 8)[1]!;
    const point = new THREE.Vector3().applyMatrix4(box.matrix);
    expect(world.raycast(point.clone().add(new THREE.Vector3(2, 0, 0)), new THREE.Vector3(-1, 0, 0), 4)?.block).toBe(BlockId.Lever);
    set(world, 8, 40, 8, BlockId.StoneButton);
    redstone.setButtonOrientation(8, 40, 8, 'wall', 'east');
    redstone.pressButton(8, 40, 8, 0.1);
    expect(world.getBlockState(8, 40, 8)?.powered).toBe(true);
    redstone.update(0.15);
    expect(world.getBlockState(8, 40, 8)?.powered).toBe(false);
    set(world, 7, 40, 8, BlockId.Air); world.processSupportIntegrity();
    expect(world.getBlock(8, 40, 8)).toBe(BlockId.Air);
  });
  for (const block of [BlockId.Torch, BlockId.RedstoneTorch, BlockId.StoneButton, BlockId.Lever, BlockId.Ladder]) {
    it(`${BlockId[block]} follows actual attachment and emits exactly once`, () => {
      for (const attachment of attachments) for (const facing of facings) {
        if (block === BlockId.Ladder && attachment !== 'wall') continue;
        if ((block === BlockId.Torch || block === BlockId.RedstoneTorch) && attachment === 'ceiling') continue;
        const world = worldFixture(), state = { attachment, facing, powered: true };
        const support = supported(world, block, state);
        const { drops, redstone, drain } = gameDrops(world);
        redstone.notifyBlockChanged(8, 40, 8);
        set(world, 9, 40, 9, BlockId.Stone);
        set(world, 9, 40, 9, BlockId.Air);
        world.processSupportIntegrity();
        expect(world.getBlock(8, 40, 8)).toBe(block);
        world.applyBlockBatch([support, support].map((p) => ({ ...p, block: BlockId.Air })), { deferLighting: true });
        for (let tick = 0; tick < 4; tick++) { world.processSupportIntegrity(); drain(); }
        expect(world.getBlock(8, 40, 8)).toBe(BlockId.Air);
        expect(world.getBlockState(8, 40, 8)).toBeUndefined();
        expect(world.blockEmissionAt(8, 40, 8)).toBe(0);
        expect(drops.entities.map((d) => d.stack)).toEqual([{ itemId: getBlockDefinition(block).drop!.item, count: 1 }]);
        expect(redstone.getSource(8, 40, 8)).toBeUndefined();
      }
    });
  }
  it.each([BlockId.RedstoneWire, BlockId.OakPressurePlate, BlockId.StonePressurePlate, BlockId.Rail])('audited floor support %s', (block) => {
    const world = worldFixture(); supported(world, block, {});
    set(world, 8, 39, 8, BlockId.Air);
    world.processSupportIntegrity();
    expect(world.consumeDetachedBlocks().map((e) => e.block)).toEqual([block]);
  });
  it('checks a changed sturdy slab face and keeps valid support', () => {
    const world = worldFixture();
    set(world, 8, 39, 8, BlockId.OakSlab, { slabType: 'top' });
    set(world, 8, 40, 8, BlockId.Torch, { attachment: 'floor' });
    world.processSupportIntegrity();
    expect(world.consumeDetachedBlocks()).toEqual([]);
    world.setBlockState(8, 39, 8, { slabType: 'bottom' });
    world.processSupportIntegrity();
    expect(world.consumeDetachedBlocks()).toHaveLength(1);
  });
  it('retains overflow and an unloaded neighbor ticket without generating chunks', () => {
    const world = worldFixture();
    set(world, 0, 40, 8, BlockId.Ladder, { facing: 'east' });
    expect(world.processSupportIntegrity()).toBe(1);
    expect(world.chunks.size).toBe(1);
    expect(world.getBlock(0, 40, 8)).toBe(BlockId.Ladder);
    world.chunks.set('-1,0', new Chunk(-1, 0));
    world.processSupportIntegrity();
    expect(world.consumeDetachedBlocks()).toHaveLength(1);
    for (let x = 2; x < 12; x++) set(world, x, 40, 8, BlockId.Torch);
    expect(world.processSupportIntegrity(3)).toBe(3);
    expect(world.consumeDetachedBlocks()).toHaveLength(3);
    world.processSupportIntegrity();
    expect(world.consumeDetachedBlocks()).toHaveLength(7);
  });
  it('a mined attachment followed by its support does not duplicate loot', () => {
    const world = worldFixture(); supported(world, BlockId.Torch, {});
    set(world, 8, 40, 8, BlockId.Air); set(world, 8, 39, 8, BlockId.Air);
    world.processSupportIntegrity();
    expect(world.consumeDetachedBlocks()).toEqual([]);
  });
});

describe('flowing water displaces fragile blocks without changing placement', () => {
  it('clears propagated torch light when water replaces the emitter', () => {
    const world = worldFixture();
    world.ensureChunkLighting(world.chunks.get('0,0')!);
    supported(world, BlockId.Torch, { attachment: 'floor' });
    world.flushLighting();
    expect(world.blockLightAt(8, 40, 9)).toBeGreaterThan(0);
    set(world, 8, 40, 8, BlockId.Water); world.flushLighting();
    expect(world.blockLightAt(8, 40, 9)).toBe(0);
    expect(world.consumeDetachedBlocks()).toMatchObject([{ block: BlockId.Torch, reason: 'water' }]);
  });
  it.each([BlockId.Torch, BlockId.RedstoneTorch, BlockId.Lever, BlockId.StoneButton, BlockId.RedstoneWire, BlockId.Rail])('wash %s at its normal first arrival, exactly one drop', (block) => {
    for (const attachment of ['floor', 'wall'] as const) {
      const world = worldFixture();
      // Narrow channel, +X destination, solid floor. Wall decorations attach north.
      for (let x = 6; x < 12; x++) {
        set(world, x, 39, 8, BlockId.Stone);
        set(world, x, 40, 7, BlockId.Stone); set(world, x, 40, 9, BlockId.Stone);
      }
      supported(world, block, { attachment, facing: 'south', powered: true });
      set(world, 6, 40, 8, BlockId.Stone);
      const { drops, drain } = gameDrops(world);
      set(world, 7, 40, 8, BlockId.Water);
      for (let tick = 1; tick <= 5; tick++) {
        world.tick(); drain();
        if (tick < 5) expect(world.getBlock(8, 40, 8)).toBe(block);
      }
      expect(world.getBlock(8, 40, 8)).toBe(BlockId.Water);
      expect(readFluidLevel(world, 8, 40, 8)).toBe(7);
      expect(readFluidFalling(world, 8, 40, 8)).toBe(false);
      expect(world.getBlockState(8, 40, 8)?.powered).toBeUndefined();
      expect(world.blockEmissionAt(8, 40, 8)).toBe(0);
      for (let tick = 0; tick < 15; tick++) { world.tick(); drain(); }
      expect(drops.entities.map((d) => d.stack.count)).toEqual([1]);
      expect(getBlockDefinition(block).replaceable).not.toBe(true);
    }
  });
  it.each([BlockId.Ladder, BlockId.OakDoor, BlockId.Chest, BlockId.OakFence, BlockId.OakSlab,
    BlockId.OakStairs, BlockId.Stone, BlockId.OakPressurePlate, BlockId.StonePressurePlate])('does not wash %s', (block) => {
    expect(canReplaceWithFluid(block)).toBe(false);
  });
});
