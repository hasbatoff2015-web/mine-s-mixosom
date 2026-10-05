import { describe, expect, it } from 'vitest';
import {
  DUEL_ARENA_BUSY,
  DUEL_ARENA_UNCONFIGURED,
  DUEL_COUNTDOWN_MS,
  DUEL_CROSS_INVITE,
  DUEL_FIGHT_BANNER_MS,
  DUEL_INVITE_TTL_MS,
  DUEL_LOOT_WINDOW_MS,
  DUEL_MATCH_DURATION_MS,
  DUEL_POST_MATCH_COOLDOWN_MS,
  DUEL_REJECT_COOLDOWN_MS,
  DUEL_STARTED,
  DUEL_TELEPORT_DENIED,
  DUEL_TOO_FAR,
  duelCountdownGlyph,
  duelRejectedMessage,
} from '../../shared/duels';
import {
  DuelService,
  type DuelActor,
  type DuelRuntime,
  type DuelStore,
} from '../../server/services/duels';

function pose(x: number, z = 10) {
  return { worldId: 'anarchy', x, y: 80, z, yaw: 0, pitch: 0 };
}

function actor(id: string, name: string, x: number, extra: Partial<DuelActor> = {}): DuelActor {
  return {
    id,
    name,
    connected: true,
    gamemode: 'survival',
    alive: true,
    worldId: 'anarchy',
    x,
    y: 80,
    z: 10,
    yaw: 0,
    pitch: 0,
    ...extra,
  };
}

function harness() {
  let now = 1_000_000;
  const actors = new Map<string, DuelActor>();
  const messages: Array<{ id: string; text: string }> = [];
  const holograms: string[] = [];
  const refreshed: string[] = [];
  const notified: string[] = [];
  const drops: string[] = [];
  const removed: string[][] = [];
  const restores: string[] = [];
  const relocates: string[] = [];
  let stats: unknown = { players: {} };
  let arena: unknown = {};
  const store: DuelStore = {
    loadStats: () => stats,
    saveStats: (value) => { stats = value; },
    loadArena: () => arena,
    saveArena: (value) => { arena = value; },
  };
  const runtime: DuelRuntime = {
    preparePlayer: () => true,
    hardRelocateForDuel: () => true,
    restorePreDuelPose: (playerId) => { restores.push(playerId); return true; },
    dropAllResources: (playerId) => {
      const id = `drop-${playerId}-${drops.length}`;
      drops.push(id);
      return [id];
    },
    removeDroppedItems: (ids) => { removed.push([...ids]); },
    respawnAtWorldSpawn: () => true,
    relocateToWorldSpawn: (playerId) => { relocates.push(playerId); return true; },
    closeTransientUi: () => undefined,
    refreshGameMenu: (playerId) => { refreshed.push(playerId); },
    sendMessage: (playerId, text) => { messages.push({ id: playerId, text }); },
    notifyDuels: (playerId) => { notified.push(playerId); },
    capturePose: (playerId) => {
      const found = actors.get(playerId);
      return found ? pose(found.x, found.z) : undefined;
    },
    worldSpawnPose: () => pose(0.5, 0.5),
    setCountdownHologram: (text) => { holograms.push(text); },
    clearCountdownHologram: () => { holograms.push('clear'); },
  };
  const service = new DuelService({
    worldId: 'anarchy',
    store,
    directory: {
      get: (id) => actors.get(id),
      list: () => [...actors.values()].filter((entry) => entry.connected),
    },
    runtime,
    now: () => now,
  });
  service.setSpawn(1, pose(100));
  service.setSpawn(2, pose(104));
  return {
    service,
    actors,
    messages,
    holograms,
    notified,
    drops,
    removed,
    restores,
    relocates,
    stats: () => stats as { players: Record<string, { wins: number; losses: number; displayName: string; opponents: Record<string, { wins: number; losses: number; displayName: string }> }> },
    setNow: (value: number) => { now = value; },
    advance: (ms: number) => { now += ms; },
    now: () => now,
    reload() {
      return new DuelService({
        worldId: 'anarchy',
        store,
        directory: {
          get: (id) => actors.get(id),
          list: () => [...actors.values()].filter((entry) => entry.connected),
        },
        runtime,
        now: () => now,
      });
    },
  };
}

function addPair(env: ReturnType<typeof harness>) {
  env.actors.set('a', actor('a', 'Ada', 10));
  env.actors.set('b', actor('b', 'Bob', 12));
}

