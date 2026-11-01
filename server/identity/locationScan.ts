import { requiresUniqueItemIdentity, readItemInstanceId } from '../../src/inventory/itemInstance';
import type { ItemStack } from '../../src/inventory/types';

/**
 * One physical holder of a Stage 3A item. This is a current location, not a
 * movement history. Save mirrors and settlement payloads are not locations.
 */
export type UniqueItemKind =
  | 'player-inventory'
  | 'player-cursor'
  | 'player-craft'
  | 'player-equipment'
  | 'player-offhand'
  | 'player-portal-chest'
  | 'player-held-return'
  | 'world-chest'
  | 'world-furnace'
  | 'world-drop'
  | 'placed-painting'
  | 'auction'
  | 'trade-offer'
  | 'buyer-window'
  | 'buyer-return';

export interface UniqueItemLocation {
  readonly worldId: string;
  readonly itemInstanceId: string;
  readonly itemId: string;
  readonly kind: UniqueItemKind;
  readonly playerId?: string;
  readonly slot?: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly dropEntityId?: string;
  readonly listingId?: string;
  readonly tradeId?: string;
  readonly buyerPlayerId?: string;
  /** A settlement in progress. Not enough, by itself, to confirm a duplicate. */
  readonly transitional?: boolean;
}

export type IdentityFindingStatus = 'confirmed-duplicate' | 'identity-type-conflict' | 'transitional';

export interface IdentityFinding {
  readonly itemInstanceId: string;
  readonly itemIds: readonly string[];
  readonly status: IdentityFindingStatus;
  readonly locations: readonly UniqueItemLocation[];
}

export interface IdentityPlayerStacks {
  readonly playerId: string;
  readonly inventory: readonly (ItemStack | null | undefined)[];
  readonly armor: Readonly<Partial<Record<'head' | 'chest' | 'legs' | 'feet', ItemStack | null>>>;
  readonly offhand?: ItemStack | null;
  readonly cursor?: ItemStack | null;
  readonly craft: readonly (ItemStack | null | undefined)[];
  readonly portal: readonly (ItemStack | null | undefined)[];
  readonly heldReturns: readonly (ItemStack | null | undefined)[];
}

export interface IdentityScanInput {
  readonly worldId: string;
  readonly players: readonly IdentityPlayerStacks[];
  readonly chests: readonly { readonly x: number; readonly y: number; readonly z: number; readonly slots: readonly (ItemStack | null | undefined)[] }[];
  readonly furnaces: readonly { readonly x: number; readonly y: number; readonly z: number; readonly slots: readonly (ItemStack | null | undefined)[] }[];
  readonly drops: readonly { readonly entityId: string; readonly stack: ItemStack | null | undefined }[];
  readonly paintings: readonly { readonly x: number; readonly y: number; readonly z: number; readonly itemId: string; readonly instanceId: string }[];
  readonly auctions: readonly {
    readonly listingId: string;
    readonly status: string;
    readonly sellerPlayerId?: string;
    readonly item: ItemStack | null | undefined;
  }[];
  readonly trades: readonly { readonly tradeId: string; readonly settling: boolean; readonly playerId: string; readonly slot: number; readonly stack: ItemStack | null | undefined }[];
  readonly buyerWindows: readonly { readonly playerId: string; readonly stack: ItemStack | null | undefined }[];
  readonly buyerReturns: readonly { readonly playerId: string; readonly index: number; readonly stack: ItemStack | null | undefined }[];
}

export interface IdentityReport {
  readonly worldId: string;
  readonly locations: readonly UniqueItemLocation[];
  readonly findings: readonly IdentityFinding[];
  readonly skippedMalformed: number;
}

export const IDENTITY_TRANSFER_BLOCKED = 'Этот уникальный предмет сейчас нельзя передать.';

const FURNACE_SLOTS = ['input', 'fuel', 'result'] as const;

