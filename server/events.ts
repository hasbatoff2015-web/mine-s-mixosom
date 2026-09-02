import { serverLog } from './log';

export interface Cancellable {
  cancelled: boolean;
  cancel(): void;
}

/** Pre-mutation events that plugins may cancel before the world changes. */
export const PRE_CANCELLABLE_EVENTS = [
  'playerMove',
  'blockBreak',
  'blockPlace',
  'playerDamage',
  'entityDamage',
  'itemDrop',
  'itemPickup',
  'playerInteract',
  'explosion',
  'playerCommand',
  'vehicleEnter',
  'vehicleExit',
] as const;

export type PreCancellableEventName = (typeof PRE_CANCELLABLE_EVENTS)[number];

/**
 * Post-mutation observation. Cancel is ignored (these payloads are not Cancellable).
 * `craft` is listed here: the inventory transaction already committed.
 */
export const POST_OBSERVATION_EVENTS = [
  'playerJoin',
  'playerQuit',
  'blockBroken',
  'blockPlaced',
  'playerDamaged',
  'entityDamaged',
  'entityDeath',
  'craft',
  'projectileHit',
  'fluidUpdate',
  'playerCommandExecuted',
] as const;

function cancellable<T extends object>(extra: T): T & Cancellable {
  const event = {
    cancelled: false,
    cancel() {
      event.cancelled = true;
    },
    ...extra,
  };
  return event;
}

export interface PlayerJoinEvent {
  readonly playerId: string;
  readonly name: string;
}

export interface PlayerQuitEvent {
  readonly playerId: string;
  readonly name: string;
}

