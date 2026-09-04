/**
 * Shared simulation-level use / placement for singleplayer (`Game`) and the
 * Anarchy server (`ServerGameplay`).
 *
 * Hosts supply world/inventory/player geometry plus effect hooks. UI, audio,
 * plugin events, and network dirty flags stay in the host. Online clients must
 * not call this — they send `interact` only.
 *
 * Decision order matches the historical singleplayer `useTargetOrItem` path,
 * which is the more complete rule set (anchors, lantern/chain support, slab
 * merge, rail-only minecarts). Server `useHeld` / `placeAt` previously diverged.
 */

import type { Vec3Like } from '../math/vec3';
import { Vec3 } from '../math/vec3';
import {
  BlockId,
  buttonPlacementFromHit,
  chainPlacementFromHit,
  chestFacingFromYaw,
  doorFacingFromYaw,
  furnaceFacingFromYaw,
  getBlockDefinition,
  isFenceBlock,
  isKnownBlockId,
  isPressurePlateBlock,
  isRailBlock,
  isSlabBlock,
  isStairBlock,
  ladderPlacementFromHit,
  lanternPlacementFromHit,
  slabTypeFromHit,
  stairPlacementFromHit,
  torchPlacementFromHit,
} from '../blocks';
import { WORLD_HEIGHT, isValidWorldY } from '../core/constants';
import {
  MinecartManager,
  resolveFlintAndSteelUse,
} from '../entities';
import { damageItem, type Inventory, type ItemStack } from '../inventory';
import { ItemId, tryGetItemDefinition } from '../items';
import { MAX_CROP_AGE, cropAge, isCropBlock, plantingDefinition } from '../farming';
import { systemRandomFn, type RandomFn } from './random';
import { pickupFluidSource, placeBucketFluid } from '../items/bucketInteraction';
import type { RedstoneSystem } from '../redstone';
import {
  chainSelectionLocalBox,
  defaultSlabType,
  isolatedRailShapeFromYaw,
  lanternSelectionLocalBox,
  resolveRailShape,
  slabLocalBoxes,
  stairLocalBoxes,
} from '../world/blockGeometry';
import type { CollisionBox } from '../world/collision';
import { isUseTargetBlock } from '../world/blockInteraction';
import { canAttachToFace, canSupportHanger, canUseAsPlacementAnchor } from '../world/placement';
import type { VoxelHit, VoxelWorld } from '../world/World';

export type UseIntentKind =
  | 'pickup-bucket'
  | 'open-crafting-table'
  | 'open-chest'
  | 'open-furnace'
  | 'toggle-lever'
  | 'press-button'
  | 'toggle-door'
  | 'use-bed'
  | 'farming'
  | 'start-food'
  | 'start-bow'
  | 'flint'
  | 'insert-tnt-cart'
  | 'mount-cart'
  | 'place-minecart'
  | 'place-bucket'
  | 'place-block'
  | 'none';

export type PlaceFailReason =
  | 'bounds'
  | 'occupied'
  | 'inventory'
  | 'block'
  | 'collision'
  | 'cancelled'
  | 'rejected'
  | 'no-anchor'
  | 'lantern-orientation'
  | 'lantern-support'
  | 'chain-orientation'
  | 'chain-support'
  | 'torch-ceiling'
  | 'ladder-side'
  | 'ladder-replace'
  | 'door-space'
  | 'minecart-rails';

export type PlaceResult = { ok: true } | { ok: false; reason: PlaceFailReason };

export interface UseIntentInput {
  readonly itemId?: string;
  readonly itemKind?: string;
  readonly placesBlockId?: number;
  readonly hit?: { readonly block: number; readonly distance: number };
  readonly cartRay?: { readonly rideable: boolean; readonly distance: number };
  readonly nearbyRideableCart?: boolean;
  readonly itemTool?: string;
}

export interface UseHostEffects {
  toast?(message: string): void;
  swing?(): void;
  playWorld?(event: string, x: number, y: number, z: number, options?: { pitch?: number }): void;
  playBlock?(action: 'place', block: BlockId, x: number, y: number, z: number): void;
  openContainer?(kind: 'crafting-table' | 'chest' | 'furnace', x: number, y: number, z: number): void;
  onBedUsed?(skippedNight: boolean): void;
  onInventoryChanged?(): void;
  onFlintIgnite?(): void;
  onFlintAlreadyPrimed?(): void;
  onMounted?(): void;
  dropOverflow?(stack: ItemStack): void;
  /** Server-only observation after a successful voxel write. Singleplayer omits this. */
  onPlaced?(x: number, y: number, z: number, blockId: number): void;
}