export function scanIdentity(input: IdentityScanInput): IdentityReport {
  const locations: UniqueItemLocation[] = [];
  let skippedMalformed = 0;
  const note = (stack: ItemStack | null | undefined, location: Omit<UniqueItemLocation, 'itemInstanceId' | 'itemId'>): void => {
    try {
      const read = readTracked(stack);
      if (read === 'skip') return;
      if (read === 'malformed') {
        skippedMalformed += 1;
        return;
      }
      locations.push({ ...location, itemId: read.itemId, itemInstanceId: read.instanceId });
    } catch {
      skippedMalformed += 1;
    }
  };

  for (const player of input.players) {
    player.inventory.forEach((stack, index) => note(stack, {
      worldId: input.worldId, kind: 'player-inventory', playerId: player.playerId, slot: String(index),
    }));
    for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
      note(player.armor[slot], {
        worldId: input.worldId, kind: 'player-equipment', playerId: player.playerId, slot,
      });
    }
    note(player.offhand, { worldId: input.worldId, kind: 'player-offhand', playerId: player.playerId, slot: 'offhand' });
    note(player.cursor, { worldId: input.worldId, kind: 'player-cursor', playerId: player.playerId, slot: 'cursor' });
    player.craft.forEach((stack, index) => note(stack, {
      worldId: input.worldId, kind: 'player-craft', playerId: player.playerId, slot: String(index),
    }));
    player.portal.forEach((stack, index) => note(stack, {
      worldId: input.worldId, kind: 'player-portal-chest', playerId: player.playerId, slot: String(index),
    }));
    player.heldReturns.forEach((stack, index) => note(stack, {
      worldId: input.worldId, kind: 'player-held-return', playerId: player.playerId, slot: String(index),
    }));
  }
  for (const chest of input.chests) {
    chest.slots.forEach((stack, index) => note(stack, {
      worldId: input.worldId, kind: 'world-chest', x: chest.x, y: chest.y, z: chest.z, slot: String(index),
    }));
  }
  for (const furnace of input.furnaces) {
    furnace.slots.forEach((stack, index) => note(stack, {
      worldId: input.worldId,
      kind: 'world-furnace',
      x: furnace.x,
      y: furnace.y,
      z: furnace.z,
      slot: FURNACE_SLOTS[index] ?? String(index),
    }));
  }
  for (const drop of input.drops) {
    note(drop.stack, { worldId: input.worldId, kind: 'world-drop', dropEntityId: drop.entityId });
  }
  for (const painting of input.paintings) {
    if (!requiresUniqueItemIdentity(painting.itemId) || !readItemInstanceId({ metadata: { itemInstanceId: painting.instanceId } })) {
      continue;
    }
    locations.push({
      worldId: input.worldId,
      kind: 'placed-painting',
      itemId: painting.itemId,
      itemInstanceId: painting.instanceId.toLowerCase(),
      x: painting.x,
      y: painting.y,
      z: painting.z,
    });
  }
  for (const listing of input.auctions) {
    note(listing.item, {
      worldId: input.worldId,
      kind: 'auction',
      listingId: listing.listingId,
      playerId: listing.sellerPlayerId,
      transitional: listing.status === 'PENDING_ESCROW',
    });
  }
  for (const offer of input.trades) {
    note(offer.stack, {
      worldId: input.worldId,
      kind: 'trade-offer',
      tradeId: offer.tradeId,
      playerId: offer.playerId,
      slot: String(offer.slot),
      transitional: offer.settling,
    });
  }
  for (const window of input.buyerWindows) {
    note(window.stack, {
      worldId: input.worldId, kind: 'buyer-window', buyerPlayerId: window.playerId, playerId: window.playerId,
    });
  }
  for (const pending of input.buyerReturns) {
    note(pending.stack, {
      worldId: input.worldId,
      kind: 'buyer-return',
      buyerPlayerId: pending.playerId,
      playerId: pending.playerId,
      slot: String(pending.index),
    });
  }

  locations.sort(compareLocations);
  return { worldId: input.worldId, locations, findings: findingsFor(locations), skippedMalformed };
}

export function locationsFor(report: IdentityReport, instanceId: string): readonly UniqueItemLocation[] {
  const id = instanceId.toLowerCase();
  return report.locations.filter((location) => location.itemInstanceId === id);
}

function findingsFor(locations: readonly UniqueItemLocation[]): IdentityFinding[] {
  const groups = new Map<string, UniqueItemLocation[]>();
  for (const location of locations) {
    const group = groups.get(location.itemInstanceId) ?? [];
    group.push(location);
    groups.set(location.itemInstanceId, group);
  }
  const findings: IdentityFinding[] = [];
  for (const [itemInstanceId, group] of groups) {
    if (group.length < 2) continue;
    const itemIds = [...new Set(group.map((location) => location.itemId))].sort();
    const stable = group.filter((location) => location.transitional !== true);
    const status: IdentityFindingStatus = itemIds.length > 1
      ? 'identity-type-conflict'
      : stable.length >= 2
        ? 'confirmed-duplicate'
        : 'transitional';
    findings.push({ itemInstanceId, itemIds, status, locations: group });
  }
  findings.sort((a, b) => a.itemInstanceId.localeCompare(b.itemInstanceId));
  return findings;
}

function readTracked(stack: ItemStack | null | undefined): { itemId: string; instanceId: string } | 'skip' | 'malformed' {
  if (stack == null) return 'skip';
  if (typeof stack !== 'object' || typeof stack.itemId !== 'string' || !Number.isInteger(stack.count)) return 'malformed';
  if (!requiresUniqueItemIdentity(stack.itemId)) return 'skip';
  const instanceId = readItemInstanceId(stack);
  if (!instanceId) return 'skip';
  return { itemId: stack.itemId, instanceId };
}

function compareLocations(a: UniqueItemLocation, b: UniqueItemLocation): number {
  return locationKey(a).localeCompare(locationKey(b));
}

export function locationKey(location: UniqueItemLocation): string {
  return [
    location.worldId,
    location.itemInstanceId,
    location.kind,
    location.playerId ?? '',
    location.slot ?? '',
    location.x ?? '',
    location.y ?? '',
    location.z ?? '',
    location.dropEntityId ?? '',
    location.listingId ?? '',
    location.tradeId ?? '',
    location.buyerPlayerId ?? '',
    location.transitional ? 'transitional' : '',
  ].join('|');
}