describe('duel countdown glyph', () => {
  it('splits the real 5 seconds into equal thirds', () => {
    expect(duelCountdownGlyph(0)).toBe('3');
    expect(duelCountdownGlyph(1666)).toBe('3');
    expect(duelCountdownGlyph(1667)).toBe('2');
    expect(duelCountdownGlyph(DUEL_COUNTDOWN_MS / 3)).toBe('2');
    expect(duelCountdownGlyph(3333)).toBe('2');
    expect(duelCountdownGlyph(3334)).toBe('1');
    expect(duelCountdownGlyph((DUEL_COUNTDOWN_MS / 3) * 2)).toBe('1');
    expect(duelCountdownGlyph(DUEL_COUNTDOWN_MS - 1)).toBe('1');
    expect(duelCountdownGlyph(DUEL_COUNTDOWN_MS)).toBe('fight');
  });
});

describe('DuelService invites', () => {
  it('validates challenge range, mode, life, and a single outgoing invite', () => {
    const env = harness();
    addPair(env);
    expect(env.service.challenge('a', 'missing').ok).toBe(false);
    expect(env.service.challenge('a', 'a').message).toBe('Нельзя вызвать самого себя.');
    env.actors.set('far', actor('far', 'Far', 10 + 20.01));
    expect(env.service.challenge('a', 'far').message).toBe(DUEL_TOO_FAR);
    env.actors.set('edge', actor('edge', 'Edge', 30));
    expect(env.service.challenge('a', 'edge').ok).toBe(true);
    env.service.decline('edge', env.service.menu('edge').incoming[0]!.requestId);
    env.advance(DUEL_REJECT_COOLDOWN_MS);
    env.actors.set('a', actor('a', 'Ada', 10, { gamemode: 'creative' }));
    expect(env.service.challenge('a', 'b').message).toMatch(/выживания/);
    env.actors.set('a', actor('a', 'Ada', 10, { alive: false }));
    expect(env.service.challenge('a', 'b').message).toMatch(/мёртв/);
    env.actors.set('a', actor('a', 'Ada', 10));
    expect(env.service.challenge('a', 'b').ok).toBe(true);
    expect(env.service.challenge('a', 'edge').message).toMatch(/исходящий/);
    expect(env.notified.at(-1)).toBe('b');
    expect(env.messages.some((entry) => entry.id === 'b' && entry.text.includes('Ada'))).toBe(true);
  });

  it('expires invites after 30s without a reject cooldown', () => {
    const env = harness();
    addPair(env);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
    expect(env.service.menu('a').outgoing?.secondsLeft).toBe(30);
    env.advance(DUEL_INVITE_TTL_MS - 1);
    expect(env.service.menu('b').incoming).toHaveLength(1);
    env.advance(1);
    env.service.tick();
    expect(env.service.menu('b').incoming).toEqual([]);
    expect(env.service.menu('a').outgoing).toBeUndefined();
    expect(env.messages.some((entry) => entry.text === 'Вызов игроку Bob истёк.')).toBe(true);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
  });

  it('applies a 10s pair cooldown on reject and does not auto-accept a cross invite', () => {
    const env = harness();
    addPair(env);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
    const requestId = env.service.menu('b').incoming[0]!.requestId;
    const cross = env.service.challenge('b', 'a');
    expect(cross.ok).toBe(false);
    expect(cross.message).toBe(DUEL_CROSS_INVITE);
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.service.decline('b', requestId).ok).toBe(true);
    expect(env.messages.some((entry) => entry.text === duelRejectedMessage('Bob'))).toBe(true);
    expect(env.service.challenge('a', 'b').ok).toBe(false);
    env.advance(DUEL_REJECT_COOLDOWN_MS - 1);
    expect(env.service.challenge('a', 'b').ok).toBe(false);
    env.advance(1);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
  });

  it('revalidates distance and arena state on accept', () => {
    const env = harness();
    addPair(env);
    env.actors.set('c', actor('c', 'Cara', 11));
    env.actors.set('d', actor('d', 'Dan', 12.4));
    expect(env.service.challenge('c', 'b').ok).toBe(true);
    expect(env.service.challenge('d', 'b').ok).toBe(true);
    expect(env.service.menu('b').incoming).toHaveLength(2);
    for (const row of env.service.menu('b').incoming) expect(env.service.decline('b', row.requestId).ok).toBe(true);
    env.advance(DUEL_REJECT_COOLDOWN_MS);

    expect(env.service.challenge('a', 'b').ok).toBe(true);
    env.actors.set('a', actor('a', 'Ada', 40));
    const farId = env.service.menu('b').incoming[0]!.requestId;
    expect(env.service.accept('b', farId).message).toBe(DUEL_TOO_FAR);
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.service.menu('b').incoming).toEqual([]);

    env.actors.set('a', actor('a', 'Ada', 10));
    env.actors.set('e', actor('e', 'Eve', 50));
    env.actors.set('f', actor('f', 'Fay', 51));
    expect(env.service.challenge('c', 'a').ok).toBe(true);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
    expect(env.service.challenge('e', 'f').ok).toBe(true);
    const survivor = env.service.menu('f').incoming[0]!.requestId;
    const ab = env.service.menu('b').incoming.find((row) => row.playerId === 'a')!.requestId;
    expect(env.service.accept('b', ab).ok).toBe(true);
    expect(env.service.phaseKind()).toBe('countdown');
    expect(env.service.menu('a').incoming).toEqual([]);
    expect(env.service.menu('f').incoming.map((row) => row.requestId)).toEqual([survivor]);
    expect(env.service.accept('f', survivor).message).toBe(DUEL_ARENA_BUSY);
    expect(env.service.menu('f').incoming).toHaveLength(1);
    env.service.onPlayerQuit('a');
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.service.accept('f', survivor).ok).toBe(true);
  });

  it('rejects accept when the arena is not configured', () => {
    const env = harness();
    addPair(env);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
    const requestId = env.service.menu('b').incoming[0]!.requestId;
    (env.service as unknown as { arena: { spawn1?: unknown; spawn2?: unknown } }).arena = {};
    expect(env.service.challenge('a', 'b').message).toBe(DUEL_ARENA_UNCONFIGURED);
    expect(env.service.accept('b', requestId).message).toBe(DUEL_ARENA_UNCONFIGURED);
    expect(env.service.phaseKind()).toBe('idle');
  });

  it('shows nearby players from the server positions', () => {
    const env = harness();
    env.actors.set('a', actor('a', 'Ada', 0));
    env.actors.set('near', actor('near', 'Near', 8));
    env.actors.set('same', actor('same', 'Same', 8, { z: 14 }));
    env.actors.set('far', actor('far', 'Far', 21));
    env.actors.set('self', actor('a', 'Ada', 0));
    env.actors.set('creative', actor('creative', 'Creative', 1, { gamemode: 'creative' }));
    env.actors.set('dead', actor('dead', 'Dead', 2, { alive: false }));
    const rows = env.service.menu('a').nearby;
    expect(rows.map((row) => row.playerId)).toEqual(['near', 'same']);
    expect(rows[0]!.distance).toBe(8);
    expect(rows[0]!.wins).toBe(0);
    expect(rows[0]!.losses).toBe(0);
    expect(rows[0]!.canChallenge).toBe(true);
    expect(env.service.challenge('a', 'near').ok).toBe(true);
    expect(env.service.menu('a').nearby.find((row) => row.playerId === 'same')?.canChallenge).toBe(false);
  });
});