export interface UseSimulationContext {
  readonly world: VoxelWorld;
  readonly inventory: Inventory;
  selectedSlot: number;
  readonly gamemode: 'survival' | 'creative';
  readonly reach: number;
  /** Precomputed crosshair hit (SP `session.target`). Server omits and raycasts. */
  readonly hit?: VoxelHit;
  eyePosition(): Vec3Like;
  viewDirection(): Vec3Like;
  yaw: number;
  position: Vec3Like;
  intersectsBlock(x: number, y: number, z: number): boolean;
  intersectsCollisionBoxes(boxes: readonly CollisionBox[]): boolean;
  foodUseTicks: number;
  bowUseTicks: number;
  ridingCartId?: string;
  readonly minecarts: Pick<
    MinecartManager,
    'raycast' | 'cartAt' | 'nearest' | 'isRideable' | 'handleFlintUse' | 'insertTnt' | 'spawn'
  >;
  readonly redstone: Pick<
    RedstoneSystem,
    | 'toggleLever'
    | 'pressButton'
    | 'setButtonOrientation'
    | 'setLeverOrientation'
    | 'primeTnt'
    | 'notifyBlockChanged'
  >;
  readonly random?: RandomFn;
  setSpawnPoint?(position: readonly [number, number, number]): void;
  allowInteract?(x: number, y: number, z: number, block: number): boolean;
  allowPlace?(x: number, y: number, z: number, block: number): boolean;
  enterVehicle?(cartId: string): boolean;
  readonly effects?: UseHostEffects;
}

const UP_FACE = { x: 0, y: 1, z: 0 } as const;

const PLACE_TOAST: Partial<Record<PlaceFailReason, string>> = {
  bounds: 'Нельзя ставить блок за пределами мира',
  collision: 'Нельзя поставить блок внутри игрока',
  'lantern-orientation': 'Светильник можно поставить только сверху или снизу блока',
  'lantern-support': 'Светильнику нужна опора',
  'chain-orientation': 'Цепь ставится только вертикально',
  'chain-support': 'Цепи нужна точка крепления',
  'torch-ceiling': 'Факел нельзя поставить на потолок',
  'ladder-side': 'Лестницу можно поставить только на боковую сторону блока',
  'ladder-replace': 'Лестнице нужна сплошная боковая опора',
  'door-space': 'Нет места для двери',
  'minecart-rails': 'Вагонетку можно поставить только на рельсы',
};

export function placeFailToast(reason: PlaceFailReason): string | undefined {
  return PLACE_TOAST[reason];
}

export function cartIsCloser(
  hit: { readonly distance: number } | undefined,
  cartRay: { readonly distance: number } | undefined,
): boolean {
  return Boolean(cartRay && (!hit || cartRay.distance <= hit.distance));
}

/**
 * Pure use-order helper. Same inputs → same kind for SP-shaped and server-shaped
 * callers. Does not mutate the world.
 */
export function resolveUseIntent(input: UseIntentInput): UseIntentKind {
  const cartCloser = cartIsCloser(input.hit, input.cartRay);
  if (input.itemId === ItemId.Bucket) return 'pickup-bucket';
  if (input.hit && !cartCloser && isUseTargetBlock(input.hit.block)) {
    switch (input.hit.block) {
      case BlockId.CraftingTable: return 'open-crafting-table';
      case BlockId.Chest: return 'open-chest';
      case BlockId.Furnace: return 'open-furnace';
      case BlockId.Lever: return 'toggle-lever';
      case BlockId.StoneButton: return 'press-button';
      case BlockId.OakDoor: return 'toggle-door';
      case BlockId.WhiteBed: return 'use-bed';
      default: break;
    }
  }
  if (input.hit && (input.itemTool === 'hoe' || input.itemId === ItemId.BoneMeal
    || plantingDefinition(input.itemId))) return 'farming';
  if (input.itemKind === 'food') return 'start-food';
  if (input.itemId === ItemId.Bow) return 'start-bow';
  if (cartCloser) {
    if (input.itemId === ItemId.FlintAndSteel) return 'flint';
    if (input.itemId === 'tnt') return 'insert-tnt-cart';
    if (input.cartRay?.rideable) return 'mount-cart';
    return 'none';
  }
  if (input.itemId === ItemId.FlintAndSteel) return 'flint';
  if (input.itemId === 'tnt') return 'insert-tnt-cart';
  if (input.itemId === ItemId.Minecart) return 'place-minecart';
  if (input.nearbyRideableCart) return 'mount-cart';
  if (input.itemId === ItemId.WaterBucket || input.itemId === ItemId.LavaBucket) return 'place-bucket';
  if (input.hit && input.placesBlockId !== undefined) return 'place-block';
  return 'none';
}

