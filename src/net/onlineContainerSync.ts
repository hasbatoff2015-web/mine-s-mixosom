import { createItemStack, type ItemStack } from '../inventory';
import type { ContainerKind } from '../../shared/protocol';
import type { VoxelWorld } from '../world/World';

/** Window payload on server `inventory` messages. */
export interface AuthoritativeWindowPayload {
  readonly kind?: ContainerKind;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly slots?: unknown;
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
 * Always apply — including while the container GUI is already open.
 */
export function applyAuthoritativeContainerSlots(
  world: VoxelWorld,
  window: AuthoritativeWindowPayload | undefined,
  parseStack: (value: unknown) => ItemStack | null = parseNetworkItemStack,
): boolean {
  if (!window || (window.kind !== 'chest' && window.kind !== 'furnace')) return false;
  if (window.x === undefined || window.y === undefined || window.z === undefined) return false;
  const slots = window.slots;
  if (!Array.isArray(slots)) return false;
  if (window.kind === 'chest') {
    const chest = world.getChest(window.x, window.y, window.z);
    chest.slots = Array.from({ length: 27 }, (_, index) => parseStack(slots[index]) ?? null);
    return true;
  }
  const furnace = world.getFurnace(window.x, window.y, window.z);
  const parsed = slots.map((entry) => parseStack(entry));
  furnace.slots = [parsed[0] ?? null, parsed[1] ?? null, parsed[2] ?? null];
  return true;
}

/** Open the GUI only on the first snapshot. Later snapshots must refresh in place. */
export function shouldOpenOnlineContainer(
  windowKind: ContainerKind | undefined,
  inventoryGuiOpen: boolean,
): boolean {
  return Boolean(windowKind && windowKind !== 'inventory' && !inventoryGuiOpen);
}
