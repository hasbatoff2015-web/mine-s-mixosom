import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { PLAYER_REACH, chunkKey, floorDiv } from '../src/core/constants';
import { performUseHeld, type UseSimulationContext } from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId } from '../src/items';
import { Vec3 } from '../src/math/vec3';
import { Chunk } from '../src/world/Chunk';
import { FLUID_SOURCE_LEVEL } from '../src/world/fluids';
import { VoxelWorld, type VoxelHit } from '../src/world/World';

const OUT = 10_000;
const IN = 9_999;

function putChunk(world: VoxelWorld, x: number, z: number): void {
  const cx = floorDiv(x, 16);
  const cz = floorDiv(z, 16);
  const key = chunkKey(cx, cz);
  if (!world.chunks.has(key)) {
    const chunk = new Chunk(cx, cz);
    chunk.generated = true;
    world.chunks.set(key, chunk);
  }
}

function fillAirColumn(world: VoxelWorld, x: number, z: number, y0: number, y1: number): void {
  putChunk(world, x, z);
  for (let y = y0; y <= y1; y += 1) {
    world.applyBlockBatch([{ x, y, z, block: BlockId.Air }], { updateLighting: false, scheduleNeighbors: false });
  }
}

function put(world: VoxelWorld, x: number, y: number, z: number, block: BlockId): void {
  putChunk(world, x, z);
  world.applyBlockBatch([{ x, y, z, block }], { updateLighting: false, scheduleNeighbors: false });
}

function hitAt(x: number, y: number, z: number, block: BlockId, normal = { x: 0, y: 1, z: 0 }): VoxelHit {
  return {
    x, y, z, block,
    normal: new Vec3(normal.x, normal.y, normal.z),
    distance: 2,
    point: new Vec3(x + 0.5, y + 0.5, z + 0.5),
  };
}

function context(
  world: VoxelWorld,
  inventory: Inventory,
  options: {
    hit?: VoxelHit;
    eye?: Vec3;
    look?: Vec3;
    effects?: UseSimulationContext['effects'];
    redstone?: Partial<UseSimulationContext['redstone']>;
    minecarts?: UseSimulationContext['minecarts'];
    enterVehicle?: UseSimulationContext['enterVehicle'];
  } = {},
): UseSimulationContext {
  const eye = options.eye ?? new Vec3(9_996.5, 41.5, 0.5);
  const look = options.look ?? new Vec3(1, 0, 0);
  return {
    world,
    inventory,
    selectedSlot: 0,
    gamemode: 'survival',
    reach: PLAYER_REACH,
    ...(options.hit ? { hit: options.hit } : {}),
    eyePosition: () => eye,
    viewDirection: () => look,
    yaw: 0,
    position: new Vec3(eye.x, 40, eye.z),
    intersectsBlock: () => false,
    intersectsCollisionBoxes: () => false,
    foodUseTicks: 0,
    bowUseTicks: 0,
    minecarts: options.minecarts ?? {
      raycast: () => undefined,
      cartAt: () => undefined,
      nearest: () => undefined,
      isRideable: () => false,
      handleFlintUse: () => 'none',
      insertTnt: () => false,
      spawn: () => undefined,
    } as UseSimulationContext['minecarts'],
    redstone: {
      toggleLever: () => undefined,
      pressButton: () => false,
      setButtonOrientation: () => false,
      setLeverOrientation: () => false,
      primeTnt: () => undefined,
      notifyBlockChanged: () => undefined,
      ...options.redstone,
    },
    effects: options.effects,
    enterVehicle: options.enterVehicle,
  };
}