export function performUseHeld(ctx: UseSimulationContext): void {
  const origin = new Vec3(ctx.eyePosition().x, ctx.eyePosition().y, ctx.eyePosition().z);
  const direction = new Vec3(ctx.viewDirection().x, ctx.viewDirection().y, ctx.viewDirection().z);
  const hit = ctx.hit ?? ctx.world.raycast(origin, direction, ctx.reach);
  const cartRay = ctx.minecarts.raycast(origin, direction, ctx.reach, ctx.ridingCartId);
  const stack = ctx.inventory.getSlot(ctx.selectedSlot);
  const item = stack ? tryGetItemDefinition(stack.itemId) : undefined;
  const cartCloser = cartIsCloser(hit, cartRay);

  if (stack?.itemId === ItemId.Bucket) {
    applyEmptyBucket(ctx, origin, direction);
    return;
  }

  if (hit) {
    if (ctx.allowInteract && !ctx.allowInteract(hit.x, hit.y, hit.z, hit.block)) return;
  }

  if (hit && !cartCloser) {
    if (hit.block === BlockId.CraftingTable) {
      ctx.effects?.openContainer?.('crafting-table', hit.x, hit.y, hit.z);
      return;
    }
    if (hit.block === BlockId.Chest) {
      ctx.effects?.openContainer?.('chest', hit.x, hit.y, hit.z);
      return;
    }
    if (hit.block === BlockId.Furnace) {
      ctx.effects?.openContainer?.('furnace', hit.x, hit.y, hit.z);
      return;
    }
    if (hit.block === BlockId.Lever) {
      const active = ctx.redstone.toggleLever(hit.x, hit.y, hit.z);
      if (active !== undefined) {
        ctx.effects?.playWorld?.('redstone.click', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, {
          pitch: active ? 1.08 : 0.92,
        });
        ctx.effects?.toast?.(active ? 'Рычаг включён' : 'Рычаг выключен');
        ctx.effects?.swing?.();
      }
      return;
    }
    if (hit.block === BlockId.StoneButton) {
      if (ctx.redstone.pressButton(hit.x, hit.y, hit.z)) {
        ctx.effects?.playWorld?.('redstone.click', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, { pitch: 1.06 });
        ctx.effects?.swing?.();
      }
      return;
    }
    if (hit.block === BlockId.OakDoor) {
      const opening = toggleDoorState(ctx.world, hit.x, hit.y, hit.z);
      ctx.effects?.playWorld?.(opening ? 'door.open' : 'door.close', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      ctx.effects?.swing?.();
      return;
    }
    if (hit.block === BlockId.WhiteBed) {
      ctx.setSpawnPoint?.([hit.x + 0.5, hit.y + 1.01, hit.z + 0.5]);
      let skippedNight = false;
      if (ctx.world.timeOfDay > 12_500 && ctx.world.timeOfDay < 23_500) {
        ctx.world.timeOfDay = 1_000;
        skippedNight = true;
      }
      ctx.effects?.onBedUsed?.(skippedNight);
      return;
    }
    if (tryFarmingUse(ctx, hit, stack?.itemId, item)) return;
  }

  if (item?.kind === 'food') {
    ctx.foodUseTicks = 1;
    return;
  }
  if (stack?.itemId === ItemId.Bow) {
    ctx.bowUseTicks = 1;
    return;
  }

  if (cartCloser && cartRay) {
    if (stack?.itemId === ItemId.FlintAndSteel) {
      applyFlint(ctx, origin, direction, undefined);
      return;
    }
    if (stack?.itemId === 'tnt' && insertTntCart(ctx, undefined, origin, direction)) return;
    if (ctx.minecarts.isRideable(cartRay.cart)) ctx.enterVehicle?.(cartRay.cart.id);
    return;
  }

  if (stack?.itemId === ItemId.FlintAndSteel) {
    applyFlint(ctx, origin, direction, hit);
    return;
  }
  if (stack?.itemId === 'tnt' && insertTntCart(ctx, hit, origin, direction)) return;
  if (stack?.itemId === ItemId.Minecart) {
    placeMinecartOnRail(ctx, hit);
    return;
  }

  const nearbyCart = cartRay?.cart
    ?? (hit ? ctx.minecarts.cartAt(hit.x, hit.y, hit.z) : ctx.minecarts.nearest(ctx.position, 1.5));
  if (nearbyCart && ctx.minecarts.isRideable(nearbyCart)) {
    ctx.enterVehicle?.(nearbyCart.id);
    return;
  }

  if (stack?.itemId === ItemId.WaterBucket || stack?.itemId === ItemId.LavaBucket) {
    applyFilledBucket(ctx, hit);
    return;
  }

  if (!hit || !stack || item?.placesBlockId === undefined) return;
  const placed = placeFromHit(ctx, hit, item.placesBlockId);
  if (!placed.ok) toastPlaceFail(ctx, placed.reason);
}

function tryFarmingUse(
  ctx: UseSimulationContext,
  hit: VoxelHit,
  itemId: string | undefined,
  item: ReturnType<typeof tryGetItemDefinition>,
): boolean {
  if (item?.kind === 'tool' && item.tool === 'hoe'
    && (hit.block === BlockId.Dirt || hit.block === BlockId.GrassBlock)) {
    const above = ctx.world.getBlock(hit.x, hit.y + 1, hit.z, false);
    if (above !== BlockId.Air && getBlockDefinition(above).replaceable !== true) return false;
    if (ctx.allowPlace && !ctx.allowPlace(hit.x, hit.y, hit.z, BlockId.Farmland)) return true;
    if (!ctx.world.setBlock(hit.x, hit.y, hit.z, BlockId.Farmland)) return true;
    ctx.world.setBlockState(hit.x, hit.y, hit.z, {
      hydrated: farmingWaterNearby(ctx.world, hit.x, hit.y, hit.z),
    });
    ctx.redstone.notifyBlockChanged(hit.x, hit.y, hit.z);
    ctx.effects?.playBlock?.('place', BlockId.Farmland, hit.x, hit.y, hit.z);
    ctx.effects?.swing?.();
    if (ctx.gamemode === 'survival') wearHeld(ctx);
    ctx.effects?.onPlaced?.(hit.x, hit.y, hit.z, BlockId.Farmland);
    return true;
  }

  const planting = plantingDefinition(itemId);
  if (planting && hit.block === BlockId.Farmland) {
    const x = hit.x, y = hit.y + 1, z = hit.z;
    const target = ctx.world.getBlock(x, y, z, false);
    if (target !== BlockId.Air && getBlockDefinition(target).replaceable !== true) return false;
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, planting.block)) return true;
    if (!ctx.world.setBlock(x, y, z, planting.block)) return true;
    ctx.world.setBlockState(x, y, z, { age: 0 });
    ctx.redstone.notifyBlockChanged(x, y, z);
    ctx.effects?.playBlock?.('place', planting.block, x, y, z);
    ctx.effects?.swing?.();
    if (ctx.gamemode === 'survival') consumeHeld(ctx, 1);
    ctx.effects?.onPlaced?.(x, y, z, planting.block);
    return true;
  }

  if (itemId === ItemId.BoneMeal && isCropBlock(hit.block)) {
    const farmland = ctx.world.getBlock(hit.x, hit.y - 1, hit.z, false) === BlockId.Farmland
      && ctx.world.getBlockState(hit.x, hit.y - 1, hit.z)?.hydrated === true;
    const age = cropAge(ctx.world.getBlockState(hit.x, hit.y, hit.z));
    if (!farmland || age >= MAX_CROP_AGE) return false;
    const random = ctx.random ?? systemRandomFn;
    const added = 2 + Math.floor(random() * 4);
    ctx.world.setBlockState(hit.x, hit.y, hit.z, { age: Math.min(MAX_CROP_AGE, age + added) });
    ctx.effects?.swing?.();
    if (ctx.gamemode === 'survival') consumeHeld(ctx, 1);
    return true;
  }
  return false;
}

