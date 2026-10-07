/** Server-authoritative 1v1 duel constants and menu view types. */

export const DUEL_NEARBY_RADIUS = 20;
export const DUEL_INVITE_TTL_MS = 30_000;
export const DUEL_REJECT_COOLDOWN_MS = 10_000;
export const DUEL_MATCH_DURATION_MS = 5 * 60_000;
export const DUEL_LOOT_WINDOW_MS = 15_000;
export const DUEL_COUNTDOWN_MS = 5_000;
export const DUEL_FIGHT_BANNER_MS = 800;
export const DUEL_COUNTDOWN_HOLOGRAM = 'duel-countdown';
export const DUEL_COUNTDOWN_HOLOGRAM_SIZE = 2.8;
export const DUEL_HOLOGRAM_RANGE = 48;
export const DUEL_HOLOGRAM_Y_OFFSET = 2.2;
export const DUEL_START_BURST_Y_OFFSET = 0.75;
export const DUEL_BURST_VELOCITY_SCALE = 0.5;
export const DUEL_BURST_LIFE_SCALE = 0.75;
export const DUEL_COMBAT_CAUSES = ['melee', 'arrow', 'projectile'] as const;

export const DUEL_TELEPORT_DENIED = 'Телепортация недоступна во время дуэли.';
export const DUEL_ARENA_BUSY = 'Арена занята.';
export const DUEL_TOO_FAR = 'Игрок слишком далеко.';
export const DUEL_CROSS_INVITE = 'У вас уже есть входящий вызов от этого игрока.';
export const DUEL_ARENA_UNCONFIGURED = 'Арена не настроена.';
export const DUEL_STARTED = 'Дуэль началась!';
export const DUEL_UNAVAILABLE = 'Дуэли временно недоступны.';

export function duelRejectedMessage(name: string): string {
  return `${name} отклонил вызов на дуэль.`;
}

export function duelExpiredMessage(name: string): string {
  return `Вызов игроку ${name} истёк.`;
}

export function duelChallengeMessage(name: string): string {
  return `Игрок ${name} вызывает вас на дуэль. Откройте Меню → Дуэли.`;
}

export interface DuelPose {
  worldId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface DuelOpponentStats {
  wins: number;
  losses: number;
  displayName: string;
}

export interface DuelPlayerStats {
  wins: number;
  losses: number;
  displayName: string;
  opponents: Record<string, DuelOpponentStats>;
}

export interface DuelMenuStats {
  readonly wins: number;
  readonly losses: number;
}

export interface DuelIncomingRow {
  readonly requestId: string;
  readonly playerId: string;
  readonly name: string;
  readonly wins: number;
  readonly losses: number;
}

export interface DuelOutgoingRow {
  readonly playerId: string;
  readonly name: string;
  readonly secondsLeft: number;
}

export interface DuelNearbyRow {
  readonly playerId: string;
  readonly name: string;
  readonly wins: number;
  readonly losses: number;
  readonly distance: number;
  readonly canChallenge: boolean;
}

export interface DuelMenuView {
  readonly stats: DuelMenuStats;
  readonly available: boolean;
  readonly arenaConfigured: boolean;
  readonly arenaBusy: boolean;
  readonly incoming: readonly DuelIncomingRow[];
  readonly outgoing?: DuelOutgoingRow;
  readonly nearby: readonly DuelNearbyRow[];
}

export function duelDistanceSquared(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function withinDuelRange(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
  radius = DUEL_NEARBY_RADIUS,
): boolean {
  return duelDistanceSquared(a, b) <= radius * radius;
}

/** Equal thirds of the real 5s countdown: 3, 2, 1, then fight at 5000ms. */
export function duelCountdownGlyph(elapsedMs: number): '3' | '2' | '1' | 'fight' {
  if (elapsedMs >= DUEL_COUNTDOWN_MS) return 'fight';
  const third = DUEL_COUNTDOWN_MS / 3;
  if (elapsedMs >= third * 2) return '1';
  if (elapsedMs >= third) return '2';
  return '3';
}

export function duelHologramPosition(
  spawn1: { readonly x: number; readonly y: number; readonly z: number },
  spawn2: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  return {
    x: (spawn1.x + spawn2.x) / 2,
    y: Math.max(spawn1.y, spawn2.y) + DUEL_HOLOGRAM_Y_OFFSET,
    z: (spawn1.z + spawn2.z) / 2,
  };
}

export function duelStartBurstPosition(
  spawn1: { readonly x: number; readonly y: number; readonly z: number },
  spawn2: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  const hologram = duelHologramPosition(spawn1, spawn2);
  return { x: hologram.x, y: hologram.y + DUEL_START_BURST_Y_OFFSET, z: hologram.z };
}

export function isDuelCombatCause(cause: string | undefined): boolean {
  return cause !== undefined && (DUEL_COMBAT_CAUSES as readonly string[]).includes(cause);
}

export function duelBlockDistance(
  a: { readonly x: number; readonly y: number; readonly z: number },
  b: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return Math.round(Math.sqrt(duelDistanceSquared(a, b)));
}
