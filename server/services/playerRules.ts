import {
  CHAT_COOLDOWN_MS,
  PVP_DURATION_MS,
  TELEPORT_COOLDOWN_MESSAGE,
  TELEPORT_COOLDOWN_MS,
  TELEPORT_PROTECTION_MS,
  TELEPORT_PVP_MESSAGE,
  grantsTeleportProtection,
} from '../../shared/playerRules';

/**
 * Per-player server timestamps for chat, teleport, PvP and post-teleport safety.
 * Nothing here is global to a zone: a protected player only blocks pairs that include them.
 */
export class PlayerRules {
  private readonly chatUntil = new Map<string, number>();
  private readonly teleportUntil = new Map<string, number>();
  private readonly pvpDeadline = new Map<string, number>();
  private readonly protectionUntil = new Map<string, number>();
  private readonly teleportBusy = new Set<string>();

  chatBlocked(playerId: string, now: number): boolean {
    return (this.chatUntil.get(playerId) ?? 0) > now;
  }

  acceptChat(playerId: string, now: number): void {
    this.chatUntil.set(playerId, now + CHAT_COOLDOWN_MS);
  }

  teleportBlockReason(playerId: string, now: number): string | undefined {
    if ((this.pvpDeadline.get(playerId) ?? 0) > now) return TELEPORT_PVP_MESSAGE;
    if ((this.teleportUntil.get(playerId) ?? 0) > now) return TELEPORT_COOLDOWN_MESSAGE;
    return undefined;
  }

  /** False when another teleport for this player is already inside `now()`. */
  beginTeleport(playerId: string): boolean {
    if (this.teleportBusy.has(playerId)) return false;
    this.teleportBusy.add(playerId);
    return true;
  }

  finishTeleport(playerId: string): void {
    this.teleportBusy.delete(playerId);
  }

  /**
   * Call only after the player actually moved.
   * Spawn starts the shared cooldown and leaves an existing safety window alone.
   */
  acceptTeleport(playerId: string, reason: string, now: number): void {
    this.teleportUntil.set(playerId, now + TELEPORT_COOLDOWN_MS);
    if (!grantsTeleportProtection(reason)) return;
    this.protectionUntil.set(playerId, now + TELEPORT_PROTECTION_MS);
  }

  blocksPvp(attackerId: string, victimId: string, now: number): boolean {
    if (!attackerId || !victimId || attackerId === victimId) return false;
    return (this.protectionUntil.get(attackerId) ?? 0) > now
      || (this.protectionUntil.get(victimId) ?? 0) > now;
  }

  /** Refresh both participants. Returns the shared absolute deadline. */
  acceptPvp(attackerId: string, victimId: string, now: number): number {
    const until = now + PVP_DURATION_MS;
    this.pvpDeadline.set(attackerId, until);
    this.pvpDeadline.set(victimId, until);
    return until;
  }

  /** Absolute server deadline, or 0 when the mode is already over. */
  pvpUntil(playerId: string, now: number): number {
    const until = this.pvpDeadline.get(playerId) ?? 0;
    return until > now ? until : 0;
  }

  protectionDeadline(playerId: string, now: number): number {
    const until = this.protectionUntil.get(playerId) ?? 0;
    return until > now ? until : 0;
  }

  forget(playerId: string): void {
    this.chatUntil.delete(playerId);
    this.teleportUntil.delete(playerId);
    this.pvpDeadline.delete(playerId);
    this.protectionUntil.delete(playerId);
    this.teleportBusy.delete(playerId);
  }
}