function farmingWaterNearby(world: VoxelWorld, x: number, y: number, z: number): boolean {
  for (let dz = -4; dz <= 4; dz += 1) for (let dx = -4; dx <= 4; dx += 1) {
    if (world.getBlock(x + dx, y, z + dz, false) === BlockId.Water
      || world.getBlock(x + dx, y + 1, z + dz, false) === BlockId.Water) return true;
  }
  return false;
}

export function placeFromHit(
  ctx: UseSimulationContext,
  hit: VoxelHit,
  blockId: number,
): PlaceResult {
  const mergeHit = tryMergeSlab(ctx, hit, blockId);
  if (mergeHit !== 'skip') return mergeHit === 'merged' ? { ok: true } : { ok: false, reason: 'collision' };
  const replaceHit = getBlockDefinition(hit.block).replaceable === true;
  if (!replaceHit && !canUseAsPlacementAnchor(hit.block)) return { ok: false, reason: 'no-anchor' };
  const x = replaceHit ? hit.x : hit.x + hit.normal.x;
  const y = replaceHit ? hit.y : hit.y + hit.normal.y;
  const z = replaceHit ? hit.z : hit.z + hit.normal.z;
  return placeBlockAt(ctx, x, y, z, blockId, hit);
}

/**
 * Place into an already-chosen cell. Used by RMB (`placeFromHit`) and by the
 * existing `place_block` look-validated path. Orientation still comes from `hit`.
 */
