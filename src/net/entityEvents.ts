import type { NetworkEntityEvent } from '../../shared/protocol';

export function applyEntityEventsToIds(
  events: readonly NetworkEntityEvent[],
  apply: (event: NetworkEntityEvent) => void,
): void {
  for (const event of events) apply(event);
}

export function eventsForEntity(
  events: readonly NetworkEntityEvent[],
  entityId: string,
): NetworkEntityEvent[] {
  return events.filter((event) => event.entityId === entityId);
}