describe('DuelService matches', () => {
  function begin(env: ReturnType<typeof harness>) {
    addPair(env);
    expect(env.service.challenge('a', 'b').ok).toBe(true);
    const started = env.now();
    expect(env.service.accept('b', env.service.menu('b').incoming[0]!.requestId).ok).toBe(true);
    return started;
  }

  it('runs a drift-free 5s countdown and starts the 5 minute fight at the end', () => {
    const env = harness();
    const started = begin(env);
    expect(env.service.phaseKind()).toBe('countdown');
    expect(env.service.shownCountdownText()).toBe('3');
    expect(env.holograms).toEqual(['3']);
    env.advance(1_670);
    env.service.tick();
    expect(env.service.shownCountdownText()).toBe('2');
    env.advance(1_670);
    env.service.tick();
    expect(env.service.shownCountdownText()).toBe('1');
    env.setNow(started + DUEL_COUNTDOWN_MS - 1);
    env.service.tick();
    expect(env.service.phaseKind()).toBe('countdown');
    expect(env.service.shownCountdownText()).toBe('1');
    env.setNow(started + DUEL_COUNTDOWN_MS);
    env.service.tick();
    expect(env.service.phaseKind()).toBe('fighting');
    expect(env.service.shownCountdownText()).toBe('БОЙ!');
    expect(env.service.fightDeadline()).toBe(started + DUEL_COUNTDOWN_MS + DUEL_MATCH_DURATION_MS);
    expect(env.messages.filter((entry) => entry.text === DUEL_STARTED)).toHaveLength(2);
    env.service.tick();
    expect(env.holograms.filter((text) => text === 'БОЙ!')).toHaveLength(1);
    env.setNow(started + DUEL_COUNTDOWN_MS + DUEL_FIGHT_BANNER_MS);
    env.service.tick();
    expect(env.holograms.at(-1)).toBe('clear');
    expect(env.service.shownCountdownText()).toBeUndefined();
  });

  it('blocks movement, combat, damage, teleports, and manual drops only for the active phase', () => {
    const env = harness();
    begin(env);
    expect(env.service.movementLock('a')?.x).toBe(100);
    expect(env.service.movementLock('b')?.x).toBe(104);
    expect(env.service.blocksCombatIntent('a', 'melee')).toBe(true);
    expect(env.service.blocksCombatIntent('b', 'projectile')).toBe(true);
    expect(env.service.blocksManualDrop('a')).toBe(true);
    expect(env.service.shouldCancelPlayerDamage('a', 'b')).toBe(true);
    expect(env.service.shouldCancelPlayerDamage('a')).toBe(true);
    expect(env.service.externalTeleportError('a')).toBe(DUEL_TELEPORT_DENIED);
    env.advance(DUEL_COUNTDOWN_MS);
    env.service.tick();
    expect(env.service.movementLock('a')).toBeUndefined();
    expect(env.service.blocksCombatIntent('a', 'melee')).toBe(false);
    expect(env.service.blocksManualDrop('a')).toBe(true);
    expect(env.service.shouldCancelPlayerDamage('b', 'a')).toBe(false);
    expect(env.service.shouldCancelPlayerDamage('a', 'c')).toBe(true);
    expect(env.service.shouldCancelPlayerDamage('c', 'a')).toBe(true);
    expect(env.service.shouldCancelPlayerDamage('c', 'd')).toBe(false);
    expect(env.service.shouldCancelPlayerDamage('a')).toBe(false);
    expect(env.service.shouldSuppressNormalPvpSettlement('b', 'a')).toBe(true);
    expect(env.service.shouldSuppressNormalPvpSettlement('c', 'a')).toBe(false);
    expect(env.service.externalTeleportError('b')).toBe(DUEL_TELEPORT_DENIED);
  });

  it('records one mirrored win and a 3s cooldown', () => {
    const env = harness();
    begin(env);
    env.advance(DUEL_COUNTDOWN_MS);
    env.service.tick();
    env.service.finalizeDeath('b', ['loot-1']);
    expect(env.service.phaseKind()).toBe('loot');
    expect(env.service.statsOf('a')).toMatchObject({ wins: 1, losses: 0 });
    expect(env.service.statsOf('b')).toMatchObject({ wins: 0, losses: 1 });
    expect(env.service.headToHead('a', 'b')).toEqual({ wins: 1, losses: 0 });
    expect(env.service.headToHead('b', 'a')).toEqual({ wins: 0, losses: 1 });
    expect(env.service.allowsPickup('a', 'loot-1')).toBe(true);
    expect(env.service.allowsPickup('c', 'loot-1')).toBe(false);
    expect(env.service.allowsPickup('a', 'other')).toBe(true);
    expect(env.service.cooldownRemaining('a')).toBe(DUEL_POST_MATCH_COOLDOWN_MS);
    expect(env.service.cooldownRemaining('b')).toBe(DUEL_POST_MATCH_COOLDOWN_MS);
    expect(env.service.challenge('b', 'a').message).toMatch(/Подождите/);
    expect(env.service.challenge('a', 'b').message).toMatch(/уже участвует/);
    env.advance(DUEL_POST_MATCH_COOLDOWN_MS);
    expect(env.service.cooldownRemaining('a')).toBe(0);
    env.service.noteIdentity('b', 'Bobby');
    expect(env.stats().players.b!.displayName).toBe('Bobby');
    expect(env.stats().players.a!.opponents.b!.displayName).toBe('Bobby');
    expect(env.stats().players.a!.wins).toBe(1);
    const reloaded = env.reload();
    expect(reloaded.statsOf('a').wins).toBe(1);
    expect(reloaded.statsOf('b')).toMatchObject({ wins: 0, losses: 1, displayName: 'Bobby' });
    expect(reloaded.headToHead('a', 'b')).toEqual({ wins: 1, losses: 0 });
  });

  it('counts a fighting disconnect as a forfeit and a countdown disconnect as a cancel', () => {
    const env = harness();
    begin(env);
    env.service.onPlayerQuit('b');
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.service.statsOf('a').wins).toBe(0);
    expect(env.service.statsOf('b').losses).toBe(0);
    expect(env.drops).toEqual([]);
    expect(env.restores.sort()).toEqual(['a', 'b']);
    expect(env.service.cooldownRemaining('a')).toBe(0);
    expect(env.holograms.at(-1)).toBe('clear');

    const again = begin(env);
    expect(again).toBeGreaterThan(0);
    env.advance(DUEL_COUNTDOWN_MS);
    env.service.tick();
    env.service.onPlayerQuit('b');
    expect(env.service.phaseKind()).toBe('loot');
    expect(env.service.statsOf('a')).toMatchObject({ wins: 1, losses: 0 });
    expect(env.service.statsOf('b')).toMatchObject({ wins: 0, losses: 1 });
    expect(env.drops).toHaveLength(1);
    expect(env.relocates).toEqual(['b']);
    expect(env.service.allowsPickup('a', env.drops[0]!)).toBe(true);
    expect(env.service.externalTeleportError('a')).toBe(DUEL_TELEPORT_DENIED);
    expect(env.service.externalTeleportError('b')).toBeUndefined();
  });

  it('gives both players a loss on timeout and lets nobody pick the drops up', () => {
    const env = harness();
    const started = begin(env);
    env.setNow(started + DUEL_COUNTDOWN_MS);
    env.service.tick();
    env.setNow(started + DUEL_COUNTDOWN_MS + DUEL_MATCH_DURATION_MS);
    env.service.tick();
    expect(env.service.phaseKind()).toBe('timeout_cleanup');
    expect(env.service.statsOf('a')).toEqual({ wins: 0, losses: 1, displayName: 'Ada' });
    expect(env.service.statsOf('b')).toEqual({ wins: 0, losses: 1, displayName: 'Bob' });
    expect(env.service.headToHead('a', 'b')).toEqual({ wins: 0, losses: 1 });
    expect(env.service.headToHead('b', 'a')).toEqual({ wins: 0, losses: 1 });
    expect(env.drops).toHaveLength(2);
    expect(env.service.allowsPickup('a', env.drops[0]!)).toBe(false);
    expect(env.service.allowsPickup('b', env.drops[1]!)).toBe(false);
    expect(env.service.allowsPickup('c', env.drops[0]!)).toBe(false);
    expect(env.relocates.sort()).toEqual(['a', 'b']);
    env.advance(DUEL_LOOT_WINDOW_MS);
    env.service.tick();
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.removed.at(-1)).toEqual(env.drops);
  });

  it('cancels countdown and fighting on shutdown without touching stats or loot results', () => {
    const env = harness();
    begin(env);
    env.service.shutdown();
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.service.statsOf('a').wins).toBe(0);
    expect(env.drops).toEqual([]);
    expect(env.restores).toHaveLength(2);

    begin(env);
    env.advance(DUEL_COUNTDOWN_MS);
    env.service.tick();
    env.service.shutdown();
    expect(env.service.statsOf('a').losses).toBe(0);
    expect(env.service.statsOf('b').losses).toBe(0);
    expect(env.drops).toEqual([]);

    begin(env);
    env.advance(DUEL_COUNTDOWN_MS);
    env.service.tick();
    env.service.finalizeDeath('b', ['kept']);
    const wins = env.service.statsOf('a').wins;
    env.service.shutdown();
    expect(env.service.phaseKind()).toBe('idle');
    expect(env.service.statsOf('a').wins).toBe(wins);
    expect(env.removed.flat()).toContain('kept');
    expect(env.relocates).toContain('a');
  });

  it('commits a match result once across death, disconnect, and timeout', () => {
    const env = harness();
    const started = begin(env);
    env.setNow(started + DUEL_COUNTDOWN_MS);
    env.service.tick();
    env.service.finalizeDeath('b', ['once']);
    env.service.finalizeDeath('b', ['twice']);
    env.service.onPlayerQuit('b');
    env.service.onPlayerQuit('a');
    env.setNow(started + DUEL_COUNTDOWN_MS + DUEL_MATCH_DURATION_MS + DUEL_LOOT_WINDOW_MS);
    env.service.tick();
    expect(env.service.statsOf('a')).toMatchObject({ wins: 1, losses: 0 });
    expect(env.service.statsOf('b')).toMatchObject({ wins: 0, losses: 1 });
    expect(env.drops).toEqual([]);
    expect(env.service.phaseKind()).toBe('idle');

    const race = harness();
    const raceStart = begin(race);
    race.setNow(raceStart + DUEL_COUNTDOWN_MS + DUEL_MATCH_DURATION_MS);
    race.service.tick();
    race.service.finalizeDeath('b', ['late']);
    race.service.onPlayerQuit('a');
    race.service.tick();
    expect(race.service.statsOf('a')).toEqual({ wins: 0, losses: 1, displayName: 'Ada' });
    expect(race.service.statsOf('b')).toEqual({ wins: 0, losses: 1, displayName: 'Bob' });
    expect(race.drops).toHaveLength(2);
  });
});