export function placeBlockAt(
  ctx: UseSimulationContext,
  x: number,
  y: number,
  z: number,
  requestedBlock: number | undefined,
  hit?: VoxelHit,
): PlaceResult {
  if (!isValidWorldY(y)) return { ok: false, reason: 'bounds' };
  const blockId = resolvePlacingBlockId(ctx, requestedBlock);
  if (blockId === undefined) return { ok: false, reason: 'inventory' };
  if (!isKnownBlockId(blockId) || blockId === BlockId.Air) return { ok: false, reason: 'block' };

  const mergeDest = tryMergeSlabAt(ctx, x, y, z, blockId);
  if (mergeDest !== 'skip') return mergeDest === 'merged' ? { ok: true } : { ok: false, reason: 'collision' };

  const existing = ctx.world.getBlock(x, y, z);
  const existingDef = getBlockDefinition(existing);
  if (existing !== BlockId.Air && existingDef.replaceable !== true) return { ok: false, reason: 'occupied' };

  const replaceHit = Boolean(
    hit && hit.x === x && hit.y === y && hit.z === z && getBlockDefinition(hit.block).replaceable === true,
  );
  const attachmentNormal = replaceHit || !hit
    ? { x: 0, y: 1, z: 0 }
    : { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };

  if (hit && !replaceHit && (x !== hit.x || y !== hit.y || z !== hit.z)
    && !canUseAsPlacementAnchor(hit.block)) {
    return { ok: false, reason: 'no-anchor' };
  }

  const placed = getBlockDefinition(blockId);
  const view = ctx.viewDirection();

  if (blockId === BlockId.Lantern) {
    const orientation = lanternPlacementFromHit(attachmentNormal.x, attachmentNormal.y, attachmentNormal.z);
    if (!orientation) return { ok: false, reason: 'lantern-orientation' };
    const hanging = orientation.attachment === 'ceiling';
    const supported = hanging
      ? canSupportHanger(ctx.world, x, y + 1, z, 'down')
      : canSupportHanger(ctx.world, x, y - 1, z, 'up');
    if (!supported) return { ok: false, reason: 'lantern-support' };
    if (playerHitsBoxes(ctx, x, y, z, [lanternSelectionLocalBox(orientation)])) {
      return { ok: false, reason: 'collision' };
    }
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { attachment: orientation.attachment });
    return { ok: true };
  }

  if (blockId === BlockId.Chain) {
    if (!chainPlacementFromHit(attachmentNormal.x, attachmentNormal.y, attachmentNormal.z)) {
      return { ok: false, reason: 'chain-orientation' };
    }
    const hanging = attachmentNormal.y < -0.5;
    const supported = hanging
      ? canSupportHanger(ctx.world, x, y + 1, z, 'down')
      : canSupportHanger(ctx.world, x, y - 1, z, 'up');
    if (!supported) return { ok: false, reason: 'chain-support' };
    if (playerHitsBoxes(ctx, x, y, z, [chainSelectionLocalBox()])) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { attachment: hanging ? 'ceiling' : 'floor' });
    return { ok: true };
  }

  if (['torch', 'button', 'lever', 'ladder'].includes(placed.renderShape)
    && !canAttachToFace(
      ctx.world,
      x - attachmentNormal.x,
      y - attachmentNormal.y,
      z - attachmentNormal.z,
      attachmentNormal,
    )) {
    return { ok: false, reason: 'no-anchor' };
  }
  if (['wire', 'rail', 'pressure_plate', 'door'].includes(placed.renderShape)
    && !canAttachToFace(ctx.world, x, y - 1, z, UP_FACE)) {
    return { ok: false, reason: 'no-anchor' };
  }

  if (blockId === BlockId.OakDoor) {
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    return placeDoor(ctx, x, y, z, existing);
  }

  if (blockId === BlockId.Torch || blockId === BlockId.RedstoneTorch) {
    const orientation = torchPlacementFromHit(
      attachmentNormal.x, attachmentNormal.y, attachmentNormal.z, view.x, view.z,
    );
    if (!orientation) return { ok: false, reason: 'torch-ceiling' };
    if (placed.solid && ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, orientation);
    return { ok: true };
  }

  if (blockId === BlockId.StoneButton) {
    const orientation = buttonPlacementFromHit(
      attachmentNormal.x, attachmentNormal.y, attachmentNormal.z, view.x, view.z,
    );
    if (placed.solid && ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.redstone.setButtonOrientation(x, y, z, orientation.attachment, orientation.facing);
    return { ok: true };
  }

  if (blockId === BlockId.Ladder) {
    const orientation = hit
      ? ladderPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z)
      : ladderPlacementFromHit(attachmentNormal.x, attachmentNormal.y, attachmentNormal.z);
    if (!orientation) return { ok: false, reason: 'ladder-side' };
    if (replaceHit) return { ok: false, reason: 'ladder-replace' };
    if (placed.solid && ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { facing: orientation.facing });
    return { ok: true };
  }

  if (isPressurePlateBlock(blockId)) {
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    return { ok: true };
  }

  if (isSlabBlock(blockId) && hit) {
    const localY = hit.point ? hit.point.y - hit.y : 0.25;
    const slabType = slabTypeFromHit(hit.normal.x, hit.normal.y, hit.normal.z, localY);
    if (playerHitsBoxes(ctx, x, y, z, slabLocalBoxes(slabType))) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { slabType });
    return { ok: true };
  }

  if (isStairBlock(blockId) && hit) {
    const localY = hit.point ? hit.point.y - hit.y : 0.25;
    const placement = stairPlacementFromHit(hit.normal.x, hit.normal.y, hit.normal.z, localY, view.x, view.z);
    if (playerHitsBoxes(ctx, x, y, z, stairLocalBoxes(placement.facing, placement.stairHalf, 'straight'))) {
      return { ok: false, reason: 'collision' };
    }
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { facing: placement.facing, stairHalf: placement.stairHalf });
    return { ok: true };
  }

  if (blockId === BlockId.Chest) {
    if (placed.solid && ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { facing: chestFacingFromYaw(ctx.yaw) });
    return { ok: true };
  }

  if (blockId === BlockId.Furnace) {
    if (placed.solid && ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { facing: furnaceFacingFromYaw(ctx.yaw) });
    return { ok: true };
  }

  if (isRailBlock(blockId)) {
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    ctx.world.setBlockState(x, y, z, { railShape: isolatedRailShapeFromYaw(ctx.yaw) });
    refreshNeighborRails(ctx.world, x, y, z);
    return { ok: true };
  }

  if (isFenceBlock(blockId)) {
    if (ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
    if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
    if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
    return { ok: true };
  }

  if (placed.solid && ctx.intersectsBlock(x, y, z)) return { ok: false, reason: 'collision' };
  if (ctx.allowPlace && !ctx.allowPlace(x, y, z, blockId)) return { ok: false, reason: 'cancelled' };
  if (!commitBlock(ctx, x, y, z, blockId, existing)) return { ok: false, reason: 'rejected' };
  if (blockId === BlockId.Lever) {
    const orientation = buttonPlacementFromHit(
      attachmentNormal.x, attachmentNormal.y, attachmentNormal.z, view.x, view.z,
    );
    ctx.redstone.setLeverOrientation(x, y, z, orientation.attachment, orientation.facing);
  }
  return { ok: true };
}

