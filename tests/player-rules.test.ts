import { describe, expect, it, vi } from 'vitest';
import { TeleportHistoryService, TeleportService } from '../server/services/teleport';
import { PlayerRules } from '../server/services/playerRules';
import {
  PVP_DURATION_MS,
  TELEPORT_COOLDOWN_MESSAGE,
  TELEPORT_COOLDOWN_MS,
  TELEPORT_PROTECTION_MS,
  TELEPORT_PVP_MESSAGE,
} from '../shared/playerRules';

function gate(rules: PlayerRules) {
  return {
    block: (playerId: string, _reason: string, now: number) => rules.teleportBlockReason(playerId, now),
    begin: (playerId: string) => rules.beginTeleport(playerId),
    finish: (playerId: string) => rules.finishTeleport(playerId),
    commit: (playerId: string, reason: string, now: number) => rules.acceptTeleport(playerId, reason, now),
  };
}

describe('player rules', () => {
  it('shares one teleport cooldown and does not start it when the move fails', () => {
    const rules = new PlayerRules();
    let allow = false;
    const teleports = new TeleportService('anarchy', new TeleportHistoryService(), () => ({
      id: 'p',
      position: () => ({ x: 1, y: 70, z: 1 }),
      teleport: () => allow,
      sendMessage: () => undefined,
    }), gate(rules));
    expect(teleports.now('p', { x: 3, y: 70, z: 3 }, 'home').ok).toBe(false);
    expect(rules.teleportBlockReason('p', Date.now())).toBeUndefined();
    allow = true;
    expect(teleports.now('p', { x: 4, y: 70, z: 4 }, 'rtp').ok).toBe(true);
    expect(rules.teleportBlockReason('p', Date.now())).toBe(TELEPORT_COOLDOWN_MESSAGE);
    expect(teleports.now('p', { x: 8, y: 70, z: 8 }, 'spawn').error).toBe(TELEPORT_COOLDOWN_MESSAGE);
    expect(teleports.now('p', { x: 9, y: 70, z: 1 }, 'tpa').error).toBe(TELEPORT_COOLDOWN_MESSAGE);
  });

  it('says the russian cooldown sentence when only the older per-reason timer is still running', () => {
    const rules = new PlayerRules();
    let now = 1_000_000;
    const teleports = new TeleportService('anarchy', new TeleportHistoryService(), () => ({
      id: 'p',
      position: () => ({ x: 1, y: 70, z: 1 }),
      teleport: () => true,
      sendMessage: () => undefined,
    }), {
      block: (playerId, _reason, at) => rules.teleportBlockReason(playerId, at),
      begin: (playerId) => rules.beginTeleport(playerId),
      finish: (playerId) => rules.finishTeleport(playerId),
      commit: (playerId, reason, at) => rules.acceptTeleport(playerId, reason, at),
    });
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    expect(teleports.schedule('p', { x: 3, y: 70, z: 3 }, 'spawn', { cooldownMs: 15_000 }).ok).toBe(true);
    now += 6_000;
    expect(rules.teleportBlockReason('p', now)).toBeUndefined();
    expect(teleports.schedule('p', { x: 4, y: 70, z: 4 }, 'spawn', { cooldownMs: 15_000 }).error)
      .toBe(TELEPORT_COOLDOWN_MESSAGE);
    clock.mockRestore();
  });

  it('rejects a re-entrant teleport before the first one commits', () => {
    const rules = new PlayerRules();
    let nested: { ok: boolean; error?: string } | undefined;
    const teleports = new TeleportService('anarchy', new TeleportHistoryService(), () => ({
      id: 'p',
      position: () => ({ x: 1, y: 70, z: 1 }),
      teleport: () => {
        nested = teleports.now('p', { x: 6, y: 70, z: 6 }, 'friends');
        return true;
      },
      sendMessage: () => undefined,
    }), gate(rules));
    expect(teleports.now('p', { x: 2, y: 70, z: 2 }, 'home').ok).toBe(true);
    expect(nested?.ok).toBe(false);
    expect(nested?.error).toBe(TELEPORT_COOLDOWN_MESSAGE);
  });

  it('gives protection after home, rtp and player teleports, and spawn leaves it untouched', () => {
    const rules = new PlayerRules();
    const start = 1_000;
    rules.acceptTeleport('a', 'home', start);
    const until = rules.protectionDeadline('a', start);
    expect(until).toBe(start + TELEPORT_PROTECTION_MS);
    rules.acceptTeleport('a', 'spawn', start + TELEPORT_COOLDOWN_MS + 1);
    expect(rules.protectionDeadline('a', start + TELEPORT_COOLDOWN_MS + 1)).toBe(until);
    expect(rules.protectionDeadline('fresh', start)).toBe(0);
    rules.acceptTeleport('fresh', 'spawn', start);
    expect(rules.protectionDeadline('fresh', start)).toBe(0);
    rules.acceptTeleport('b', 'rtp', start);
    rules.acceptTeleport('c', 'tpa', start);
    rules.acceptTeleport('d', 'friends', start);
    rules.acceptTeleport('e', 'portal', start);
    for (const id of ['b', 'c', 'd', 'e']) {
      expect(rules.protectionDeadline(id, start)).toBe(start + TELEPORT_PROTECTION_MS);
    }
  });

  it('blocks only pairs that include a protected player and ignores blocked hits for the pvp timer', () => {
    const rules = new PlayerRules();
    const now = 5_000;
    rules.acceptTeleport('a', 'rtp', now);
    expect(rules.blocksPvp('a', 'b', now)).toBe(true);
    expect(rules.blocksPvp('b', 'a', now)).toBe(true);
    expect(rules.blocksPvp('b', 'c', now)).toBe(false);
    expect(rules.blocksPvp('c', 'b', now)).toBe(false);
    rules.acceptPvp('b', 'c', now);
    const deadline = rules.pvpUntil('b', now);
    expect(deadline).toBe(now + PVP_DURATION_MS);
    expect(rules.pvpUntil('a', now)).toBe(0);
    expect(rules.pvpUntil('c', now)).toBe(deadline);
    expect(rules.teleportBlockReason('b', now)).toBe(TELEPORT_PVP_MESSAGE);
    expect(rules.pvpUntil('b', now + PVP_DURATION_MS)).toBe(0);
    expect(rules.blocksPvp('b', 'c', now + TELEPORT_PROTECTION_MS)).toBe(false);
  });
});
