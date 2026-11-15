export const CHAT_COOLDOWN_MS = 3_000;
export const CHAT_COOLDOWN_MESSAGE = 'Нельзя отправлять сообщения в чат чаще 3 секунд.';

export const TELEPORT_COOLDOWN_MS = 5_000;
export const TELEPORT_COOLDOWN_MESSAGE = 'Нельзя телепортироваться чаще 5 секунд.';
export const TELEPORT_PVP_MESSAGE = 'Нельзя телепортироваться во время PvP.';

export const PVP_DURATION_MS = 10_000;
export const TELEPORT_PROTECTION_MS = 20_000;

/**
 * Player-started teleports. Death respawn and the duel teleport stay outside
 * this set so a fight cannot trap a dead player or break the arena move.
 */
const GOVERNED_TELEPORTS = new Set([
  'spawn', 'home', 'rtp', 'portal', 'tpa', 'friends',
  'back', 'command', 'coords', 'clan', 'automine',
]);

const PROTECTION_TELEPORTS = new Set(['home', 'rtp', 'portal', 'tpa', 'friends']);

export function isGovernedTeleportReason(reason: string): boolean {
  return GOVERNED_TELEPORTS.has(reason);
}

/** RTP, home, a player teleport and an RTP portal. Spawn does not grant or clear this. */
export function grantsTeleportProtection(reason: string): boolean {
  return PROTECTION_TELEPORTS.has(reason);
}

export function isTeleportRestrictionMessage(text: string): boolean {
  return text === TELEPORT_COOLDOWN_MESSAGE || text === TELEPORT_PVP_MESSAGE;
}

export function russianSecondsWord(seconds: number): string {
  const value = Math.abs(Math.trunc(seconds));
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'секунда';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секунды';
  return 'секунд';
}

export function pvpBadgeText(seconds: number): string {
  const value = Math.max(0, Math.trunc(seconds));
  return `Режим ПВП - ${value} ${russianSecondsWord(value)}`;
}

/**
 * Client deadline in local `Date.now()` milliseconds.
 * `serverOffsetMs` is `serverNow - Date.now()` from the same message.
 */
export function clientPvpDeadline(
  untilServerMs: number | undefined,
  serverOffsetMs: number,
  now = Date.now(),
): number | null {
  if (typeof untilServerMs !== 'number' || !Number.isFinite(untilServerMs) || untilServerMs <= 0) return null;
  const deadline = untilServerMs - serverOffsetMs;
  if (!Number.isFinite(deadline) || deadline <= now) return null;
  return deadline;
}

export function pvpBadgeSecondsRemaining(deadlineMs: number, now: number): number {
  if (deadlineMs <= now) return 0;
  return Math.max(1, Math.ceil((deadlineMs - now) / 1000));
}
