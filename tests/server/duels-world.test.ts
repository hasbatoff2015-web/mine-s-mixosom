import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { createItemStack, parseSerializedItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { MAX_AIR_TICKS, MAX_HEALTH, MAX_HUNGER } from '../../src/survival/SurvivalSystem';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import {
  DUEL_ARENA_BUSY,
  DUEL_COUNTDOWN_HOLOGRAM,
  DUEL_COUNTDOWN_HOLOGRAM_SIZE,
  DUEL_COUNTDOWN_MS,
  DUEL_LOOT_WINDOW_MS,
  DUEL_MATCH_DURATION_MS,
  DUEL_TELEPORT_DENIED,
  DUEL_UNAVAILABLE,
  duelStartBurstPosition,
} from '../../shared/duels';
import { parseServerMessage, type ClientInventoryActionMessage, type ClientInputMessage, type ServerMenuMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-duels-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1',
      PORT: '0',
      WORLD: 'anarchy',
      WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8',
      CHUNK_VIEW_RADIUS: '1',
      TICK_RATE: '20',
      PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: true,
    operators: ['Op'],
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function duelEffects(sink: MemorySink): Array<{ x: number; y: number; z: number; effect?: string }> {
  const effects: Array<{ x: number; y: number; z: number; effect?: string }> = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; effect?: string; x?: number; y?: number; z?: number };
    if (record.type === 'duel_effect') {
      effects.push({ effect: record.effect, x: record.x ?? 0, y: record.y ?? 0, z: record.z ?? 0 });
    }
  }
  return effects;
}

function texts(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

function lastMenu(sink: MemorySink): ServerMenuMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const record = sink.payloads[index] as { type?: string };
    if (record.type === 'menu') return sink.payloads[index] as ServerMenuMessage;
  }
  return undefined;
}

function stack(itemId: string, count = 1, durability?: number) {
  const parsed = parseSerializedItemStack({
    itemId,
    count,
    ...(durability === undefined ? {} : { durability }),
  });
  if (!parsed) throw new Error(`stack rejected: ${itemId}`);
  return parsed;
}

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
    clientTick: seq,
    forward: 0,
    right: 0,
    jump: false,
    sneak: false,
    sprint: false,
    descend: false,
    flySprint: false,
    yaw: 0,
    pitch: 0,
    selectedSlot: 0,
    ...extra,
  };
}