export interface PlayerMoveEvent extends Cancellable {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlockBreakEvent extends Cancellable {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface BlockPlaceEvent extends Cancellable {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface BlockBrokenEvent {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface BlockPlacedEvent {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface PlayerDamageEvent extends Cancellable {
  readonly playerId: string;
  readonly amount: number;
  readonly cause: string;
}

export interface EntityDamageEvent extends Cancellable {
  readonly entityId: string;
  readonly amount: number;
  readonly cause: string;
}

export interface EntityDeathEvent {
  readonly entityId: string;
  readonly cause: string;
  readonly playerId?: string;
}

export interface PlayerDamagedEvent {
  readonly playerId: string;
  readonly amount: number;
  readonly cause: string;
}

export interface EntityDamagedEvent {
  readonly entityId: string;
  readonly amount: number;
  readonly cause: string;
}

export interface ItemDropEvent extends Cancellable {
  readonly playerId?: string;
  readonly itemId: string;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ItemPickupEvent extends Cancellable {
  readonly playerId: string;
  readonly entityId: string;
  readonly itemId: string;
  readonly count: number;
}

export interface CraftEvent extends Cancellable {
  readonly playerId: string;
  readonly recipeId?: string;
  readonly outputId: string;
  readonly count: number;
}

export interface PlayerInteractEvent extends Cancellable {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface ProjectileHitEvent {
  readonly entityId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly playerId?: string;
}

export interface ExplosionEvent extends Cancellable {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly power: number;
}

export interface FluidUpdateEvent {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
}

export interface PlayerCommandEvent extends Cancellable {
  readonly playerId: string;
  readonly command: string;
}

export interface PlayerCommandExecutedEvent {
  readonly playerId: string;
  readonly command: string;
  readonly ok: boolean;
}

export interface VehicleEnterEvent extends Cancellable {
  readonly playerId: string;
  readonly entityId: string;
}

export interface VehicleExitEvent extends Cancellable {
  readonly playerId: string;
  readonly entityId: string;
}

export interface ServerEvents {
  playerJoin: PlayerJoinEvent;
  playerQuit: PlayerQuitEvent;
  playerMove: PlayerMoveEvent;
  blockBreak: BlockBreakEvent;
  blockBroken: BlockBrokenEvent;
  blockPlace: BlockPlaceEvent;
  blockPlaced: BlockPlacedEvent;
  playerDamage: PlayerDamageEvent;
  playerDamaged: PlayerDamagedEvent;
  entityDamage: EntityDamageEvent;
  entityDamaged: EntityDamagedEvent;
  entityDeath: EntityDeathEvent;
  itemDrop: ItemDropEvent;
  itemPickup: ItemPickupEvent;
  craft: CraftEvent;
  playerInteract: PlayerInteractEvent;
  projectileHit: ProjectileHitEvent;
  explosion: ExplosionEvent;
  fluidUpdate: FluidUpdateEvent;
  playerCommand: PlayerCommandEvent;
  playerCommandExecuted: PlayerCommandExecutedEvent;
  vehicleEnter: VehicleEnterEvent;
  vehicleExit: VehicleExitEvent;
}

export type ServerEventName = keyof ServerEvents;

export type EventHandler<K extends ServerEventName> = (event: ServerEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<ServerEventName, EventHandler<ServerEventName>[]>();
  private readonly asyncWarned = new Set<ServerEventName>();

  on<K extends ServerEventName>(name: K, handler: EventHandler<K>): () => void {
    let list = this.handlers.get(name);
    if (!list) {
      list = [];
      this.handlers.set(name, list);
    }
    list.push(handler as EventHandler<ServerEventName>);
    return () => {
      const current = this.handlers.get(name);
      if (!current) return;
      const index = current.indexOf(handler as EventHandler<ServerEventName>);
      if (index >= 0) current.splice(index, 1);
    };
  }

  /**
   * Dispatch in registration order. Handler exceptions are logged and skipped;
   * remaining listeners and the server tick continue. Does not await Promises.
   */
  emit<K extends ServerEventName>(name: K, event: ServerEvents[K]): ServerEvents[K] {
    const list = this.handlers.get(name);
    if (!list || list.length === 0) return event;
    for (const handler of [...list]) {
      try {
        const result = handler(event) as unknown;
        if (result && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
          if (!this.asyncWarned.has(name)) {
            this.asyncWarned.add(name);
            serverLog(
              `plugin event ${name} returned a Promise; gameplay decisions are synchronous and the Promise is not awaited`,
              'warn',
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        serverLog(`plugin event ${name} threw: ${message}`, 'error');
      }
    }
    return event;
  }

  listenerCount(name: ServerEventName): number {
    return this.handlers.get(name)?.length ?? 0;
  }

  createPlayerMove(playerId: string, x: number, y: number, z: number): PlayerMoveEvent {
    return cancellable({ playerId, x, y, z });
  }

  createBlockBreak(playerId: string, x: number, y: number, z: number, blockId: number): BlockBreakEvent {
    return cancellable({ playerId, x, y, z, blockId });
  }

  createBlockPlace(playerId: string, x: number, y: number, z: number, blockId: number): BlockPlaceEvent {
    return cancellable({ playerId, x, y, z, blockId });
  }

  createPlayerDamage(playerId: string, amount: number, cause: string): PlayerDamageEvent {
    return cancellable({ playerId, amount, cause });
  }

  createEntityDamage(entityId: string, amount: number, cause: string): EntityDamageEvent {
    return cancellable({ entityId, amount, cause });
  }

  createItemDrop(
    itemId: string,
    count: number,
    x: number,
    y: number,
    z: number,
    playerId?: string,
  ): ItemDropEvent {
    return cancellable({ itemId, count, x, y, z, ...(playerId ? { playerId } : {}) });
  }

  createItemPickup(playerId: string, entityId: string, itemId: string, count: number): ItemPickupEvent {
    return cancellable({ playerId, entityId, itemId, count });
  }

  createCraft(playerId: string, outputId: string, count: number, recipeId?: string): CraftEvent {
    return cancellable({ playerId, outputId, count, ...(recipeId ? { recipeId } : {}) });
  }

  createPlayerInteract(playerId: string, x: number, y: number, z: number, blockId: number): PlayerInteractEvent {
    return cancellable({ playerId, x, y, z, blockId });
  }

  createExplosion(x: number, y: number, z: number, radius: number, power: number): ExplosionEvent {
    return cancellable({ x, y, z, radius, power });
  }

  createPlayerCommand(playerId: string, command: string): PlayerCommandEvent {
    return cancellable({ playerId, command });
  }

  createVehicleEnter(playerId: string, entityId: string): VehicleEnterEvent {
    return cancellable({ playerId, entityId });
  }

  createVehicleExit(playerId: string, entityId: string): VehicleExitEvent {
    return cancellable({ playerId, entityId });
  }
}
