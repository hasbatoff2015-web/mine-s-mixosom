import { isValidWorldY } from '../../src/core/constants';
import { isPlayerCenterInsidePlayableWorld } from '../../src/world/worldBorder';

export interface CoordinateTeleportPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CoordinateTeleportDeps {
  hasPermission(playerId: string): boolean;
  isOperator(playerId: string): boolean;
  teleport(playerId: string, point: CoordinateTeleportPoint): { ok: boolean; error?: string };
  peekCooldown(playerId: string, now: number): { allowed: boolean; remainingMs: number };
  consume(playerId: string, now: number, commit: () => boolean): { ok: boolean; error?: string; remainingMs?: number };
}

export type CoordinateTeleportResult =
  | { ok: true }
  | { ok: false; error: string; remainingMs?: number };

/**
 * Shared by `/tpa x y z` and a future coordinate form.
 * A failed validation or teleport does not consume the daily use.
 */
export function attemptCoordinateTeleport(
  deps: CoordinateTeleportDeps,
  playerId: string,
  point: CoordinateTeleportPoint,
  now = Date.now(),
): CoordinateTeleportResult {
  const operator = deps.isOperator(playerId);
  if (!operator && !deps.hasPermission(playerId)) {
    return { ok: false, error: 'You do not have permission.' };
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    return { ok: false, error: 'Usage: /tpa <x> <y> <z>' };
  }
  if (!isValidWorldY(Math.floor(point.y)) && !isValidWorldY(Math.ceil(point.y))) {
    return { ok: false, error: 'Y is outside the world.' };
  }
  if (!isPlayerCenterInsidePlayableWorld(point.x, point.z)) {
    return { ok: false, error: 'Destination is outside the world.' };
  }
  if (!operator) {
    const peek = deps.peekCooldown(playerId, now);
    if (!peek.allowed) {
      return { ok: false, error: 'cooldown', remainingMs: peek.remainingMs };
    }
  }
  const run = (): boolean => deps.teleport(playerId, point).ok;
  if (operator) {
    const moved = deps.teleport(playerId, point);
    return moved.ok ? { ok: true } : { ok: false, error: moved.error ?? 'Teleport failed.' };
  }
  const consumed = deps.consume(playerId, now, run);
  if (consumed.ok) return { ok: true };
  return { ok: false, error: consumed.error ?? 'Teleport failed.', remainingMs: consumed.remainingMs };
}
