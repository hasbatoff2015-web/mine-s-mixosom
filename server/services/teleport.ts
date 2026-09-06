import { isValidWorldY } from '../../src/core/constants';
import type { EventBus } from '../events';

export type TeleportReason =
  | 'command'
  | 'tpa'
  | 'spawn'
  | 'home'
  | 'rtp'
  | 'portal'
  | 'back'
  | 'death';

export interface TeleportLocation {
  readonly worldId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TeleportHistoryEntry extends TeleportLocation {
  readonly reason: TeleportReason;
  readonly at: number;
}

export interface TeleportScheduleOptions {
  readonly warmupMs?: number;
  readonly cancelOnMove?: boolean;
  readonly cancelOnDamage?: boolean;
  readonly cooldownMs?: number;
  readonly onComplete?: (ok: boolean, message: string) => void;
}

export interface TeleportTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface PendingTeleport {
  readonly playerId: string;
  readonly dest: TeleportTarget;
  readonly reason: TeleportReason;
  remainingMs: number;
  readonly cancelOnMove: boolean;
  readonly cancelOnDamage: boolean;
  readonly origin: TeleportTarget;
  readonly onComplete?: (ok: boolean, message: string) => void;
}

export interface TeleportActor {
  readonly id: string;
  position(): TeleportTarget;
  teleport(x: number, y: number, z: number): boolean;
  sendMessage(text: string): void;
}

export class TeleportHistoryService {
  private readonly last = new Map<string, TeleportHistoryEntry>();

  record(playerId: string, location: TeleportLocation, reason: TeleportReason): void {
    this.last.set(playerId, { ...location, reason, at: Date.now() });
  }

  peek(playerId: string): TeleportHistoryEntry | undefined {
    return this.last.get(playerId);
  }

  consume(playerId: string): TeleportHistoryEntry | undefined {
    const entry = this.last.get(playerId);
    if (!entry) return undefined;
    this.last.delete(playerId);
    return entry;
  }
}

export class TeleportService {
  private readonly pending = new Map<string, PendingTeleport>();
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly worldId: string,
    private readonly history: TeleportHistoryService,
    private readonly getActor: (playerId: string) => TeleportActor | undefined,
  ) {}

  attach(events: EventBus): void {
    events.on('playerMove', (event) => {
      const pending = this.pending.get(event.playerId);
      if (!pending?.cancelOnMove) return;
      const dx = event.x - pending.origin.x;
      const dy = event.y - pending.origin.y;
      const dz = event.z - pending.origin.z;
      if (dx * dx + dy * dy + dz * dz > 0.09) {
        this.cancel(event.playerId, 'Teleport cancelled because you moved.');
      }
    });
    events.on('playerDamaged', (event) => {
      const pending = this.pending.get(event.playerId);
      if (!pending?.cancelOnDamage) return;
      this.cancel(event.playerId, 'Teleport cancelled because you took damage.');
    });
    events.on('entityDeath', (event) => {
      if (!event.playerId) return;
      const actor = this.getActor(event.playerId);
      if (!actor) return;
      const pos = actor.position();
      this.history.record(event.playerId, { worldId: this.worldId, ...pos }, 'death');
    });
  }

  cooldownRemaining(playerId: string, reason: TeleportReason, now = Date.now()): number {
    const until = this.cooldownUntil.get(`${playerId}:${reason}`) ?? 0;
    return Math.max(0, until - now);
  }

  now(
    playerId: string,
    dest: TeleportTarget,
    reason: TeleportReason,
    options: { silent?: boolean } = {},
  ): { ok: boolean; error?: string } {
    const actor = this.getActor(playerId);
    if (!actor) return { ok: false, error: 'Player not found.' };
    if (!Number.isFinite(dest.x) || !Number.isFinite(dest.y) || !Number.isFinite(dest.z)) {
      return { ok: false, error: 'Invalid coordinates.' };
    }
    if (!isValidWorldY(Math.floor(dest.y)) && !isValidWorldY(Math.ceil(dest.y))) {
      return { ok: false, error: 'Y is outside the world.' };
    }
    const from = actor.position();
    if (!actor.teleport(dest.x, dest.y, dest.z)) return { ok: false, error: 'Teleport failed.' };
    this.history.record(playerId, { worldId: this.worldId, ...from }, reason);
    this.pending.delete(playerId);
    if (!options.silent) {
      actor.sendMessage(`Teleported to ${dest.x.toFixed(1)}, ${dest.y.toFixed(1)}, ${dest.z.toFixed(1)}.`);
    }
    return { ok: true };
  }

  schedule(
    playerId: string,
    dest: TeleportTarget,
    reason: TeleportReason,
    options: TeleportScheduleOptions = {},
  ): { ok: boolean; error?: string } {
    const remaining = this.cooldownRemaining(playerId, reason);
    if (remaining > 0) {
      return { ok: false, error: `Please wait ${(remaining / 1000).toFixed(1)}s before using this again.` };
    }
    const warmupMs = Math.max(0, options.warmupMs ?? 0);
    if (warmupMs <= 0) {
      const result = this.now(playerId, dest, reason, { silent: true });
      if (result.ok && (options.cooldownMs ?? 0) > 0) {
        this.cooldownUntil.set(`${playerId}:${reason}`, Date.now() + (options.cooldownMs ?? 0));
      }
      options.onComplete?.(result.ok, result.error ?? 'Teleported.');
      return result;
    }
    const actor = this.getActor(playerId);
    if (!actor) return { ok: false, error: 'Player not found.' };
    this.pending.set(playerId, {
      playerId,
      dest,
      reason,
      remainingMs: warmupMs,
      cancelOnMove: options.cancelOnMove !== false,
      cancelOnDamage: options.cancelOnDamage !== false,
      origin: actor.position(),
      onComplete: options.onComplete,
    });
    if ((options.cooldownMs ?? 0) > 0) {
      this.cooldownUntil.set(`${playerId}:${reason}`, Date.now() + (options.cooldownMs ?? 0));
    }
    actor.sendMessage(`Teleporting in ${(warmupMs / 1000).toFixed(1)}s...`);
    return { ok: true };
  }

  cancel(playerId: string, message: string): boolean {
    const pending = this.pending.get(playerId);
    if (!pending) return false;
    this.pending.delete(playerId);
    const actor = this.getActor(playerId);
    actor?.sendMessage(message);
    pending.onComplete?.(false, message);
    return true;
  }

  clear(playerId: string): void {
    this.pending.delete(playerId);
    for (const key of [...this.cooldownUntil.keys()]) {
      if (key.startsWith(`${playerId}:`)) this.cooldownUntil.delete(key);
    }
  }

  tick(dtMs: number): void {
    for (const pending of [...this.pending.values()]) {
      pending.remainingMs -= dtMs;
      if (pending.remainingMs > 0) continue;
      this.pending.delete(pending.playerId);
      const result = this.now(pending.playerId, pending.dest, pending.reason, { silent: true });
      const message = result.ok ? 'Teleported.' : (result.error ?? 'Teleport failed.');
      if (result.ok) this.getActor(pending.playerId)?.sendMessage(message);
      else this.getActor(pending.playerId)?.sendMessage(message);
      pending.onComplete?.(result.ok, message);
    }
  }
}