export function doorHalves(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
): { lowerY: number; upperY: number } {
  const state = world.getBlockState(x, y, z);
  const half = state?.half
    ?? (world.getBlock(x, y - 1, z, false) === BlockId.OakDoor ? 'upper' : 'lower');
  const lowerY = half === 'upper' ? y - 1 : y;
  return { lowerY, upperY: lowerY + 1 };
}

/** Returns true when the door is now open. */
export function toggleDoorState(world: VoxelWorld, x: number, y: number, z: number): boolean {
  const { lowerY, upperY } = doorHalves(world, x, y, z);
  const current = world.getBlockState(x, lowerY, z) ?? world.getBlockState(x, y, z);
  const opening = current?.open !== true;
  const next = {
    facing: current?.facing ?? 'north',
    hinge: current?.hinge ?? 'left' as const,
    open: opening,
  };
  world.setBlockState(x, lowerY, z, { ...next, half: 'lower' });
  if (world.getBlock(x, upperY, z, false) === BlockId.OakDoor) {
    world.setBlockState(x, upperY, z, { ...next, half: 'upper' });
  }
  return opening;
}

export function clearDoorBlocks(world: VoxelWorld, x: number, y: number, z: number): { lowerY: number; upperY: number } {
  const halves = doorHalves(world, x, y, z);
  world.setBlock(x, halves.lowerY, z, BlockId.Air);
  if (world.getBlock(x, halves.upperY, z, false) === BlockId.OakDoor) {
    world.setBlock(x, halves.upperY, z, BlockId.Air);
  }
  return halves;
}

export function refreshNeighborRails(world: VoxelWorld, x: number, y: number, z: number): void {
  const cells = [
    [x, y, z], [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1],
    [x + 1, y + 1, z], [x - 1, y + 1, z], [x, y + 1, z + 1], [x, y + 1, z - 1],
  ];
  for (const [cx, cy, cz] of cells) {
    if (world.getBlock(cx!, cy!, cz!, false) !== BlockId.Rail) continue;
    world.setBlockState(cx!, cy!, cz!, { railShape: resolveRailShape(world, cx!, cy!, cz!) });
  }
}

function resolvePlacingBlockId(ctx: UseSimulationContext, requested: number | undefined): number | undefined {
  if (ctx.gamemode === 'creative' && requested !== undefined && isKnownBlockId(requested) && requested !== BlockId.Air) {
    return requested;
  }
  const stack = ctx.inventory.getSlot(ctx.selectedSlot);
  return stack ? tryGetItemDefinition(stack.itemId)?.placesBlockId : undefined;
}

function commitBlock(
  ctx: UseSimulationContext,
  x: number,
  y: number,
  z: number,
  blockId: number,
  previous: number,
): boolean {
  if (ctx.gamemode === 'survival' && !ctx.inventory.getSlot(ctx.selectedSlot)) return false;
  if (!ctx.world.setBlock(x, y, z, blockId)) return false;
  ctx.redstone.notifyBlockChanged(x, y, z);
  ctx.effects?.playBlock?.('place', blockId, x, y, z);
  ctx.effects?.swing?.();
  if (ctx.gamemode === 'survival') {
    const stack = ctx.inventory.getSlot(ctx.selectedSlot);
    if (!stack) {
      ctx.world.setBlock(x, y, z, previous);
      return false;
    }
    consumeHeld(ctx, 1);
  }
  ctx.effects?.onPlaced?.(x, y, z, blockId);
  return true;
}

