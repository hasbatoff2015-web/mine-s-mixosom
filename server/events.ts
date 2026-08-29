export interface Cancellable {
  cancelled: boolean;
  cancel(): void;
}

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

export interface ServerEvents {
  playerJoin: PlayerJoinEvent;
  playerQuit: PlayerQuitEvent;
  playerMove: PlayerMoveEvent;
  blockBreak: BlockBreakEvent;
  blockPlace: BlockPlaceEvent;
  playerDamage: PlayerDamageEvent;
  entityDamage: EntityDamageEvent;
}

export type ServerEventName = keyof ServerEvents;

export type EventHandler<K extends ServerEventName> = (event: ServerEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<ServerEventName, Set<EventHandler<ServerEventName>>>();

  on<K extends ServerEventName>(name: K, handler: EventHandler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as EventHandler<ServerEventName>);
    return () => {
      set?.delete(handler as EventHandler<ServerEventName>);
    };
  }

  emit<K extends ServerEventName>(name: K, event: ServerEvents[K]): ServerEvents[K] {
    const set = this.handlers.get(name);
    if (!set) return event;
    for (const handler of set) {
      handler(event);
    }
    return event;
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
}
