/**
 * Shared semantic gameplay events.
 *
 * This catalog is server-agnostic. Shared simulation must not import
 * the plugin runtime, EventBus, WebSocket, or the renderer.
 *
 * Server maps these names onto `server/events.ts` via `PluginEventAdapter`.
 * Singleplayer does not subscribe; `IGNORE_SIMULATION_EVENTS` is the no-op sink.
 *
 * Payloads are identifiers, positions, item ids, and numeric amounts.
 * Never Mesh, Object3D, DOM, sockets, or IndexedDB handles.
 */

export const SIMULATION_EVENT_KINDS = [
  'player-join',
  'player-quit',
  'player-move',
  'block-break',
  'block-broken',
  'block-place',
  'block-placed',
  'player-damage',
  'player-damaged',
  'entity-damage',
  'entity-damaged',
  'entity-death',
  'item-drop',
  'item-pickup',
  'craft',
  'player-interact',
  'projectile-hit',
  'explosion',
  'fluid-update',
  'player-command',
  'player-command-executed',
  'vehicle-enter',
  'vehicle-exit',
] as const;

export type SimulationEventKind = (typeof SIMULATION_EVENT_KINDS)[number];

/** Pre-mutation hooks that the Anarchy host can cancel. */
export const SIMULATION_PRE_EVENTS = [
  'player-move',
  'block-break',
  'block-place',
  'player-damage',
  'entity-damage',
  'item-drop',
  'item-pickup',
  'player-interact',
  'explosion',
  'player-command',
  'vehicle-enter',
  'vehicle-exit',
] as const;

export type SimulationPreEvent = (typeof SIMULATION_PRE_EVENTS)[number];

/** Observation after a successful authoritative mutation. Not cancellable. */
export const SIMULATION_POST_EVENTS = [
  'player-join',
  'player-quit',
  'block-broken',
  'block-placed',
  'player-damaged',
  'entity-damaged',
  'entity-death',
  'craft',
  'projectile-hit',
  'fluid-update',
  'player-command-executed',
] as const;

export type SimulationPostEvent = (typeof SIMULATION_POST_EVENTS)[number];

export interface SimulationBlockPayload {
  readonly playerId?: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface SimulationDamagePayload {
  readonly entityId: string;
  readonly amount: number;
  readonly cause: string;
  readonly playerId?: string;
}

/**
 * Host-owned sink. Shared code may call this; it must not know about plugins.
 * `emitPre` returns false when a subscriber cancelled the action.
 * Decision points are synchronous. Implementations must not await.
 */
export interface SimulationEventSink {
  emitPre(kind: SimulationPreEvent, payload: object): boolean;
  emitPost(kind: SimulationPostEvent, payload: object): void;
}

/** Singleplayer and tests that do not run plugins. */
export const IGNORE_SIMULATION_EVENTS: SimulationEventSink = {
  emitPre: () => true,
  emitPost: () => {},
};