function consumeHeld(ctx: UseSimulationContext, count: number): void {
  const stack = ctx.inventory.getSlot(ctx.selectedSlot);
  if (!stack) return;
  ctx.inventory.setSlot(
    ctx.selectedSlot,
    stack.count <= count ? null : { ...stack, count: stack.count - count },
  );
  ctx.effects?.onInventoryChanged?.();
}

function wearHeld(ctx: UseSimulationContext): void {
  const stack = ctx.inventory.getSlot(ctx.selectedSlot);
  if (!stack) return;
  ctx.inventory.setSlot(ctx.selectedSlot, damageItem(stack, 1));
  ctx.effects?.onInventoryChanged?.();
}

function playerHitsBoxes(
  ctx: UseSimulationContext,
  x: number,
  y: number,
  z: number,
  locals: readonly CollisionBox[],
): boolean {
  return ctx.intersectsCollisionBoxes(locals.map((box) => ({
    minX: x + box.minX,
    minY: y + box.minY,
    minZ: z + box.minZ,
    maxX: x + box.maxX,
    maxY: y + box.maxY,
    maxZ: z + box.maxZ,
  })));
}

function tryMergeSlab(
  ctx: UseSimulationContext,
  hit: VoxelHit,
  placing: number,
): 'merged' | 'blocked' | 'skip' {
  if (!isSlabBlock(placing) || hit.block !== placing) return 'skip';
  const existing = defaultSlabType(ctx.world.getBlockState(hit.x, hit.y, hit.z));
  if (existing === 'double') return 'skip';
  const ny = hit.normal.y;
  const merge = (existing === 'bottom' && ny > 0.5) || (existing === 'top' && ny < -0.5);
  if (!merge) return 'skip';
  return mergeSlab(ctx, hit.x, hit.y, hit.z);
}

function tryMergeSlabAt(
  ctx: UseSimulationContext,
  x: number,
  y: number,
  z: number,
  placing: number,
): 'merged' | 'blocked' | 'skip' {
  const dest = ctx.world.getBlock(x, y, z, false);
  if (!isSlabBlock(placing) || dest !== placing) return 'skip';
  if (defaultSlabType(ctx.world.getBlockState(x, y, z)) === 'double') return 'skip';
  return mergeSlab(ctx, x, y, z);
}

function mergeSlab(
  ctx: UseSimulationContext,
  x: number,
  y: number,
  z: number,
): 'merged' | 'blocked' {
  if (playerHitsBoxes(ctx, x, y, z, slabLocalBoxes('double'))) return 'blocked';
  ctx.world.setBlockState(x, y, z, { slabType: 'double' });
  ctx.redstone.notifyBlockChanged(x, y, z);
  ctx.effects?.playBlock?.('place', ctx.world.getBlock(x, y, z, false), x, y, z);
  ctx.effects?.swing?.();
  if (ctx.gamemode === 'survival') consumeHeld(ctx, 1);
  return 'merged';
}

function placeDoor(
  ctx: UseSimulationContext,
  x: number,
  y: number,
  z: number,
  previous: number,
): PlaceResult {
  if (y + 1 >= WORLD_HEIGHT) return { ok: false, reason: 'door-space' };
  const upperBlock = ctx.world.getBlock(x, y + 1, z);
  const upperDefinition = getBlockDefinition(upperBlock);
  if (upperBlock !== BlockId.Air && !upperDefinition.replaceable) return { ok: false, reason: 'door-space' };
  if (ctx.intersectsBlock(x, y, z) || ctx.intersectsBlock(x, y + 1, z)) return { ok: false, reason: 'collision' };
  if (ctx.gamemode === 'survival' && !ctx.inventory.getSlot(ctx.selectedSlot)) {
    return { ok: false, reason: 'inventory' };
  }
  if (!ctx.world.setBlock(x, y, z, BlockId.OakDoor)) return { ok: false, reason: 'rejected' };
  if (!ctx.world.setBlock(x, y + 1, z, BlockId.OakDoor)) {
    ctx.world.setBlock(x, y, z, previous);
    return { ok: false, reason: 'rejected' };
  }
  const facing = doorFacingFromYaw(ctx.yaw);
  ctx.world.setBlockState(x, y, z, { facing, hinge: 'left', open: false, half: 'lower' });
  ctx.world.setBlockState(x, y + 1, z, { facing, hinge: 'left', open: false, half: 'upper' });
  ctx.redstone.notifyBlockChanged(x, y, z);
  ctx.redstone.notifyBlockChanged(x, y + 1, z);
  ctx.effects?.playBlock?.('place', BlockId.OakDoor, x, y, z);
  ctx.effects?.swing?.();
  if (ctx.gamemode === 'survival') consumeHeld(ctx, 1);
  return { ok: true };
}

