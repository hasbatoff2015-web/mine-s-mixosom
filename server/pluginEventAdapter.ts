/**
 * Server adapter: shared semantic events → plugin EventBus.
 *
 * Shared Game Core stays free of PluginManager. This module is server-only.
 */

import {
  SIMULATION_POST_EVENTS,
  SIMULATION_PRE_EVENTS,
  type SimulationEventSink,
  type SimulationPostEvent,
  type SimulationPreEvent,
} from '../src/gameplay/simulationEvents';
import type { EventBus, ServerEventName, ServerEvents } from './events';

const PRE_TO_BUS: Record<SimulationPreEvent, ServerEventName> = {
  'player-move': 'playerMove',
  'block-break': 'blockBreak',
  'block-place': 'blockPlace',
  'player-damage': 'playerDamage',
  'entity-damage': 'entityDamage',
  'item-drop': 'itemDrop',
  'item-pickup': 'itemPickup',
  'player-interact': 'playerInteract',
  'explosion': 'explosion',
  'player-command': 'playerCommand',
  'vehicle-enter': 'vehicleEnter',
  'vehicle-exit': 'vehicleExit',
  'mob-spawn': 'mobSpawn',
};

const POST_TO_BUS: Record<SimulationPostEvent, ServerEventName> = {
  'player-join': 'playerJoin',
  'player-quit': 'playerQuit',
  'block-broken': 'blockBroken',
  'block-placed': 'blockPlaced',
  'player-damaged': 'playerDamaged',
  'entity-damaged': 'entityDamaged',
  'entity-death': 'entityDeath',
  'craft': 'craft',
  'projectile-hit': 'projectileHit',
  'fluid-update': 'fluidUpdate',
  'player-command-executed': 'playerCommandExecuted',
};

export function toServerEventName(kind: SimulationPreEvent | SimulationPostEvent): ServerEventName {
  if ((SIMULATION_PRE_EVENTS as readonly string[]).includes(kind)) {
    return PRE_TO_BUS[kind as SimulationPreEvent];
  }
  return POST_TO_BUS[kind as SimulationPostEvent];
}

export class PluginEventAdapter implements SimulationEventSink {
  constructor(private readonly events: EventBus) {}

  emitPre(kind: SimulationPreEvent, payload: object): boolean {
    const name = PRE_TO_BUS[kind];
    const event = payload as ServerEvents[typeof name];
    this.events.emit(name, event);
    return !('cancelled' in event && (event as { cancelled: boolean }).cancelled);
  }

  emitPost(kind: SimulationPostEvent, payload: object): void {
    const name = POST_TO_BUS[kind];
    this.events.emit(name, payload as ServerEvents[typeof name]);
  }
}

export { SIMULATION_POST_EVENTS, SIMULATION_PRE_EVENTS };
