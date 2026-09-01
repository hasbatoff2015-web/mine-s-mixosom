import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { Game } from '../src/core/Game';
import { PLAYER_REACH } from '../src/core/constants';
import {
  cartIsCloser,
  performUseHeld,
  placeFromHit,
  resolveUseIntent,
  type UseSimulationContext,
} from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';

function intent(partial: Parameters<typeof resolveUseIntent>[0]) {
  return resolveUseIntent(partial);
}

describe('resolveUseIntent (shared SP / server order)', () => {
  it('picks up with an empty bucket before any block use', () => {
    expect(intent({
      itemId: ItemId.Bucket,
      hit: { block: BlockId.Lever, distance: 1 },
    })).toBe('pickup-bucket');
  });

  it('uses lever / door when the block is closer than a cart', () => {
    expect(intent({
      itemId: ItemId.Stick,
      hit: { block: BlockId.Lever, distance: 1 },
      cartRay: { rideable: true, distance: 2 },
    })).toBe('toggle-lever');
    expect(intent({
      hit: { block: BlockId.OakDoor, distance: 1.2 },
    })).toBe('toggle-door');
  });

  it('prefers a closer cart over the block behind it', () => {
    expect(intent({
      itemId: ItemId.FlintAndSteel,
      hit: { block: BlockId.OakDoor, distance: 3 },
      cartRay: { rideable: true, distance: 1 },
    })).toBe('flint');
    expect(intent({
      hit: { block: BlockId.Stone, distance: 3 },
      cartRay: { rideable: true, distance: 1 },
    })).toBe('mount-cart');
  });

  it('starts food / bow after use-target blocks', () => {
    expect(intent({ itemId: ItemId.Apple, itemKind: 'food' })).toBe('start-food');
    expect(intent({ itemId: ItemId.Bow })).toBe('start-bow');
  });

  it('places from a block hit when holding a placeable', () => {
    expect(intent({
      itemId: 'torch',
      placesBlockId: BlockId.Torch,
      hit: { block: BlockId.Stone, distance: 2 },
    })).toBe('place-block');
  });

  it('cartIsCloser matches the historical distance rule', () => {
    expect(cartIsCloser({ distance: 2 }, { distance: 1 })).toBe(true);
    expect(cartIsCloser({ distance: 1 }, { distance: 1 })).toBe(true);
    expect(cartIsCloser({ distance: 1 }, { distance: 2 })).toBe(false);
    expect(cartIsCloser(undefined, { distance: 2 })).toBe(true);
    expect(cartIsCloser({ distance: 1 }, undefined)).toBe(false);
  });
});

function simWorld() {
  const world = new VoxelWorld('shared-use');
  const chunk = new Chunk(0, 0);
  world.chunks.set('0,0', chunk);
  chunk.set(5, 40, 5, BlockId.Stone);
  const inventory = new Inventory();
  const playerPos = new THREE.Vector3(2, 40, 2);
  const redstone = {
    notifyBlockChanged: vi.fn(),
    setButtonOrientation: (x: number, y: number, z: number, attachment: string, facing: string) => {
      world.setBlockState(x, y, z, { attachment: attachment as 'floor', facing: facing as 'north' });
    },
    setLeverOrientation: (x: number, y: number, z: number, attachment: string, facing: string) => {
      world.setBlockState(x, y, z, { attachment: attachment as 'floor', facing: facing as 'north' });
    },
    toggleLever: vi.fn(),
    pressButton: vi.fn(),
    primeTnt: vi.fn(),
  };
  const minecarts = {
    raycast: () => undefined,
    cartAt: () => undefined,
    nearest: () => undefined,
    isRideable: () => false,
    handleFlintUse: () => 'none' as const,
    insertTnt: () => false,
    spawn: () => undefined,
  };
  const ctx: UseSimulationContext = {
    world,
    inventory,
    selectedSlot: 0,
    gamemode: 'survival',
    reach: PLAYER_REACH,
    hit: {
      x: 5, y: 40, z: 5, block: BlockId.Stone,
      normal: new THREE.Vector3(0, 1, 0),
      distance: 2,
      point: new THREE.Vector3(5.5, 40.5, 5.5),
    },
    eyePosition: () => new THREE.Vector3(2, 42, 2),
    viewDirection: () => new THREE.Vector3(0, 0, -1),
    yaw: 0,
    position: playerPos,
    intersectsBlock: () => false,
    intersectsCollisionBoxes: () => false,
    foodUseTicks: 0,
    bowUseTicks: 0,
    minecarts: minecarts as UseSimulationContext['minecarts'],
    redstone: redstone as unknown as UseSimulationContext['redstone'],
  };
  return { world, inventory, ctx, chunk };
}

describe('shared placeFromHit (one simulation path)', () => {
  it('places a floor torch from the same helper SP and the server would call', () => {
    const { world, inventory, ctx } = simWorld();
    inventory.setSlot(0, createItemStack('torch'));
    expect(placeFromHit(ctx, ctx.hit!, BlockId.Torch)).toEqual({ ok: true });
    expect(world.getBlock(5, 41, 5, false)).toBe(BlockId.Torch);
    expect(world.getBlockState(5, 41, 5)?.attachment).toBe('floor');
    expect(inventory.getSlot(0)).toBeNull();
  });

  it('rejects a lantern without vertical support', () => {
    const { world, inventory, ctx } = simWorld();
    world.setBlock(5, 40, 5, BlockId.Air);
    world.setBlock(5, 39, 5, BlockId.Air);
    inventory.setSlot(0, createItemStack('lantern'));
    const hit = {
      x: 5, y: 39, z: 5, block: BlockId.Stone,
      normal: new THREE.Vector3(0, 1, 0),
      distance: 2,
      point: new THREE.Vector3(5.5, 39.5, 5.5),
    };
    expect(placeFromHit(ctx, hit, BlockId.Lantern).ok).toBe(false);
    expect(world.getBlock(5, 40, 5, false)).toBe(BlockId.Air);
  });

  it('performUseHeld starts food ticks for the same input both hosts use', () => {
    const { ctx, inventory } = simWorld();
    inventory.setSlot(0, createItemStack('apple'));
    performUseHeld(ctx);
    expect(ctx.foodUseTicks).toBe(1);
  });
});

describe('online client does not simulate use', () => {
  it('Game.useTargetOrItem only sends interact when online', () => {
    const send = vi.fn();
    const game = Object.create(Game.prototype) as { useTargetOrItem: () => void; session: object };
    const world = new VoxelWorld('online-use');
    const chunk = new Chunk(0, 0);
    world.chunks.set('0,0', chunk);
    chunk.set(5, 40, 5, BlockId.Stone);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack('torch'));
    game.session = {
      online: { client: { send } },
      world,
      inventory,
      selectedSlot: 0,
      summary: { mode: 'survival' },
      target: {
        x: 5, y: 40, z: 5, block: BlockId.Stone,
        normal: new THREE.Vector3(0, 1, 0),
        distance: 2,
        point: new THREE.Vector3(5.5, 40.5, 5.5),
      },
    };
    game.useTargetOrItem();
    expect(send).toHaveBeenCalledWith({ type: 'interact' });
    expect(world.getBlock(5, 41, 5, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.itemId).toBe('torch');
  });
});
