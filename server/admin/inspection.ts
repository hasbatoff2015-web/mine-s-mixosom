import type { SerializedInventory } from '../../src/inventory/types';
import type { GameMode } from '../../shared/protocol';
import { AdminIdentityPolicy } from './identity';

export interface AdminPlayerSnapshot {
  readonly playerId: string;
  readonly name: string;
  readonly online: boolean;
  readonly gamemode: GameMode;
  readonly worldId: string;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly health?: number;
  readonly balance: number;
  readonly inventory: SerializedInventory;
  readonly inventoryRevision: number;
  readonly containerKind?: string;
  readonly containerRevision?: number;
}

export interface AdminInspectionOnline {
  readonly id: string;
  readonly name: string;
  readonly gamemode: GameMode;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly health: number;
  readonly inventory: SerializedInventory;
  readonly inventoryRevision: number;
  readonly containerKind?: string;
  readonly containerRevision?: number;
}

export interface AdminInspectionStored {
  readonly id: string;
  readonly name: string;
  readonly gamemode: GameMode;
  readonly inventory: SerializedInventory;
}

export interface AdminInspectionSource {
  readonly worldId: string;
  findOnline(playerId: string): AdminInspectionOnline | undefined;
  findStored(playerId: string): AdminInspectionStored | undefined;
  balance(playerId: string): number;
}

/**
 * Read-only player view for a future admin panel. It does not mutate and it
 * does not include session tokens, sockets, or database configuration.
 */
export class AdminInspectionService {
  constructor(
    private readonly policy: AdminIdentityPolicy,
    private readonly source: AdminInspectionSource,
  ) {}

  inspect(adminId: string, playerId: string): AdminPlayerSnapshot | null {
    this.policy.requireAdmin(adminId);
    const online = this.source.findOnline(playerId);
    if (online) {
      return {
        playerId: online.id,
        name: online.name,
        online: true,
        gamemode: online.gamemode,
        worldId: this.source.worldId,
        position: { x: online.x, y: online.y, z: online.z },
        health: online.health,
        balance: this.source.balance(playerId),
        inventory: online.inventory,
        inventoryRevision: online.inventoryRevision,
        ...(online.containerKind ? { containerKind: online.containerKind } : {}),
        ...(online.containerRevision !== undefined ? { containerRevision: online.containerRevision } : {}),
      };
    }
    const stored = this.source.findStored(playerId);
    if (!stored) return null;
    return {
      playerId: stored.id,
      name: stored.name,
      online: false,
      gamemode: stored.gamemode,
      worldId: this.source.worldId,
      balance: this.source.balance(playerId),
      inventory: stored.inventory,
      inventoryRevision: 0,
    };
  }
}