describe('authoritative 1v1 duels', { timeout: 180_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string) {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    let now = 1_000_000;
    world.duels.setNow(() => now);
    const clock = {
      now: () => now,
      set: (value: number) => { now = value; },
      advance: (ms: number) => { now += ms; },
    };
    return { world, dir, clock };
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    result.player.gamemode = 'survival';
    return { ...result, sink };
  }

  function arena(world: WorldInstance) {
    const spawn1 = { worldId: world.worldId, x: 20.5, y: 100, z: 20.5, yaw: Math.PI, pitch: 0 };
    const spawn2 = { worldId: world.worldId, x: 20.5, y: 100, z: 22.5, yaw: 0, pitch: 0 };
    expect(world.duels.setSpawn(1, spawn1).ok).toBe(true);
    expect(world.duels.setSpawn(2, spawn2).ok).toBe(true);
    world.world.setBlock(20, 99, 20, BlockId.Stone);
    world.world.setBlock(20, 99, 22, BlockId.Stone);
    return { spawn1, spawn2 };
  }

  function stand(player: ServerPlayer, x: number, y = 80, z = 10) {
    player.controller.teleport([x, y, z]);
    player.controller.velocity.set(0, 0, 0);
  }

  function fight(world: WorldInstance, clock: { advance: (ms: number) => void }, a: ServerPlayer, b: ServerPlayer) {
    stand(a, 8.5, 80, 8.5);
    stand(b, 10.5, 80, 8.5);
    expect(world.duels.challenge(a.id, b.id).ok).toBe(true);
    const requestId = world.duels.menu(b.id).incoming[0]?.requestId;
    if (!requestId) throw new Error('missing invite');
    expect(world.duels.accept(b.id, requestId).ok).toBe(true);
    expect(world.duels.phaseKind()).toBe('countdown');
    clock.advance(DUEL_COUNTDOWN_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('fighting');
  }

  function giveSword(player: ServerPlayer) {
    player.inventory.clear();
    player.inventory.setSlot(0, stack(ItemId.GodSword));
    player.selectedSlot = 0;
    player.controller.yaw = player.controller.position.z < 22 ? Math.PI : 0;
    player.controller.pitch = 0;
  }

  it('prepares players, freezes countdown, then unlocks the fight', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    arena(world);
    stand(ada.player, 8.5);
    stand(bob.player, 10.5);
    const sword = stack(ItemId.DiamondSword, 1, 1000);
    ada.player.inventory.setSlot(0, sword);
    ada.player.survival.health = 4;
    ada.player.survival.hunger = 3;
    ada.player.survival.saturation = 0;
    ada.player.survival.airTicks = 5;
    ada.player.survival.ignite(80);
    ada.player.survival.applyEffect({ id: 'invisibility', amplifier: 0, durationTicks: 100 });
    ada.player.survival.applyEffect({ id: 'regeneration', amplifier: 0, durationTicks: 100 });
    ada.player.survival.absorption = 8;
    ada.player.survival.hurtResistance.receive(6);
    ada.player.combat.swordBlocking = true;
    ada.player.controller.velocity.set(2, 2, 2);
    ada.player.miningTarget = { x: 1, y: 2, z: 3 };
    ada.player.bowUseTicks = 4;
    const before = ada.player.inventory.getSlot(0);
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.duels.accept(bob.player.id, world.duels.menu(bob.player.id).incoming[0]!.requestId).ok).toBe(true);

    expect(ada.player.survival.health).toBe(MAX_HEALTH);
    expect(ada.player.survival.hunger).toBe(MAX_HUNGER);
    expect(ada.player.survival.saturation).toBe(MAX_HUNGER);
    expect(ada.player.survival.airTicks).toBe(MAX_AIR_TICKS);
    expect(ada.player.survival.isOnFire).toBe(false);
    expect(ada.player.survival.activeEffects()).toEqual([]);
    expect(ada.player.survival.absorption).toBe(0);
    expect(ada.player.survival.hurtResistance.remainingTicks).toBe(0);
    expect(ada.player.combat.swordBlocking).toBe(false);
    expect(ada.player.controller.velocity.lengthSq()).toBe(0);
    expect(ada.player.miningTarget).toBeUndefined();
    expect(ada.player.bowUseTicks).toBe(0);
    expect(ada.player.inventory.getSlot(0)?.durability).toBe(before?.durability);
    expect(ada.player.inventory.getSlot(0)?.count).toBe(1);
    expect(world.holograms.list().some((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM && entry.lines[0] === '3')).toBe(true);
    expect(world.holograms.listRecords().some((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM)).toBe(false);

    ada.player.inventory.setSlot(1, stack(ItemId.GoldenApple));
    ada.player.selectedSlot = 1;
    expect(world.gameplay.useHeld(ada.player, undefined, 1, 1).ok).toBe(true);
    expect(ada.player.foodUseTicks).toBe(1);
    ada.player.inventory.setSlot(0, stack(ItemId.Bow));
    ada.player.bowUseTicks = 20;
    expect(world.releaseBow(ada.player, { yaw: 0, pitch: 0, actionSeq: 1, commandSeq: 1 }).ok).toBe(false);
    expect(world.gameplay.arrows.count).toBe(0);
    const health = bob.player.survival.health;
    world.attack(ada.player);
    expect(bob.player.survival.health).toBe(health);
    const fall = world.events.createPlayerDamage(ada.player.id, 8, 'fall');
    world.events.emit('playerDamage', fall);
    expect(fall.cancelled).toBe(true);

    const locked = ada.player.controller.position.clone();
    world.applyInput(ada.player, input(1, { forward: 1, jump: true, yaw: Math.PI }));
    world.tick();
    expect(ada.player.controller.position.x).toBeCloseTo(locked.x, 4);
    expect(ada.player.controller.position.y).toBeCloseTo(locked.y, 4);
    expect(ada.player.controller.position.z).toBeCloseTo(locked.z, 4);
    expect(ada.player.controller.velocity.lengthSq()).toBe(0);

    clock.advance(1_670);
    world.duels.tick();
    expect(world.duels.shownCountdownText()).toBe('2');
    clock.advance(1_670);
    world.duels.tick();
    expect(world.duels.shownCountdownText()).toBe('1');
    clock.advance(DUEL_COUNTDOWN_MS - 3_340);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('fighting');
    expect(world.duels.shownCountdownText()).toBe('БОЙ!');
    expect(world.duels.fightDeadline()).toBe(clock.now() + DUEL_MATCH_DURATION_MS);
    expect(texts(ada.sink).some((line) => line.includes('Дуэль началась'))).toBe(true);

    world.applyInput(ada.player, input(2, { forward: 1, yaw: Math.PI }));
    const beforeMove = ada.player.controller.position.clone();
    world.tick();
    const moved = ada.player.controller.position.distanceToSquared(beforeMove) > 0.0001
      || ada.player.controller.velocity.lengthSq() > 0;
    expect(moved).toBe(true);
    expect(world.duels.movementLock(ada.player.id)).toBeUndefined();
    expect(world.duels.blocksCombatIntent(ada.player.id, 'melee')).toBe(false);
  });

  it('locks external teleports and still allows the duel relocation bypass', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    arena(world);
    expect(world.homes.set(ada.player.name, 'base', {
      worldId: world.worldId, x: 4.5, y: 80, z: 4.5,
    }, 3).ok).toBe(true);
    expect(world.teleports.now(ada.player.id, { x: 6.5, y: 80, z: 6.5 }, 'command').ok).toBe(true);
    fight(world, clock, ada.player, bob.player);
    const stayed = ada.player.controller.position.clone();
    for (const reason of ['spawn', 'home', 'back', 'tpa', 'rtp', 'portal', 'command', 'friends', 'clan'] as const) {
      const result = world.teleports.now(ada.player.id, { x: 3.5, y: 80, z: 3.5 }, reason);
      expect(result.ok, reason).toBe(false);
      expect(result.error).toBe(DUEL_TELEPORT_DENIED);
    }
    expect(world.rtpSessions.enqueue(ada.player.id, {
      minX: 0, maxX: 8, minZ: 0, maxZ: 8, attemptsPerTick: 1, maxAttempts: 1, maxChunkGenerates: 0,
    }, { reason: 'portal' }).error).toBe(DUEL_TELEPORT_DENIED);
    expect(world.hardRelocatePlayer(ada.player, 3.5, 80, 3.5)).toBe(false);
    expect(ada.player.controller.position.x).toBeCloseTo(stayed.x, 4);
    expect(world.hardRelocatePlayer(ada.player, stayed.x, stayed.y, stayed.z, undefined, { bypass: 'duel' })).toBe(true);

    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/spawn');
    expect(texts(ada.sink).join('\n')).toContain(DUEL_TELEPORT_DENIED);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/home base');
    expect(texts(ada.sink).join('\n')).toContain(DUEL_TELEPORT_DENIED);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/back');
    expect(texts(ada.sink).join('\n')).toContain(DUEL_TELEPORT_DENIED);
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/rtp');
    expect(texts(ada.sink).join('\n')).toContain(DUEL_TELEPORT_DENIED);
    world.handleChat(ada.player, '/tpa Cara');
    cara.sink.payloads.length = 0;
    world.handleChat(cara.player, '/tpaccept');
    expect(texts(cara.sink).join('\n')).toContain(DUEL_TELEPORT_DENIED);
    expect(ada.player.controller.position.x).toBeCloseTo(stayed.x, 3);

    world.duels.onPlayerQuit(bob.player.id);
    expect(world.duels.phaseKind()).toBe('loot');
    expect(world.teleports.now(ada.player.id, { x: 3.5, y: 80, z: 3.5 }, 'spawn').error).toBe(DUEL_TELEPORT_DENIED);
    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.teleports.now(ada.player.id, { x: 5.5, y: 80, z: 5.5 }, 'spawn').ok).toBe(true);
  });

  it('isolates pair damage, keeps claim PvP, lets Totem continue, and skips Megacoins', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    arena(world);
    world.economy.setBalance(ada.player.id, 1000, 'ADMIN_SET');
    world.economy.setBalance(bob.player.id, 500, 'ADMIN_SET');
    fight(world, clock, ada.player, bob.player);
    stand(cara.player, 21.5, 100, 20.5);
    giveSword(ada.player);
    giveSword(cara.player);
    bob.player.inventory.setSlot(0, stack(ItemId.DiamondSword));
    bob.player.selectedSlot = 0;

    const bobHealth = bob.player.survival.health;
    world.gameplay.arrows.spawn(
      { x: bob.player.controller.position.x + 1.2, y: bob.player.controller.position.y + 0.9, z: bob.player.controller.position.z },
      { x: -1, y: 0, z: 0 },
      8,
      4,
      false,
      false,
      undefined,
      cara.player.id,
    );
    world.tick();
    expect(world.gameplay.arrows.count).toBe(0);
    expect(bob.player.survival.health).toBe(bobHealth);

    const caraHealth = cara.player.survival.health;
    world.gameplay.arrows.spawn(
      { x: cara.player.controller.position.x + 1.2, y: cara.player.controller.position.y + 0.9, z: cara.player.controller.position.z },
      { x: -1, y: 0, z: 0 },
      8,
      4,
      false,
      false,
      undefined,
      ada.player.id,
    );
    world.tick();
    expect(cara.player.survival.health).toBe(caraHealth);
    ada.player.controller.teleport([20.5, 100, 20.5]);
    bob.player.controller.teleport([20.5, 100, 22.5]);
    ada.player.controller.velocity.set(0, 0, 0);
    bob.player.controller.velocity.set(0, 0, 0);
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;

    world.pluginStore.save('claims/claims', {
      claims: [{
        id: 'arena-claim',
        name: 'arena',
        owner: 'ada',
        worldId: world.worldId,
        volume: { minX: 0, minY: 0, minZ: 0, maxX: 40, maxY: 200, maxZ: 40 },
        members: [],
        priority: 0,
        flags: { pvp: false },
      }],
    });
    world.attack(ada.player);
    expect(bob.player.survival.health).toBe(bobHealth);
    world.attack(cara.player);
    expect(bob.player.survival.health).toBe(bobHealth);

    world.pluginStore.save('claims/claims', {
      claims: [{
        id: 'arena-claim',
        name: 'arena',
        owner: 'ada',
        worldId: world.worldId,
        volume: { minX: 0, minY: 0, minZ: 0, maxX: 40, maxY: 200, maxZ: 40 },
        members: [],
        priority: 0,
        flags: { pvp: true },
      }],
    });
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;
    bob.player.inventory.setSlot({ section: 'offhand' }, stack(ItemId.TotemOfUndying));
    world.attack(ada.player);
    expect(bob.player.survival.dead).toBe(false);
    expect(bob.player.survival.health).toBe(1);
    expect(bob.player.inventory.offhand).toBeNull();
    expect(world.duels.phaseKind()).toBe('fighting');
    expect(world.duels.statsOf(ada.player.id).wins).toBe(0);
    expect(world.economy.getBalance(ada.player.id)).toBe(1000);
    expect(world.economy.getBalance(bob.player.id)).toBe(500);
    expect(world.economy.getKills(ada.player.id)).toBe(0);

    ada.player.controller.teleport([20.5, 100, 20.5]);
    ada.player.controller.velocity.set(0, 0, 0);
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;
    bob.player.controller.teleport([20.5, 100, 22.5]);
    bob.player.controller.velocity.set(0, 0, 0);
    giveSword(ada.player);
    ada.player.controller.yaw = Math.PI;
    const lethal = world.gameplay.attack(ada.player, [ada.player, bob.player, cara.player]);
    expect(lethal.result).toBe('hit');
    expect(bob.player.survival.dead).toBe(false);
    expect(bob.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(bob.player.controller.position.y).toBeCloseTo(world.spawn[1], 3);
    expect(bob.player.controller.position.z).toBeCloseTo(world.spawn[2], 3);
    expect(world.duels.phaseKind()).toBe('loot');
    expect(world.duels.statsOf(ada.player.id)).toMatchObject({ wins: 1, losses: 0 });
    expect(world.duels.statsOf(bob.player.id)).toMatchObject({ wins: 0, losses: 1 });
    expect(world.duels.headToHead(ada.player.id, bob.player.id)).toEqual({ wins: 1, losses: 0 });
    expect(world.economy.getBalance(ada.player.id)).toBe(1000);
    expect(world.economy.getBalance(bob.player.id)).toBe(500);
    expect(world.economy.getKills(ada.player.id)).toBe(0);

    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    stand(ada.player, 30.5, 100, 30.5);
    stand(bob.player, 30.5, 100, 32.5);
    world.world.setBlock(30, 99, 30, BlockId.Stone);
    world.world.setBlock(30, 99, 32, BlockId.Stone);
    giveSword(ada.player);
    ada.player.controller.yaw = Math.PI;
    world.attack(ada.player);
    expect(world.economy.getBalance(ada.player.id)).toBe(1050);
    expect(world.economy.getBalance(bob.player.id)).toBe(450);
    expect(world.economy.getKills(ada.player.id)).toBe(1);
    expect(world.duels.statsOf(ada.player.id).wins).toBe(1);
  });

  it('drops every resource once, lets only the winner loot, then clears the arena', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    arena(world);
    fight(world, clock, ada.player, bob.player);
    giveSword(ada.player);
    bob.player.inventory.clear();
    bob.player.inventory.setSlot(0, stack('dirt', 3));
    bob.player.inventory.setSlot(10, stack('cobblestone', 2));
    bob.player.inventory.setSlot({ section: 'armor', slot: 'head' }, stack(ItemId.LeatherHelmet));
    bob.player.inventory.setSlot({ section: 'offhand' }, stack(ItemId.Apple));
    bob.player.cursor = stack(ItemId.Diamond, 1);
    bob.player.craftSlots[0] = stack(ItemId.Bread, 1);
    const before = world.gameplay.drops.serialize().length;
    world.attack(ada.player);
    const dropped = world.gameplay.drops.serialize();
    expect(dropped.length - before).toBe(6);
    expect(world.duels.trackedDropIds()).toHaveLength(6);
    expect(bob.player.inventory.slots.every((slot) => slot === null)).toBe(true);
    expect(bob.player.inventory.armor.head).toBeNull();
    expect(bob.player.inventory.offhand).toBeNull();
    expect(bob.player.cursor).toBeNull();
    expect(bob.player.craftSlots.every((slot) => slot === null)).toBe(true);
    const ids = new Set(world.duels.trackedDropIds());
    expect(dropped.filter((entry) => ids.has(entry.id))).toHaveLength(6);
    world.gameplay.respawnIfDead(bob.player);
    expect(world.gameplay.drops.serialize().length).toBe(dropped.length);

    for (let step = 0; step < 6; step += 1) world.gameplay.drops.update(0.25);
    cara.player.inventory.clear();
    const positions = world.gameplay.drops.serialize().filter((entry) => ids.has(entry.id));
    for (const entry of positions) {
      cara.player.controller.teleport([entry.position[0], entry.position[1], entry.position[2]]);
      world.gameplay.collectFor(cara.player);
    }
    expect(cara.player.inventory.count('dirt')).toBe(0);
    expect(cara.player.inventory.count('cobblestone')).toBe(0);
    expect(world.gameplay.drops.serialize().filter((entry) => ids.has(entry.id))).toHaveLength(6);
    for (const entry of world.gameplay.drops.serialize().filter((item) => ids.has(item.id))) {
      ada.player.controller.teleport([entry.position[0], entry.position[1], entry.position[2]]);
      world.gameplay.collectFor(ada.player);
    }
    expect(ada.player.inventory.count('dirt')).toBe(3);
    expect(ada.player.inventory.count('cobblestone')).toBe(2);

    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.gameplay.drops.serialize().some((entry) => ids.has(entry.id))).toBe(false);
    expect(ada.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(ada.player.controller.position.z).toBeCloseTo(world.spawn[2], 3);

    const norman = join(world, 'Norm');
    norman.player.inventory.clear();
    norman.player.inventory.setSlot(0, stack('dirt', 2));
    norman.player.survival.health = 0;
    norman.player.survival.dead = true;
    const outsideBefore = world.gameplay.drops.serialize().length;
    world.gameplay.respawnIfDead(norman.player);
    expect(world.gameplay.drops.serialize().length - outsideBefore).toBe(1);
    expect(norman.player.survival.dead).toBe(true);
    expect(norman.player.inventory.getSlot(0)).toBeNull();
    world.gameplay.respawnIfDead(norman.player);
    expect(world.gameplay.drops.serialize().length - outsideBefore).toBe(1);
  });

  it('forfeits a fighting disconnect and cancels a countdown disconnect', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    arena(world);
    world.economy.setBalance(ada.player.id, 1000, 'ADMIN_SET');
    world.economy.setBalance(bob.player.id, 500, 'ADMIN_SET');
    const preA = { x: 8.5, y: 80, z: 8.5 };
    const preB = { x: 10.5, y: 80, z: 8.5 };
    stand(ada.player, preA.x, preA.y, preA.z);
    stand(bob.player, preB.x, preB.y, preB.z);
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.duels.accept(bob.player.id, world.duels.menu(bob.player.id).incoming[0]!.requestId).ok).toBe(true);
    const token = bob.player.sessionToken;
    world.disconnect(bob.player.id);
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.duels.statsOf(ada.player.id).wins).toBe(0);
    expect(world.duels.statsOf(bob.player.id).losses).toBe(0);
    expect(ada.player.controller.position.x).toBeCloseTo(preA.x, 3);
    expect(ada.player.controller.position.z).toBeCloseTo(preA.z, 3);
    expect(bob.player.controller.position.x).toBeCloseTo(preB.x, 3);
    expect(bob.player.controller.position.z).toBeCloseTo(preB.z, 3);
    expect(world.holograms.list().some((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM)).toBe(false);
    const resumed = join(world, 'Bob', token);
    expect(resumed.player.controller.position.x).toBeCloseTo(preB.x, 3);

    stand(ada.player, 8.5);
    stand(bob.player, 10.5);
    bob.player.inventory.clear();
    bob.player.inventory.setSlot(0, stack('dirt', 4));
    fight(world, clock, ada.player, bob.player);
    world.disconnect(bob.player.id);
    expect(world.duels.phaseKind()).toBe('loot');
    expect(world.duels.statsOf(ada.player.id).wins).toBe(1);
    expect(world.duels.statsOf(bob.player.id).losses).toBe(1);
    expect(world.economy.getBalance(ada.player.id)).toBe(1000);
    expect(world.economy.getBalance(bob.player.id)).toBe(500);
    expect(bob.player.inventory.getSlot(0)).toBeNull();
    expect(bob.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(bob.player.controller.position.z).toBeCloseTo(world.spawn[2], 3);
    expect(world.gameplay.drops.serialize().some((entry) => entry.stack.itemId === 'dirt' && entry.stack.count === 4)).toBe(true);
    const back = join(world, 'Bobby', token);
    expect(back.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(back.player.inventory.getSlot(0)).toBeNull();
    expect(world.duels.statsOf(back.player.id).losses).toBe(1);
    expect(world.duels.statsOf(back.player.id).displayName === 'Bob' || world.duels.menu(ada.player.id).stats.wins === 1).toBe(true);
  });

  it('drops both inventories on timeout and deletes those exact entities after 15s', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    arena(world);
    fight(world, clock, ada.player, bob.player);
    ada.player.inventory.clear();
    bob.player.inventory.clear();
    ada.player.inventory.setSlot(0, stack('dirt', 1));
    bob.player.inventory.setSlot(0, stack('cobblestone', 1));
    const started = clock.now();
    clock.set(started + DUEL_MATCH_DURATION_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('timeout_cleanup');
    expect(world.duels.statsOf(ada.player.id)).toMatchObject({ wins: 0, losses: 1 });
    expect(world.duels.statsOf(bob.player.id)).toMatchObject({ wins: 0, losses: 1 });
    expect(world.duels.headToHead(ada.player.id, bob.player.id).wins).toBe(0);
    expect(ada.player.inventory.getSlot(0)).toBeNull();
    expect(bob.player.inventory.getSlot(0)).toBeNull();
    expect(ada.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(bob.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    const ids = world.duels.trackedDropIds();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    for (let step = 0; step < 6; step += 1) world.gameplay.drops.update(0.25);
    cara.player.inventory.clear();
    for (const player of [ada.player, bob.player, cara.player]) {
      for (const entry of world.gameplay.drops.serialize().filter((item) => ids.includes(item.id))) {
        player.controller.teleport([entry.position[0], entry.position[1], entry.position[2]]);
        world.gameplay.collectFor(player);
        expect(player.inventory.count('dirt') + player.inventory.count('cobblestone')).toBe(0);
      }
    }
    expect(world.gameplay.drops.serialize().filter((entry) => ids.includes(entry.id))).toHaveLength(ids.length);
    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.gameplay.drops.serialize().some((entry) => ids.includes(entry.id))).toBe(false);
  });

  it('restores players on plugin shutdown and does not roll back a finished result', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    arena(world);
    stand(ada.player, 8.5, 80, 8.5);
    stand(bob.player, 10.5, 80, 8.5);
    ada.player.inventory.setSlot(3, stack(ItemId.Diamond, 2));
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.duels.accept(bob.player.id, world.duels.menu(bob.player.id).incoming[0]!.requestId).ok).toBe(true);
    clock.advance(DUEL_COUNTDOWN_MS);
    world.duels.tick();
    await world.plugins.disable('duels');
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.duels.statsOf(ada.player.id).wins).toBe(0);
    expect(world.duels.statsOf(ada.player.id).losses).toBe(0);
    expect(ada.player.controller.position.x).toBeCloseTo(8.5, 3);
    expect(bob.player.controller.position.x).toBeCloseTo(10.5, 3);
    expect(ada.player.inventory.getSlot(3)?.count).toBe(2);
    expect(world.holograms.list().some((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM)).toBe(false);

    await world.plugins.enable('duels');
    world.duels.setNow(() => clock.now());
    arena(world);
    fight(world, clock, ada.player, bob.player);
    giveSword(ada.player);
    world.attack(ada.player);
    expect(world.duels.statsOf(ada.player.id).wins).toBe(1);
    const ids = [...world.duels.trackedDropIds()];
    await world.plugins.disable('duels');
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.duels.statsOf(ada.player.id).wins).toBe(1);
    expect(ada.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(world.gameplay.drops.serialize().some((entry) => ids.includes(entry.id))).toBe(false);
  });

  it('rejects manual world drops during a duel without changing a normal drop', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    arena(world);
    fight(world, clock, ada.player, bob.player);
    ada.player.inventory.setSlot(0, stack('dirt', 4));
    ada.player.selectedSlot = 0;
    const drop: ClientInventoryActionMessage = {
      type: 'inventory_action', action: 'drop_selected', slot: 0, count: 1,
    };
    const before = world.gameplay.drops.serialize().length;
    expect(world.gameplay.applyInventory(ada.player, drop).ok).toBe(false);
    expect(ada.player.inventory.getSlot(0)?.count).toBe(4);
    expect(world.gameplay.drops.serialize().length).toBe(before);
    cara.player.inventory.setSlot(0, stack('dirt', 4));
    cara.player.selectedSlot = 0;
    expect(world.gameplay.applyInventory(cara.player, drop).ok).toBe(true);
    expect(cara.player.inventory.getSlot(0)?.count).toBe(3);
    expect(world.gameplay.drops.serialize().length).toBe(before + 1);
  });

  it('serves the duel menu, notifications, and arena commands from the server', async () => {
    const { world, clock } = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    stand(op.player, 40.5, 80, 40.5);
    op.sink.payloads.length = 0;
    world.handleChat(ada.player, '/duel setspawn 1');
    expect(texts(ada.sink).join('\n')).toMatch(/прав/);
    world.handleChat(op.player, '/duel setspawn 1');
    expect(texts(op.sink).join('\n')).toMatch(/Точка 1/);
    stand(op.player, 44.5, 81, 40.5);
    op.sink.payloads.length = 0;
    world.handleChat(op.player, '/duel setspawn 2');
    expect(texts(op.sink).join('\n')).toMatch(/Точка 2/);
    op.sink.payloads.length = 0;
    world.handleChat(op.player, '/duel info');
    const info = texts(op.sink).join('\n');
    expect(info).toMatch(/Арена свободна/);
    expect(info).toContain('40.50');
    expect(info).toContain('44.50');
    ada.sink.payloads.length = 0;
    world.handleChat(ada.player, '/duel');
    expect(lastMenu(ada.sink)?.screen).toBe('duels');

    stand(ada.player, 8.5, 80, 8.5);
    stand(bob.player, 10.5, 80, 8.5);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'duels' });
    world.handleMenuAction(ada.player, {
      type: 'menu_action', action: 'duel_challenge', playerId: bob.player.id,
    });
    expect(world.notifications.counts(bob.player.id).duels).toBe(1);
    expect(texts(bob.sink).some((line) => line.includes('вызывает вас на дуэль'))).toBe(true);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'open', screen: 'duels' });
    const incoming = lastMenu(bob.sink);
    expect(incoming?.screen).toBe('duels');
    expect(incoming?.duelIncoming?.[0]?.name).toBe('Ada');
    expect(incoming?.duelIncoming?.[0]?.wins).toBe(0);
    expect(world.notifications.counts(bob.player.id).duels).toBe(0);
    expect(world.duels.menu(bob.player.id).incoming).toHaveLength(1);
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'duel_decline', requestId: incoming?.duelIncoming?.[0]?.requestId });
    expect(texts(ada.sink).some((line) => line.includes('отклонил вызов'))).toBe(true);
    clock.advance(10_000);
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'duel_refresh' });
    world.handleMenuAction(ada.player, {
      type: 'menu_action', action: 'duel_challenge', playerId: bob.player.id,
    });
    const requestId = world.duels.menu(bob.player.id).incoming[0]?.requestId;
    expect(requestId).toBeTruthy();
    world.handleMenuAction(bob.player, { type: 'menu_action', action: 'duel_accept', requestId });
    expect(world.duels.phaseKind()).toBe('countdown');
    const cara = join(world, 'Cara');
    const dan = join(world, 'Dan');
    stand(cara.player, 60.5, 80, 60.5);
    stand(dan.player, 62.5, 80, 60.5);
    expect(world.duels.challenge(cara.player.id, dan.player.id).ok).toBe(true);
    const waiting = world.duels.menu(dan.player.id).incoming[0]!.requestId;
    expect(world.duels.accept(dan.player.id, waiting).message).toBe('Арена занята.');
    world.duels.onPlayerQuit(ada.player.id);
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.duels.accept(dan.player.id, waiting).ok).toBe(true);
  });

  it('sends one fight-start burst at the arena center to participants and nearby spectators', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const near = join(world, 'Near');
    const far = join(world, 'Far');
    const { spawn1, spawn2 } = arena(world);
    stand(ada.player, 8.5, 80, 8.5);
    stand(bob.player, 10.5, 80, 8.5);
    const started = clock.now();
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.duels.accept(bob.player.id, world.duels.menu(bob.player.id).incoming[0]!.requestId).ok).toBe(true);
    const countdown = world.holograms.list().find((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM);
    expect(countdown).toMatchObject({
      font: 'display',
      style: 'normal',
      size: DUEL_COUNTDOWN_HOLOGRAM_SIZE,
      backgroundEnabled: false,
      billboard: true,
      interactive: false,
      lines: ['3'],
    });
    expect(world.holograms.listRecords().some((entry) => entry.name === DUEL_COUNTDOWN_HOLOGRAM)).toBe(false);
    const parsed = parseServerMessage({ type: 'holograms', holograms: world.holograms.list() });
    expect(parsed).toMatchObject({
      type: 'holograms',
      holograms: expect.arrayContaining([
        expect.objectContaining({
          name: DUEL_COUNTDOWN_HOLOGRAM,
          font: 'display',
          size: 2.8,
          interactive: false,
        }),
      ]),
    });
    expect(duelEffects(ada.sink)).toEqual([]);
    expect(duelEffects(bob.sink)).toEqual([]);
    clock.advance(1_670);
    world.duels.tick();
    expect(world.duels.shownCountdownText()).toBe('2');
    clock.advance(1_670);
    world.duels.tick();
    expect(world.duels.shownCountdownText()).toBe('1');
    expect(duelEffects(ada.sink)).toEqual([]);
    expect(duelEffects(near.sink)).toEqual([]);
    ada.player.controller.teleport([500, 80, 500]);
    near.player.controller.teleport([25.5, 100, 21.5]);
    far.player.controller.teleport([400, 80, 400]);
    clock.set(started + DUEL_COUNTDOWN_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('fighting');
    const burst = duelStartBurstPosition(spawn1, spawn2);
    const expected = [{ effect: 'fight_start_burst', x: burst.x, y: burst.y, z: burst.z }];
    expect(duelEffects(ada.sink)).toEqual(expected);
    expect(duelEffects(bob.sink)).toEqual(expected);
    expect(duelEffects(near.sink)).toEqual(expected);
    expect(duelEffects(far.sink)).toEqual([]);
    world.duels.tick();
    expect(duelEffects(ada.sink)).toEqual(expected);
    expect(duelEffects(bob.sink)).toEqual(expected);
    expect(duelEffects(near.sink)).toEqual(expected);
  });

  it('blocks loot-window damage and restores duels after disable without duplicating listeners', async () => {
    const { world, clock } = await boot();
    const damageListeners = world.events.listenerCount('playerDamage');
    const pickupListeners = world.events.listenerCount('itemPickup');
    const quitListeners = world.events.listenerCount('playerQuit');
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    arena(world);
    stand(ada.player, 8.5, 80, 8.5);
    stand(bob.player, 10.5, 80, 8.5);
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.duels.accept(bob.player.id, world.duels.menu(bob.player.id).incoming[0]!.requestId).ok).toBe(true);
    await world.plugins.reload('duels');
    await world.plugins.reload('duels');
    expect(world.events.listenerCount('playerDamage')).toBe(damageListeners);
    expect(world.events.listenerCount('itemPickup')).toBe(pickupListeners);
    expect(world.events.listenerCount('playerQuit')).toBe(quitListeners);
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.duels.isEnabled()).toBe(true);
    expect(world.duels.statsOf(ada.player.id).wins).toBe(0);
    world.duels.setNow(() => clock.now());

    fight(world, clock, ada.player, bob.player);
    const fightingMelee = world.events.createPlayerDamage(ada.player.id, 4, 'melee');
    world.events.emit('playerDamage', fightingMelee);
    expect(fightingMelee.cancelled).toBe(true);
    const fightingFall = world.events.createPlayerDamage(ada.player.id, 4, 'fall');
    world.events.emit('playerDamage', fightingFall);
    expect(fightingFall.cancelled).toBe(false);
    expect(ada.player.survival.health).toBe(MAX_HEALTH);

    giveSword(ada.player);
    ada.player.controller.teleport([20.5, 100, 20.5]);
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;
    bob.player.controller.teleport([20.5, 100, 22.5]);
    bob.player.controller.velocity.set(0, 0, 0);
    bob.player.inventory.clear();
    bob.player.inventory.setSlot(0, stack('dirt', 2));
    world.attack(ada.player);
    expect(world.duels.phaseKind()).toBe('loot');
    const ids = world.duels.trackedDropIds();
    expect(ids.length).toBeGreaterThan(0);

    ada.player.controller.teleport([20.5, 100, 20.5]);
    ada.player.controller.velocity.set(0, 0, 0);
    ada.player.survival.health = 12;
    cara.player.controller.teleport([20.5, 100, 21.6]);
    cara.player.controller.velocity.set(0, 0, 0);
    giveSword(cara.player);
    cara.player.controller.yaw = 0;
    cara.player.controller.pitch = 0;
    const incoming = world.gameplay.attack(cara.player, [ada.player, cara.player]);
    expect(incoming.result).toBe('blocked');
    expect(ada.player.survival.health).toBe(12);
    const mobMelee = world.events.createPlayerDamage(ada.player.id, 6, 'melee');
    world.events.emit('playerDamage', mobMelee);
    expect(mobMelee.cancelled).toBe(true);
    const mobArrow = world.events.createPlayerDamage(ada.player.id, 6, 'arrow');
    world.events.emit('playerDamage', mobArrow);
    expect(mobArrow.cancelled).toBe(true);
    const mobProjectile = world.events.createPlayerDamage(ada.player.id, 6, 'projectile');
    world.events.emit('playerDamage', mobProjectile);
    expect(mobProjectile.cancelled).toBe(true);
    const lootFall = world.events.createPlayerDamage(ada.player.id, 6, 'fall');
    world.events.emit('playerDamage', lootFall);
    expect(lootFall.cancelled).toBe(true);
    expect(ada.player.survival.health).toBe(12);

    const caraHealth = cara.player.survival.health;
    giveSword(ada.player);
    ada.player.controller.teleport([20.5, 100, 20.5]);
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;
    expect(world.duels.blocksCombatIntent(ada.player.id, 'melee')).toBe(true);
    expect(world.duels.blocksCombatIntent(ada.player.id, 'projectile')).toBe(true);
    world.attack(ada.player);
    const outgoing = world.gameplay.attack(ada.player, [ada.player, cara.player]);
    expect(outgoing.result).toBe('blocked');
    expect(cara.player.survival.health).toBe(caraHealth);
    ada.player.inventory.setSlot(0, stack(ItemId.Bow));
    ada.player.bowUseTicks = 20;
    expect(world.releaseBow(ada.player, { yaw: Math.PI, pitch: 0, actionSeq: 4, commandSeq: 4 }).ok).toBe(false);
    expect(world.gameplay.arrows.count).toBe(0);

    for (let step = 0; step < 6; step += 1) world.gameplay.drops.update(0.25);
    const loot = world.gameplay.drops.serialize().find((entry) => ids.includes(entry.id));
    expect(loot).toBeTruthy();
    cara.player.inventory.clear();
    cara.player.controller.teleport([loot!.position[0], loot!.position[1], loot!.position[2]]);
    world.gameplay.collectFor(cara.player);
    expect(cara.player.inventory.count('dirt')).toBe(0);
    ada.player.controller.teleport([loot!.position[0], loot!.position[1], loot!.position[2]]);
    world.gameplay.collectFor(ada.player);
    expect(ada.player.inventory.count('dirt')).toBeGreaterThan(0);

    ada.player.controller.teleport([20.5, 100, 20.5]);
    ada.player.controller.velocity.set(0, 0, 0);
    ada.player.survival.health = 12;
    ada.player.survival.hunger = 0;
    ada.player.survival.saturation = 0;
    ada.player.survival.ignite(80);
    for (let step = 0; step < 25; step += 1) world.tick();
    expect(ada.player.survival.health).toBe(12);
    expect(world.duels.phaseKind()).toBe('loot');

    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    expect(world.gameplay.drops.serialize().some((entry) => ids.includes(entry.id))).toBe(false);
    expect(ada.player.controller.position.x).toBeCloseTo(world.spawn[0], 3);
    expect(ada.player.controller.position.z).toBeCloseTo(world.spawn[2], 3);
    expect(world.duels.suppressesIncomingDamage(ada.player.id)).toBe(false);
    const after = world.events.createPlayerDamage(ada.player.id, 4, 'melee');
    world.events.emit('playerDamage', after);
    expect(after.cancelled).toBe(false);
    stand(ada.player, 20.5, 100, 20.5);
    ada.player.survival.health = 12;
    ada.player.survival.hunger = 0;
    ada.player.survival.saturation = 0;
    ada.player.survival.ignite(80);
    for (let step = 0; step < 25; step += 1) world.tick();
    expect(ada.player.survival.health).toBeLessThan(12);

    await world.plugins.disable('duels');
    expect(world.duels.isEnabled()).toBe(false);
    world.openGameMenu(ada.player.id, 'duels');
    world.handleMenuAction(ada.player, {
      type: 'menu_action',
      action: 'duel_challenge',
      playerId: bob.player.id,
    });
    const blocked = lastMenu(ada.sink);
    expect(blocked?.duelAvailable).toBe(false);
    expect(blocked?.message).toBe(DUEL_UNAVAILABLE);
    expect(world.duels.phaseKind()).toBe('idle');
    await world.plugins.enable('duels');
    world.duels.setNow(() => clock.now());
    expect(world.duels.isEnabled()).toBe(true);
    expect(world.events.listenerCount('playerDamage')).toBe(damageListeners);
    stand(ada.player, 8.5, 80, 8.5);
    stand(bob.player, 10.5, 80, 8.5);
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
  });

  it('refreshes an open duel menu to idle and allows an immediate rematch when loot ends', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    arena(world);
    fight(world, clock, ada.player, bob.player);
    giveSword(ada.player);
    ada.player.controller.teleport([20.5, 100, 20.5]);
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;
    ada.player.controller.velocity.set(0, 0, 0);
    bob.player.controller.teleport([20.5, 100, 22.5]);
    bob.player.controller.velocity.set(0, 0, 0);
    world.attack(ada.player);
    expect(world.duels.phaseKind()).toBe('loot');

    world.openGameMenu(ada.player.id, 'duels');
    world.openGameMenu(bob.player.id, 'duels');
    expect(lastMenu(ada.sink)?.duelArenaBusy).toBe(true);
    expect(lastMenu(bob.sink)?.duelArenaBusy).toBe(true);
    const adaMenus = ada.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').length;
    const bobMenus = bob.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').length;

    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    expect(ada.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').length).toBe(adaMenus + 1);
    expect(bob.sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').length).toBe(bobMenus + 1);
    const idleAda = lastMenu(ada.sink);
    const idleBob = lastMenu(bob.sink);
    expect(idleAda?.duelArenaBusy).toBe(false);
    expect(idleBob?.duelArenaBusy).toBe(false);
    expect(idleAda && 'duelCooldownMs' in idleAda).toBe(false);
    expect(idleBob && 'duelCooldownMs' in idleBob).toBe(false);
    expect(idleAda?.duelNearby?.find((row) => row.playerId === bob.player.id)?.canChallenge).toBe(true);
    expect(idleBob?.duelNearby?.find((row) => row.playerId === ada.player.id)?.canChallenge).toBe(true);
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
  });

  it('shows both duelists during loot and starts the same invite after cleanup', async () => {
    const { world, clock } = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const [sx, sy, sz] = world.spawn;
    const spawn1 = { worldId: world.worldId, x: sx, y: sy, z: sz, yaw: Math.PI, pitch: 0 };
    const spawn2 = { worldId: world.worldId, x: sx, y: sy, z: sz + 2, yaw: 0, pitch: 0 };
    expect(world.duels.setSpawn(1, spawn1).ok).toBe(true);
    expect(world.duels.setSpawn(2, spawn2).ok).toBe(true);
    world.world.setBlock(Math.floor(sx), Math.floor(sy) - 1, Math.floor(sz), BlockId.Stone);
    world.world.setBlock(Math.floor(sx), Math.floor(sy) - 1, Math.floor(sz + 2), BlockId.Stone);
    stand(ada.player, sx, sy, sz);
    stand(bob.player, sx, sy, sz + 2);
    expect(world.duels.challenge(ada.player.id, bob.player.id).ok).toBe(true);
    expect(world.duels.accept(bob.player.id, world.duels.menu(bob.player.id).incoming[0]!.requestId).ok).toBe(true);
    clock.advance(DUEL_COUNTDOWN_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('fighting');

    giveSword(ada.player);
    ada.player.controller.teleport([spawn1.x, spawn1.y, spawn1.z]);
    ada.player.controller.yaw = Math.PI;
    ada.player.controller.pitch = 0;
    ada.player.controller.velocity.set(0, 0, 0);
    bob.player.controller.teleport([spawn2.x, spawn2.y, spawn2.z]);
    bob.player.controller.velocity.set(0, 0, 0);
    world.attack(ada.player);
    expect(world.duels.phaseKind()).toBe('loot');
    expect(world.duels.suppressesIncomingDamage(ada.player.id)).toBe(true);
    expect(world.duels.externalTeleportError(ada.player.id)).toBe(DUEL_TELEPORT_DENIED);

    world.openGameMenu(ada.player.id, 'duels');
    world.openGameMenu(bob.player.id, 'duels');
    const lootAda = lastMenu(ada.sink);
    const lootBob = lastMenu(bob.sink);
    expect(lootAda?.duelArenaBusy).toBe(true);
    expect(lootBob?.duelArenaBusy).toBe(true);
    expect(lootAda?.duelNearby?.find((row) => row.playerId === bob.player.id)?.canChallenge).toBe(true);
    expect(lootBob?.duelNearby?.find((row) => row.playerId === ada.player.id)?.canChallenge).toBe(true);

    expect(world.duels.challenge(bob.player.id, ada.player.id).ok).toBe(true);
    const requestId = world.duels.menu(ada.player.id).incoming[0]?.requestId;
    expect(requestId).toBeTruthy();
    const adaAtLoot = ada.player.controller.position.clone();
    const bobAtLoot = bob.player.controller.position.clone();
    const busy = world.duels.accept(ada.player.id, requestId!);
    expect(busy).toEqual({ ok: false, message: DUEL_ARENA_BUSY });
    expect(world.duels.phaseKind()).toBe('loot');
    expect(world.duels.menu(ada.player.id).incoming[0]?.requestId).toBe(requestId);
    expect(ada.player.controller.position.x).toBeCloseTo(adaAtLoot.x, 4);
    expect(bob.player.controller.position.x).toBeCloseTo(bobAtLoot.x, 4);

    clock.advance(DUEL_LOOT_WINDOW_MS);
    world.duels.tick();
    expect(world.duels.phaseKind()).toBe('idle');
    expect(lastMenu(ada.sink)?.duelArenaBusy).toBe(false);
    expect(lastMenu(ada.sink)?.duelIncoming?.[0]?.requestId).toBe(requestId);
    expect(world.duels.menu(ada.player.id).incoming[0]?.requestId).toBe(requestId);
    expect(world.duels.accept(ada.player.id, requestId!).ok).toBe(true);
    expect(world.duels.phaseKind()).toBe('countdown');
    expect(bob.player.controller.position.x).toBeCloseTo(spawn1.x, 3);
    expect(bob.player.controller.position.z).toBeCloseTo(spawn1.z, 3);
    expect(ada.player.controller.position.x).toBeCloseTo(spawn2.x, 3);
    expect(ada.player.controller.position.z).toBeCloseTo(spawn2.z, 3);
  });
});
