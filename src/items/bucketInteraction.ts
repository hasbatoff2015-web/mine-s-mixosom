import type { Vector3 } from 'three';
import { BlockId, getBlockDefinition } from '../blocks';
import { createItemStack, Inventory, type ItemStack } from '../inventory';
import { FLUID_SOURCE_LEVEL, isFluidSource } from '../world/fluids';
import type { VoxelHit, VoxelWorld } from '../world/World';
import { ItemId } from './types';
import { getItemDefinition } from './registry';

/** Preserve pre-limit player saves instead of triggering Game's invalid-inventory fallback. */
export function restoreBucketInventory(value: unknown): { inventory: Inventory; overflow: ItemStack[] } {
  if (!value || typeof value !== 'object' || !('slots' in value) || !Array.isArray(value.slots)) {
    return { inventory: Inventory.deserialize(value), overflow: [] };
  }
  const excess: ItemStack[] = [];
  const normalize = (raw: unknown): unknown => {
    if (!raw || typeof raw !== 'object' || !('itemId' in raw) || !('count' in raw)) return raw;
    const maximum = raw.itemId === ItemId.Bucket || raw.itemId === ItemId.WaterBucket || raw.itemId === ItemId.LavaBucket
      ? getItemDefinition(raw.itemId).maxStack : undefined;
    if (!maximum || typeof raw.count !== 'number' || !Number.isInteger(raw.count)
      || raw.count <= maximum || raw.count > 64) return raw;
    const normalized = { ...raw, count: maximum } as ItemStack;
    for (let remaining = raw.count - maximum; remaining > 0; remaining -= maximum) {
      excess.push({ ...normalized, count: Math.min(remaining, maximum) });
    }
    return normalized;
  };
  const inventory = Inventory.deserialize({
    ...value,
    slots: value.slots.map(normalize),
    offhand: normalize('offhand' in value ? value.offhand : undefined),
  });
  const overflow: ItemStack[] = [];
  for (const stack of excess) {
    const remainder = inventory.add(stack);
    if (remainder) overflow.push(remainder);
  }
  return { inventory, overflow };
}

export interface BucketContext {
  readonly world: VoxelWorld;
  readonly inventory: Inventory;
  readonly selectedSlot: number;
  readonly mode: 'survival' | 'creative';
  readonly onDrop: (stack: ItemStack) => void;
}

function storeOrDrop(context: BucketContext, stack: ItemStack): void {
  const remainder = context.inventory.add(stack);
  if (remainder) context.onDrop(remainder);
}

/** The existing DDA stops at the first liquid, then source semantics decide pickup. */
export function pickupFluidSource(
  context: BucketContext,
  origin: Vector3,
  direction: Vector3,
  reach: number,
): VoxelHit | undefined {
  const { world, inventory, selectedSlot, mode } = context;
  const stack = inventory.getSlot(selectedSlot);
  if (stack?.itemId !== ItemId.Bucket) return undefined;
  const hit = world.raycast(origin, direction, reach, { stopOnLiquids: true });
  if (!hit || !isFluidSource(world, hit.x, hit.y, hit.z)) return undefined;
  const filled = createItemStack(hit.block === BlockId.Water ? ItemId.WaterBucket : ItemId.LavaBucket);
  const result = world.applyBlockBatch([{ x: hit.x, y: hit.y, z: hit.z, block: BlockId.Air }], {
    deferLighting: true,
    lightOrigin: 'edit',
  });
  if (result.applied === 0) return undefined;
  if (stack.count === 1 || mode === 'creative') {
    inventory.setSlot(selectedSlot, filled);
    if (stack.count > 1) storeOrDrop(context, { ...stack, count: stack.count - 1 });
  } else {
    inventory.setSlot(selectedSlot, { ...stack, count: stack.count - 1 });
    storeOrDrop(context, filled);
  }
  return hit;
}

/** Uses the ordinary block hit/placement rule, not a second traversal. */
export function placeBucketFluid(context: BucketContext, hit: VoxelHit | undefined): {
  x: number; y: number; z: number; block: BlockId;
} | undefined {
  const { world, inventory, selectedSlot, mode } = context;
  const stack = inventory.getSlot(selectedSlot);
  if (!hit || (stack?.itemId !== ItemId.WaterBucket && stack?.itemId !== ItemId.LavaBucket)) return undefined;
  const replaceHit = getBlockDefinition(hit.block).replaceable === true;
  const x = replaceHit ? hit.x : hit.x + hit.normal.x;
  const y = replaceHit ? hit.y : hit.y + hit.normal.y;
  const z = replaceHit ? hit.z : hit.z + hit.normal.z;
  const existing = world.getBlock(x, y, z);
  if (existing !== BlockId.Air && !getBlockDefinition(existing).replaceable) return undefined;
  const block = stack.itemId === ItemId.WaterBucket ? BlockId.Water : BlockId.Lava;
  if (existing === block && isFluidSource(world, x, y, z)) return undefined;
  const result = world.applyBlockBatch([{ x, y, z, block }], { deferLighting: true, lightOrigin: 'edit' });
  if (result.applied === 0 && existing !== block) return undefined;
  world.setBlockState(x, y, z, { fluidLevel: FLUID_SOURCE_LEVEL });
  if (existing === block) world.restartFluidSchedule(x, y, z);
  if (mode === 'survival') inventory.setSlot(selectedSlot, createItemStack(ItemId.Bucket));
  return { x, y, z, block };
}