function applyEmptyBucket(
  ctx: UseSimulationContext,
  origin: Vec3Like,
  direction: Vec3Like,
): void {
  const changed = pickupFluidSource(bucketContext(ctx), origin, direction, ctx.reach);
  if (!changed) return;
  ctx.redstone.notifyBlockChanged(changed.x, changed.y, changed.z);
  if (changed.block === BlockId.Water) {
    ctx.effects?.playWorld?.('water.splash', changed.x + 0.5, changed.y + 0.5, changed.z + 0.5);
  }
  ctx.effects?.swing?.();
  ctx.effects?.onInventoryChanged?.();
}

function applyFilledBucket(ctx: UseSimulationContext, hit: VoxelHit | undefined): void {
  const changed = placeBucketFluid(bucketContext(ctx), hit);
  if (!changed) return;
  ctx.redstone.notifyBlockChanged(changed.x, changed.y, changed.z);
  if (changed.block === BlockId.Water) {
    ctx.effects?.playWorld?.('water.splash', changed.x + 0.5, changed.y + 0.5, changed.z + 0.5);
  }
  ctx.effects?.swing?.();
  ctx.effects?.onInventoryChanged?.();
}

function bucketContext(ctx: UseSimulationContext) {
  return {
    world: ctx.world,
    inventory: ctx.inventory,
    selectedSlot: ctx.selectedSlot,
    mode: ctx.gamemode,
    onDrop: (stack: ItemStack) => ctx.effects?.dropOverflow?.(stack),
  };
}

function applyFlint(
  ctx: UseSimulationContext,
  origin: Vec3Like,
  direction: Vec3Like,
  hit: VoxelHit | undefined,
): void {
  const cart = ctx.minecarts.handleFlintUse(origin, direction, ctx.reach, ctx.ridingCartId);
  const action = resolveFlintAndSteelUse(cart, hit);
  if (action.type === 'prime-cart') {
    if (ctx.gamemode === 'survival') wearHeld(ctx);
    ctx.effects?.onFlintIgnite?.();
    return;
  }
  if (action.type === 'already-primed') {
    ctx.effects?.onFlintAlreadyPrimed?.();
    return;
  }
  if (action.type === 'prime-tnt-block') {
    ctx.redstone.primeTnt(action.x, action.y, action.z);
    if (ctx.gamemode === 'survival') wearHeld(ctx);
    ctx.effects?.onFlintIgnite?.();
    return;
  }
  if (action.type === 'ignite-cell' && isValidWorldY(action.y) && igniteCell(ctx, action.x, action.y, action.z)) {
    if (ctx.gamemode === 'survival') wearHeld(ctx);
    ctx.effects?.onFlintIgnite?.();
  }
}

function igniteCell(ctx: UseSimulationContext, x: number, y: number, z: number): boolean {
  const block = ctx.world.getBlock(x, y, z, false);
  if (block === BlockId.Tnt) {
    ctx.redstone.primeTnt(x, y, z);
    return true;
  }
  const definition = getBlockDefinition(block);
  if (block !== BlockId.Air && definition.replaceable !== true) return false;
  return ctx.world.setBlock(x, y, z, BlockId.Fire);
}

function insertTntCart(
  ctx: UseSimulationContext,
  hit: VoxelHit | undefined,
  origin: Vec3Like,
  direction: Vec3Like,
): boolean {
  const cart = ctx.minecarts.raycast(origin, direction, ctx.reach, ctx.ridingCartId)?.cart
    ?? (hit ? ctx.minecarts.cartAt(hit.x, hit.y, hit.z) : ctx.minecarts.nearest(ctx.position, 1.6));
  if (!cart || !ctx.minecarts.insertTnt(cart)) return false;
  ctx.effects?.playBlock?.('place', BlockId.Tnt, cart.position.x, cart.position.y, cart.position.z);
  ctx.effects?.swing?.();
  if (ctx.gamemode === 'survival') consumeHeld(ctx, 1);
  if (ctx.ridingCartId === cart.id) ctx.ridingCartId = undefined;
  ctx.effects?.onInventoryChanged?.();
  return true;
}

function placeMinecartOnRail(ctx: UseSimulationContext, hit: VoxelHit | undefined): void {
  if (!hit) return;
  const x = hit.block === BlockId.Rail ? hit.x : hit.x + hit.normal.x;
  const y = hit.block === BlockId.Rail ? hit.y : hit.y + hit.normal.y;
  const z = hit.block === BlockId.Rail ? hit.z : hit.z + hit.normal.z;
  if (ctx.world.getBlock(x, y, z, false) !== BlockId.Rail) {
    toastPlaceFail(ctx, 'minecart-rails');
    return;
  }
  if (!ctx.minecarts.spawn(x, y, z)) return;
  ctx.effects?.playBlock?.('place', BlockId.Rail, x, y, z);
  ctx.effects?.swing?.();
  if (ctx.gamemode === 'survival') consumeHeld(ctx, 1);
}

function toastPlaceFail(ctx: UseSimulationContext, reason: PlaceFailReason): void {
  const message = placeFailToast(reason);
  if (message) ctx.effects?.toast?.(message);
}
