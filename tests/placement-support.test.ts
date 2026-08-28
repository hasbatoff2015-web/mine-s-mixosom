import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { Game } from '../src/core/Game';
import { Inventory, createItemStack } from '../src/inventory';
import { getItemDefinition } from '../src/items';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { canAttachToFace, canUseAsPlacementAnchor } from '../src/world/placement';

const faces = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];

function fixture(block = BlockId.Stone, normal = faces[2]!) {
  const world = new VoxelWorld('placement-cleanup');
  const chunk = new Chunk(0, 0);
  world.chunks.set('0,0', chunk);
  chunk.set(5, 40, 5, block);
  const inventory = new Inventory();
  const player = { position: new THREE.Vector3(2, 40, 2), velocity: new THREE.Vector3(), yaw: 0,
    eyePosition: () => new THREE.Vector3(2, 42, 2), viewDirection: () => new THREE.Vector3(0, 0, -1),
    intersectsBlock: () => false, intersectsCollisionBoxes: () => false };
  const redstone = { notifyBlockChanged: vi.fn(),
    setButtonOrientation: (x: number, y: number, z: number, attachment: any, facing: any) => world.setBlockState(x, y, z, { attachment, facing }),
    setLeverOrientation: (x: number, y: number, z: number, attachment: any, facing: any) => world.setBlockState(x, y, z, { attachment, facing }) };
  // Exercise the actual Game action without constructing DOM/audio/render services.
  const game = Object.create(Game.prototype) as any;
  const session = { world, inventory, selectedSlot: 0, summary: { mode: 'survival' }, player, redstone,
    target: { x: 5, y: 40, z: 5, block, normal, distance: 2, point: new THREE.Vector3(5.5, 40.5, 5.5) },
    minecarts: { raycast: () => undefined, cartAt: () => undefined, nearest: () => undefined }, foodUseTicks: 0, bowUseTicks: 0 };
  Object.assign(game, { session, ui: { toast: vi.fn() }, audio: { playTone: vi.fn(), play: vi.fn(), playAt: vi.fn(), playBlock: vi.fn() }, firstPerson: { swing: vi.fn() } });
  const place = (itemId: string) => { inventory.setSlot(0, createItemStack(itemId)); game.useTargetOrItem(); };
  return { world, chunk, game, session, inventory, place };
}

describe('placement anchors and sturdy attachment faces', () => {
  it.each([BlockId.Torch, BlockId.RedstoneTorch, BlockId.StoneButton, BlockId.Lever, BlockId.RedstoneWire,
    BlockId.Fire, BlockId.Water, BlockId.Lava, BlockId.TallGrass])('rejects thin/non-solid support %s on all faces', (block) => {
    const { world } = fixture(block);
    expect(canUseAsPlacementAnchor(block)).toBe(false);
    for (const face of faces) expect(canAttachToFace(world, 5, 40, 5, face)).toBe(false);
  });

  it.each(['stone', 'torch', 'redstone_torch', 'stone_button', 'lever', 'ladder'])('cannot place %s above/beside a torch', (item) => {
    for (const face of faces) {
      const f = fixture(BlockId.Torch, face);
      f.place(item);
      expect(f.world.getBlock(5 + face.x, 40 + face.y, 5 + face.z, false)).toBe(BlockId.Air);
      expect(f.inventory.getSlot(0)?.itemId).toBe(item);
    }
  });

  it.each(['torch', 'redstone_torch', 'stone_button', 'lever', 'ladder'])('uses valid stone faces for %s', (item) => {
    for (const face of faces) {
      const f = fixture(BlockId.Stone, face);
      f.place(item);
      const accepted = item === 'ladder' ? face.y === 0 : item.includes('torch') ? face.y >= 0 : true;
      expect(f.world.getBlock(5 + face.x, 40 + face.y, 5 + face.z, false))
        .toBe(accepted ? getItemDefinition(item).placesBlockId : BlockId.Air);
      expect(f.inventory.getSlot(0) === null).toBe(accepted);
    }
  });

  it.each(['stone', 'oak_slab', 'oak_stairs', 'oak_door', 'chest', 'furnace', 'rail', 'oak_pressure_plate', 'redstone_dust'])('preserves %s on stone', (item) => {
    const f = fixture(); f.place(item);
    expect(f.world.getBlock(5, 41, 5, false)).toBe(getItemDefinition(item).placesBlockId);
  });

  it('distinguishes top/bottom/double slab boundary faces and inset chests', () => {
    const f = fixture(BlockId.OakSlab);
    for (const type of ['bottom', 'top', 'double'] as const) {
      f.world.setBlockState(5, 40, 5, { slabType: type });
      expect(canAttachToFace(f.world, 5, 40, 5, faces[2]!)).toBe(type !== 'bottom');
      expect(canAttachToFace(f.world, 5, 40, 5, faces[3]!)).toBe(type !== 'top');
      expect(canAttachToFace(f.world, 5, 40, 5, faces[0]!)).toBe(type === 'double');
    }
    const chest = fixture(BlockId.Chest);
    expect(canUseAsPlacementAnchor(BlockId.Chest)).toBe(true);
    expect(canAttachToFace(chest.world, 5, 40, 5, faces[2]!)).toBe(false);
  });

  it('replaces vegetation in-place, requiring the actual floor for a torch', () => {
    const f = fixture(BlockId.TallGrass);
    f.chunk.set(5, 39, 5, BlockId.Stone);
    f.place('torch');
    expect(f.world.getBlock(5, 40, 5)).toBe(BlockId.Torch);
    expect(f.world.getBlock(5, 41, 5)).toBe(BlockId.Air);
    expect(f.world.getBlockState(5, 40, 5)?.attachment).toBe('floor');
  });

  it('retains slab merging and distinguishes a stair solid base from its stepped face', () => {
    const slab = fixture(BlockId.OakSlab);
    slab.place('oak_slab');
    expect(slab.world.getBlockState(5, 40, 5)?.slabType).toBe('double');
    const stairs = fixture(BlockId.OakStairs);
    stairs.world.setBlockState(5, 40, 5, { stairHalf: 'bottom', facing: 'north' });
    expect(canAttachToFace(stairs.world, 5, 40, 5, faces[3]!)).toBe(true);
    expect(canAttachToFace(stairs.world, 5, 40, 5, faces[2]!)).toBe(false);
    stairs.world.setBlockState(5, 40, 5, { stairHalf: 'top', facing: 'north' });
    expect(canAttachToFace(stairs.world, 5, 40, 5, faces[2]!)).toBe(true);
    expect(canAttachToFace(stairs.world, 5, 40, 5, faces[3]!)).toBe(false);
  });

  it.each(['bow', 'apple', 'potion_invisibility', 'potion_regeneration'])('still dispatches use for %s', (item) => {
    const f = fixture(); f.place(item);
    expect(item === 'bow' ? f.session.bowUseTicks : f.session.foodUseTicks).toBe(1);
  });
});