describe('world-border gameplay use mutations', () => {
  it('empty bucket cannot pick up a water source at x=10000', () => {
    const world = new VoxelWorld('border-empty-bucket');
    world.setViewCenter(9_996, 41, 0);
    for (let x = 9_996; x <= OUT; x += 1) fillAirColumn(world, x, 0, 40, 42);
    put(world, OUT, 41, 0, BlockId.Water);
    world.setBlockState(OUT, 41, 0, { fluidLevel: FLUID_SOURCE_LEVEL });
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Bucket));
    performUseHeld(context(world, inventory, {
      eye: new Vec3(9_996.5, 41.5, 0.5),
      look: new Vec3(1, 0, 0),
    }));
    expect(world.getBlock(OUT, 41, 0, false)).toBe(BlockId.Water);
    expect(inventory.getSlot(0)?.itemId).toBe(ItemId.Bucket);
  });

  it('empty bucket still picks up a water source at x=9999', () => {
    const world = new VoxelWorld('border-empty-bucket-in');
    world.setViewCenter(9_995, 41, 0);
    for (let x = 9_995; x <= IN; x += 1) fillAirColumn(world, x, 0, 40, 42);
    put(world, IN, 41, 0, BlockId.Water);
    world.setBlockState(IN, 41, 0, { fluidLevel: FLUID_SOURCE_LEVEL });
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Bucket));
    performUseHeld(context(world, inventory, {
      eye: new Vec3(9_995.5, 41.5, 0.5),
      look: new Vec3(1, 0, 0),
    }));
    expect(world.getBlock(IN, 41, 0, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.itemId).toBe(ItemId.WaterBucket);
  });

  it('filled bucket cannot place fluid at x=10000 and leaves inventory unchanged', () => {
    const world = new VoxelWorld('border-filled-bucket');
    put(world, IN, 40, 0, BlockId.Stone);
    put(world, OUT, 40, 0, BlockId.Air);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.WaterBucket));
    performUseHeld(context(world, inventory, {
      hit: hitAt(IN, 40, 0, BlockId.Stone, { x: 1, y: 0, z: 0 }),
    }));
    expect(world.getBlock(OUT, 40, 0, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.itemId).toBe(ItemId.WaterBucket);
  });

  it('flint and steel does not ignite or wear durability outside the border', () => {
    const world = new VoxelWorld('border-flint');
    put(world, OUT, 40, 0, BlockId.Stone);
    put(world, OUT, 41, 0, BlockId.Air);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.FlintAndSteel));
    const before = inventory.getSlot(0)?.durability;
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 0, BlockId.Stone),
    }));
    expect(world.getBlock(OUT, 41, 0, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.durability).toBe(before);
  });

  it('flint and steel does not prime TNT outside the border', () => {
    const world = new VoxelWorld('border-tnt');
    put(world, OUT, 40, 0, BlockId.Tnt);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.FlintAndSteel));
    const before = inventory.getSlot(0)?.durability;
    const primeTnt = vi.fn();
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 0, BlockId.Tnt),
      redstone: { primeTnt },
    }));
    expect(primeTnt).not.toHaveBeenCalled();
    expect(world.getBlock(OUT, 40, 0, false)).toBe(BlockId.Tnt);
    expect(inventory.getSlot(0)?.durability).toBe(before);
  });

  it('hoe does not till dirt outside the border or wear durability', () => {
    const world = new VoxelWorld('border-hoe');
    put(world, OUT, 40, 0, BlockId.GrassBlock);
    put(world, OUT, 41, 0, BlockId.Air);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.WoodenHoe));
    const before = inventory.getSlot(0)?.durability;
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 0, BlockId.GrassBlock),
    }));
    expect(world.getBlock(OUT, 40, 0, false)).toBe(BlockId.GrassBlock);
    expect(inventory.getSlot(0)?.durability).toBe(before);
  });

  it('seeds are not consumed when planting outside the border', () => {
    const world = new VoxelWorld('border-seeds');
    put(world, OUT, 40, 0, BlockId.Farmland);
    put(world, OUT, 41, 0, BlockId.Air);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.WheatSeeds, 3));
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 0, BlockId.Farmland),
    }));
    expect(world.getBlock(OUT, 41, 0, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.count).toBe(3);
  });

  it('bone meal does not age a crop outside the border', () => {
    const world = new VoxelWorld('border-bonemeal');
    put(world, OUT, 40, 0, BlockId.Farmland);
    world.setBlockState(OUT, 40, 0, { hydrated: true });
    put(world, OUT, 41, 0, BlockId.WheatCrop);
    world.setBlockState(OUT, 41, 0, { age: 1 });
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.BoneMeal, 2));
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 41, 0, BlockId.WheatCrop),
    }));
    expect(world.getBlockState(OUT, 41, 0)?.age).toBe(1);
    expect(inventory.getSlot(0)?.count).toBe(2);
  });

  it('legacy door / lever / button outside the border keep their state', () => {
    const world = new VoxelWorld('border-redstone');
    put(world, OUT, 40, 0, BlockId.OakDoor);
    world.setBlockState(OUT, 40, 0, { facing: 'north', hinge: 'left', open: false, half: 'lower' });
    put(world, OUT, 41, 0, BlockId.OakDoor);
    world.setBlockState(OUT, 41, 0, { facing: 'north', hinge: 'left', open: false, half: 'upper' });
    put(world, OUT, 40, 1, BlockId.Lever);
    put(world, OUT, 40, 2, BlockId.StoneButton);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Stick));
    const toggleLever = vi.fn();
    const pressButton = vi.fn();
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 0, BlockId.OakDoor),
      redstone: { toggleLever, pressButton },
    }));
    expect(world.getBlockState(OUT, 40, 0)?.open).toBe(false);
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 1, BlockId.Lever),
      redstone: { toggleLever, pressButton },
    }));
    performUseHeld(context(world, inventory, {
      hit: hitAt(OUT, 40, 2, BlockId.StoneButton),
      redstone: { toggleLever, pressButton },
    }));
    expect(toggleLever).not.toHaveBeenCalled();
    expect(pressButton).not.toHaveBeenCalled();
  });

  it('legacy chest / furnace / bed / sign outside the border are not opened', () => {
    const world = new VoxelWorld('border-containers');
    put(world, OUT, 40, 0, BlockId.Chest);
    put(world, OUT, 40, 1, BlockId.Furnace);
    put(world, OUT, 40, 2, BlockId.WhiteBed);
    put(world, OUT, 40, 3, BlockId.OakSign);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Stick));
    const openContainer = vi.fn();
    const onBedUsed = vi.fn();
    const onSignUsed = vi.fn();
    const effects = { openContainer, onBedUsed, onSignUsed };
    performUseHeld(context(world, inventory, { hit: hitAt(OUT, 40, 0, BlockId.Chest), effects }));
    performUseHeld(context(world, inventory, { hit: hitAt(OUT, 40, 1, BlockId.Furnace), effects }));
    performUseHeld(context(world, inventory, { hit: hitAt(OUT, 40, 2, BlockId.WhiteBed), effects }));
    performUseHeld(context(world, inventory, { hit: hitAt(OUT, 40, 3, BlockId.OakSign), effects }));
    expect(openContainer).not.toHaveBeenCalled();
    expect(onBedUsed).not.toHaveBeenCalled();
    expect(onSignUsed).not.toHaveBeenCalled();
  });

  it('food still starts when looking at a chest outside the border', () => {
    const world = new VoxelWorld('border-food');
    put(world, OUT, 40, 0, BlockId.Chest);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Apple));
    const openContainer = vi.fn();
    const ctx = context(world, inventory, {
      hit: hitAt(OUT, 40, 0, BlockId.Chest),
      effects: { openContainer },
    });
    performUseHeld(ctx);
    expect(openContainer).not.toHaveBeenCalled();
    expect(ctx.foodUseTicks).toBe(1);
  });

  it('bow still charges when looking at a door outside the border', () => {
    const world = new VoxelWorld('border-bow');
    put(world, OUT, 40, 0, BlockId.OakDoor);
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Bow));
    const ctx = context(world, inventory, { hit: hitAt(OUT, 40, 0, BlockId.OakDoor) });
    performUseHeld(ctx);
    expect(world.getBlockState(OUT, 40, 0)?.open).not.toBe(true);
    expect(ctx.bowUseTicks).toBe(1);
  });

  it('does not enter a legacy cart whose riding pose is outside the playable AABB', () => {
    const world = new VoxelWorld('border-cart-enter');
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Stick));
    const enterVehicle = vi.fn();
    const ctx = context(world, inventory, {
      enterVehicle,
      minecarts: {
        raycast: () => undefined,
        cartAt: () => undefined,
        nearest: () => ({ id: 'legacy-out', position: new Vec3(OUT + 0.5, 41, 0.5) }) as never,
        isRideable: () => true,
        handleFlintUse: () => 'none',
        insertTnt: () => false,
        spawn: () => undefined,
      } as UseSimulationContext['minecarts'],
    });
    performUseHeld(ctx);
    expect(enterVehicle).not.toHaveBeenCalled();
    expect(ctx.ridingCartId).toBeUndefined();
  });
});
