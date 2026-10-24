import { ItemId } from '../../src/items/types';

/** Stage 3C quantity watch list. Iron is included because ruby crafting consumes it. */
export const MONITORED_RESOURCE_IDS = [
  ItemId.Diamond,
  ItemId.GoldIngot,
  ItemId.RubyIngot,
  ItemId.TitaniumIngot,
  ItemId.IronIngot,
] as const;

export type MonitoredResourceId = (typeof MONITORED_RESOURCE_IDS)[number];

const MONITORED = new Set<string>(MONITORED_RESOURCE_IDS);

export function isMonitoredResource(itemId: string | undefined | null): itemId is MonitoredResourceId {
  return typeof itemId === 'string' && MONITORED.has(itemId);
}

export function emptyResourceCounts(): Record<MonitoredResourceId, number> {
  return {
    [ItemId.Diamond]: 0,
    [ItemId.GoldIngot]: 0,
    [ItemId.RubyIngot]: 0,
    [ItemId.TitaniumIngot]: 0,
    [ItemId.IronIngot]: 0,
  };
}
