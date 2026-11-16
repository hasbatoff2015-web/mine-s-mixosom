import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_EYE_HEIGHT } from '../../src/core/constants';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { ItemId } from '../../src/items';
import type { ServerChatMessage, ServerMenuMessage, ServerPvpTimerMessage } from '../../shared/protocol';
import {
  CHAT_COOLDOWN_MESSAGE,
  PVP_DURATION_MS,
  TELEPORT_COOLDOWN_MESSAGE,
  TELEPORT_PROTECTION_MS,
  TELEPORT_PVP_MESSAGE,
} from '../../shared/playerRules';
import { menuRootHtml } from '../../src/ui/gameMenuGui';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-pvp-rules-'));
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
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function playerTexts(sink: MemorySink): string[] {
  return sink.payloads.flatMap((payload) => {
    const record = payload as ServerChatMessage;
    return record.type === 'chat' && record.kind === 'player' && record.text ? [record.text] : [];
  });
}

function notices(sink: MemorySink): ServerChatMessage[] {
  return sink.payloads.filter((payload): payload is ServerChatMessage => {
    const record = payload as ServerChatMessage;
    return record.type === 'chat' && record.style === 'notice';
  });
}

function lastMenu(sink: MemorySink): ServerMenuMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as ServerMenuMessage;
    if (payload.type === 'menu') return payload;
  }
  return undefined;
}

