import { assignPortalChestSlots, createItemStack, type ItemStack, type PortalChestInventory } from '../inventory';
import type { ContainerKind } from '../../shared/protocol';
import type { VoxelWorld } from '../world/World';

/** Window payload on server `inventory` messages. */
export interface AuthoritativeWindowPayload {
  readonly kind?: ContainerKind;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly slots?: unknown;
  readonly burnTime?: number;
  readonly burnTotal?: number;
  readonly cookTime?: number;
}

export interface FurnaceSyncPayload {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly slots: unknown;
  readonly burnTime: number;
  readonly burnTotal: number;
  readonly cookTime: number;
}

export function parseNetworkItemStack(value: unknown): ItemStack | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { itemId?: unknown; count?: unknown };
  if (typeof record.itemId !== 'string' || typeof record.count !== 'number') return null;
  try {
    return createItemStack(record.itemId, record.count);
  } catch {
    return null;
  }
}

export function parseNetworkItemStacks(value: unknown): Array<ItemStack | null> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => parseNetworkItemStack(entry));
}

/**
 * Copy server chest/furnace slots onto the local world object the open GUI reads.
 * Portal-chest slots go onto the player's personal store, never the block.
 * Always apply — including while the container GUI is already open.
 */
export function applyAuthoritativeContainerSlots(
  world: VoxelWorld,
  window: AuthoritativeWindowPayload | undefined,
  parseStack: (value: unknown) => ItemStack | null = parseNetworkItemStack,
  portalChest?: PortalChestInventory,
): boolean {
  if (!window) return false;
  const slots = window.slots;
  if (window.kind === 'portal-chest') {
    if (!portalChest || !Array.isArray(slots)) return false;
    assignPortalChestSlots(portalChest, slots.map((entry) => parseStack(entry)));
    return true;
  }
  if (window.kind !== 'chest' && window.kind !== 'furnace') return false;
  if (window.x === undefined || window.y === undefined || window.z === undefined) return false;
  if (!Array.isArray(slots)) return false;
  if (window.kind === 'chest') {
    const chest = world.getChest(window.x, window.y, window.z);
    chest.slots = Array.from({ length: 27 }, (_, index) => parseStack(slots[index]) ?? null);
    return true;
  }
  const furnace = world.getFurnace(window.x, window.y, window.z);
  const wasBurning = furnace.burnTime > 0;
  const parsed = slots.map((entry) => parseStack(entry));
  furnace.slots = [parsed[0] ?? null, parsed[1] ?? null, parsed[2] ?? null];
  applyFurnaceTimers(furnace, window);
  world.syncFurnaceBurnBit(window.x, window.y, window.z, wasBurning);
  return true;
}

function finiteTick(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function applyFurnaceTimers(
  furnace: { burnTime: number; burnTotal: number; cookTime: number },
  source: { readonly burnTime?: unknown; readonly burnTotal?: unknown; readonly cookTime?: unknown },
): void {
  const burnTime = finiteTick(source.burnTime);
  const burnTotal = finiteTick(source.burnTotal);
  const cookTime = finiteTick(source.cookTime);
  if (burnTime !== undefined) furnace.burnTime = burnTime;
  if (burnTotal !== undefined) furnace.burnTotal = burnTotal;
  if (cookTime !== undefined) furnace.cookTime = cookTime;
}

/** Copy an authoritative furnace tick onto the world object the open GUI reads. */
export function applyFurnaceSync(
  world: VoxelWorld,
  message: FurnaceSyncPayload,
  parseStack: (value: unknown) => ItemStack | null = parseNetworkItemStack,
): boolean {
  if (!Number.isInteger(message.x) || !Number.isInteger(message.y) || !Number.isInteger(message.z)) return false;
  if (!Array.isArray(message.slots)) return false;
  const furnace = world.getFurnace(message.x, message.y, message.z);
  const wasBurning = furnace.burnTime > 0;
  const parsed = message.slots.map((entry) => parseStack(entry));
  furnace.slots = [parsed[0] ?? null, parsed[1] ?? null, parsed[2] ?? null];
  applyFurnaceTimers(furnace, message);
  world.syncFurnaceBurnBit(message.x, message.y, message.z, wasBurning);
  return true;
}

/** Open the GUI only on the first snapshot. Later snapshots must refresh in place. */
export function shouldOpenOnlineContainer(
  windowKind: ContainerKind | undefined,
  inventoryGuiOpen: boolean,
): boolean {
  return Boolean(windowKind && windowKind !== 'inventory' && !inventoryGuiOpen);
}