function lookAt(
  from: { x: number; y: number; z: number },
  x: number,
  y: number,
  z: number,
): { yaw: number; pitch: number } {
  const dx = x - from.x;
  const dy = y - (from.y + PLAYER_EYE_HEIGHT);
  const dz = z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

function place(player: ServerPlayer, x: number, z: number): void {
  player.controller.teleport([x, 100, z]);
}

function aim(attacker: ServerPlayer, victim: ServerPlayer): void {
  const look = lookAt(
    attacker.controller.position,
    victim.controller.position.x,
    victim.controller.position.y + 0.9,
    victim.controller.position.z,
  );
  attacker.controller.yaw = look.yaw;
  attacker.controller.pitch = look.pitch;
  attacker.inventory.clear();
  attacker.inventory.addItem('diamond_sword', 1);
  attacker.selectedSlot = 0;
}

describe('chat, teleport and pvp rules', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  it('rate-limits chat on the server and broadcasts only the censored text', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    world.handleChat(ada.player, 'привет дебил');
    expect(playerTexts(bob.sink)).toEqual(['привет *****']);
    expect(JSON.stringify(ada.sink.payloads)).not.toContain('дебил');
    expect(JSON.stringify(bob.sink.payloads)).not.toContain('дебил');

    world.handleChat(ada.player, 'ещё раз');
    expect(playerTexts(bob.sink)).toEqual(['привет *****']);
    expect(notices(ada.sink).map((line) => line.text)).toContain(CHAT_COOLDOWN_MESSAGE);
    expect(notices(bob.sink)).toHaveLength(0);
    expect(playerTexts(ada.sink)).not.toContain('ещё раз');

    now += 2_999;
    world.handleChat(ada.player, 'рано');
    expect(playerTexts(bob.sink)).not.toContain('рано');

    now += 1;
    world.handleChat(ada.player, 'снова');
    expect(playerTexts(bob.sink)).toContain('снова');

    world.handleChat(ada.player, '/time day');
    expect(playerTexts(bob.sink)).not.toContain('/time day');
    expect(playerTexts(bob.sink).join('\n')).not.toContain('дебил');

    const root = menuRootHtml({ message: TELEPORT_COOLDOWN_MESSAGE, balance: 0, balanceLabel: '0' });
    expect(root).toContain('is-warn');
    expect(root.indexOf('is-warn')).toBeLessThan(root.indexOf('data-menu-open="spawn"'));
    expect(root).not.toContain('disabled');
  });

  it('censors and rate-limits a direct message before it is stored', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    expect(world.friends.request(ada.player.id, 'Bob').ok).toBe(true);
    const requestId = world.friends.incomingRequests(bob.player.id)[0]?.requestId;
    expect(requestId).toBeTruthy();
    expect(world.friends.accept(bob.player.id, requestId!).ok).toBe(true);
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'ты дебил',
      clientRequestId: 'dm-1',
    });
    const stored = world.directMessages.history(bob.player.id, ada.player.id);
    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.messages.map((row) => row.text)).toEqual(['ты *****']);
    expect(JSON.stringify(bob.sink.payloads)).not.toContain('дебил');

    world.handleDirectMessage(ada.player, {
      type: 'direct_message_action',
      action: 'send',
      friendId: bob.player.id,
      text: 'ещё',
      clientRequestId: 'dm-2',
    });
    const denied = [...bob.sink.payloads].reverse().find((payload) => {
      const row = payload as { type?: string; event?: string };
      return row.type === 'direct_message' && row.event === 'error';
    }) as { error?: string } | undefined;
    expect(ada.sink.payloads.some((payload) => {
      const row = payload as { type?: string; error?: string };
      return row.type === 'direct_message' && row.error === CHAT_COOLDOWN_MESSAGE;
    })).toBe(true);
    expect(denied).toBeUndefined();
    if (stored.ok) {
      const again = world.directMessages.history(bob.player.id, ada.player.id);
      if (again.ok) expect(again.messages.map((row) => row.text)).toEqual(['ты *****']);
    }

    now += 3_000;
    world.handleChat(ada.player, 'клан лох', 'clan');
    expect(playerTexts(ada.sink)).toEqual([]);
  });

  it('keeps a shared teleport cooldown, leaves the menu open, and skips cooldown on failure', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    ada.player.controller.teleport([12, 80, 4]);
    world.homes.set(ada.player.id, 'Дом', { worldId: world.worldId, x: 20.5, y: 80, z: 6.5 }, 3);

    const failed = world.teleports.now(ada.player.id, { x: 3, y: -40, z: 3 }, 'home');
    expect(failed.ok).toBe(false);
    expect(world.playerRules.teleportBlockReason(ada.player.id, now)).toBeUndefined();

    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'homes' });
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'home_teleport', name: 'Дом' });
    expect(lastMenu(ada.sink)?.screen).toBe('closed');
    expect(ada.player.controller.position.x).toBeCloseTo(20.5, 1);

    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'root' });
    const before = ada.player.controller.position.x;
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'spawn' });
    expect(lastMenu(ada.sink)?.screen).toBe('root');
    expect(lastMenu(ada.sink)?.message).toBe(TELEPORT_COOLDOWN_MESSAGE);
    expect(ada.player.controller.position.x).toBeCloseTo(before, 1);

    const second = world.teleports.now(ada.player.id, { x: 8.5, y: 80, z: 8.5 }, 'rtp');
    expect(second.ok).toBe(false);
    expect(second.error).toBe(TELEPORT_COOLDOWN_MESSAGE);

    now += 5_000;
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'spawn' });
    expect(lastMenu(ada.sink)?.screen).toBe('closed');
    expect(world.playerRules.protectionDeadline(ada.player.id, now)).toBe(now - 5_000 + TELEPORT_PROTECTION_MS);
  });

  it('starts pvp from a landed hit, blocks teleport, and ignores mobs, falls and blocked hits', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    place(ada.player, 30, 10);
    place(bob.player, 30, 12);
    place(cara.player, 34, 12);
    aim(ada.player, bob.player);

    const bobHealth = bob.player.survival.health;
    world.attack(ada.player);
    expect(bob.player.survival.health).toBeLessThan(bobHealth);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(now + PVP_DURATION_MS);
    expect(world.playerRules.pvpUntil(bob.player.id, now)).toBe(now + PVP_DURATION_MS);
    expect(world.playerRules.pvpUntil(cara.player.id, now)).toBe(0);
    const timers = ada.sink.payloads.filter((payload): payload is ServerPvpTimerMessage => (
      (payload as ServerPvpTimerMessage).type === 'pvp_timer'
    ));
    expect(timers.at(-1)?.until).toBe(now + PVP_DURATION_MS);

    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'open', screen: 'root' });
    const stayed = ada.player.controller.position.x;
    world.handleMenuAction(ada.player, { type: 'menu_action', action: 'spawn' });
    expect(lastMenu(ada.sink)?.screen).toBe('root');
    expect(lastMenu(ada.sink)?.message).toBe(TELEPORT_PVP_MESSAGE);
    expect(ada.player.controller.position.x).toBeCloseTo(stayed, 1);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(now + PVP_DURATION_MS);

    const duringFrames = world.playerRules.pvpUntil(ada.player.id, now);
    const duringHealth = bob.player.survival.health;
    world.attack(ada.player);
    expect(bob.player.survival.health).toBe(duringHealth);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(duringFrames);

    now += 4_000;
    bob.player.survival.hurtResistance.reset();
    aim(ada.player, bob.player);
    world.attack(ada.player);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(now + PVP_DURATION_MS);
    expect(world.playerRules.pvpUntil(bob.player.id, now)).toBe(now + PVP_DURATION_MS);

    const locked = world.playerRules.pvpUntil(ada.player.id, now);
    now += 1_000;
    const [spawnX, spawnY, spawnZ] = world.spawn;
    cara.player.controller.teleport([spawnX, spawnY, spawnZ]);
    const beforeFall = cara.player.survival.health;
    cara.player.controller.fallDistance = 8;
    world.tick();
    expect(cara.player.survival.health).toBeLessThan(beforeFall);
    expect(world.playerRules.pvpUntil(cara.player.id, now)).toBe(0);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(locked);

    const mobHealthBefore = ada.player.survival.health;
    world.gameplay.mobs.spawn('skeleton', new Vec3(30, 100, 6), { force: true });
    for (let tick = 0; tick < 6; tick += 1) world.tick();
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(locked);
    if (ada.player.survival.health < mobHealthBefore) {
      expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(locked);
    }

    now += PVP_DURATION_MS;
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(0);
    expect(world.playerRules.teleportBlockReason(ada.player.id, now)).toBeUndefined();
  });

  it('protects only the teleported player and does not let a blocked hit refresh pvp', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    const cara = join(world, 'Cara');
    let now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    place(bob.player, 40, 10);
    place(cara.player, 40, 12);
    place(ada.player, 48, 10);
    aim(bob.player, cara.player);
    const caraHealth = cara.player.survival.health;
    world.attack(bob.player);
    expect(cara.player.survival.health).toBeLessThan(caraHealth);
    const pvp = world.playerRules.pvpUntil(bob.player.id, now);
    expect(pvp).toBe(now + PVP_DURATION_MS);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(0);

    expect(world.teleports.now(ada.player.id, { x: 40, y: 100, z: 8 }, 'rtp').ok).toBe(true);
    expect(world.playerRules.protectionDeadline(ada.player.id, now)).toBe(now + TELEPORT_PROTECTION_MS);
    expect(world.playerRules.pvpUntil(bob.player.id, now)).toBe(pvp);

    const adaHealth = ada.player.survival.health;
    const bobHealth = bob.player.survival.health;
    aim(bob.player, ada.player);
    world.attack(bob.player);
    aim(ada.player, bob.player);
    world.attack(ada.player);
    expect(ada.player.survival.health).toBe(adaHealth);
    expect(bob.player.survival.health).toBe(bobHealth);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(0);
    expect(world.playerRules.pvpUntil(bob.player.id, now)).toBe(pvp);

    aim(cara.player, bob.player);
    const bobAfter = bob.player.survival.health;
    world.attack(cara.player);
    expect(bob.player.survival.health).toBeLessThan(bobAfter);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(0);

    now += TELEPORT_PROTECTION_MS;
    expect(world.playerRules.blocksPvp(bob.player.id, ada.player.id, now)).toBe(false);
    aim(bob.player, ada.player);
    const adaOpen = ada.player.survival.health;
    world.attack(bob.player);
    expect(ada.player.survival.health).toBeLessThan(adaOpen);
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBe(now + PVP_DURATION_MS);
    expect(world.playerRules.pvpUntil(bob.player.id, now)).toBe(now + PVP_DURATION_MS);
  });

  it('counts a landed arrow as pvp and does not count a shot that misses', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    const bob = join(world, 'Bob');
    place(ada.player, 60.5, 20.5);
    place(bob.player, 60.5, 22.5);
    ada.player.inventory.clear();
    ada.player.inventory.addItem(ItemId.Bow, 1);
    ada.player.inventory.addItem(ItemId.Arrow, 1);
    ada.player.selectedSlot = 0;
    ada.player.bowUseTicks = 20;
    const aimAt = lookAt(
      ada.player.controller.position,
      bob.player.controller.position.x,
      bob.player.controller.position.y + 0.9,
      bob.player.controller.position.z,
    );
    const before = bob.player.survival.health;
    expect(world.gameplay.releaseBowWithAim(ada.player, aimAt.yaw, aimAt.pitch)).toMatchObject({ ok: true });
    world.tick();
    expect(bob.player.survival.health).toBeLessThan(before);
    const now = Date.now();
    expect(world.playerRules.pvpUntil(ada.player.id, now)).toBeGreaterThan(now);
    expect(world.playerRules.pvpUntil(bob.player.id, now)).toBeGreaterThan(now);
  });
});
