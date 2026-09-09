import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import type { ClientInputMessage, WorldSoundEvent } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-world-sound-'));
}

function testConfig(dataDir: string) {
  return {
    ...loadServerConfig({
      HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
      MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
    }, process.cwd()),
    dataDir,
    port: 0,
    chunkViewRadius: 1,
    persistIntervalMs: 60_000,
    pluginDir: join(dataDir, 'no-plugins'),
    loadExamplePlugin: false,
    loadBuiltinPlugins: false,
    operators: [] as string[],
  };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function idleInput(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
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

function worldSounds(sink: MemorySink): WorldSoundEvent[] {
  return sink.payloads.flatMap((payload) => {
    if (!payload || typeof payload !== 'object') return [];
    const message = payload as { type?: string; sounds?: WorldSoundEvent[] };
    if (message.type !== 'world_sound' || !Array.isArray(message.sounds)) return [];
    return message.sounds;
  });
}

function eventsNamed(sink: MemorySink, event: string): WorldSoundEvent[] {
  return worldSounds(sink).filter((sound) => sound.event === event);
}

describe('online bow.shoot and item.pickup are authoritative world events', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<{
    world: WorldInstance;
    player: ServerPlayer;
    sink: MemorySink;
  }> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ name: 'SoundA', sink });
    if ('error' in joined) throw new Error(joined.error);
    return { world, player: joined.player, sink };
  }

  it('movement, jump, fall, snapshots, charge, and cancel do not play bow.shoot', async () => {
    const { world, player, sink } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    player.inventory.addItem(ItemId.Bow, 1);
    player.inventory.addItem(ItemId.Arrow, 8);
    player.selectedSlot = 0;
    sink.payloads.length = 0;

    world.applyInput(player, idleInput(1, { forward: 1 }));
    world.tick();
    world.applyInput(player, idleInput(2, { jump: true }));
    world.tick();
    player.controller.velocity.set(0, -12, 0);
    world.applyInput(player, idleInput(3));
    world.tick();

    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(0);

    world.applyInput(player, idleInput(4, { use: true }));
    world.interact(player, undefined, 1, 4, 0);
    world.tick();
    expect(player.bowUseTicks).toBeGreaterThan(0);
    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(0);

    world.applyInput(player, idleInput(5, { selectedSlot: 1 }));
    world.tick();
    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(0);
  });

  it('a real bow release emits bow.shoot once and a duplicate release does not', async () => {
    const { world, player, sink } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    player.inventory.addItem(ItemId.Bow, 1);
    player.inventory.addItem(ItemId.Arrow, 8);
    player.selectedSlot = 0;
    player.bowUseTicks = 20;
    sink.payloads.length = 0;

    expect(world.releaseBow(player, { actionSeq: 1, commandSeq: 1, yaw: 0.2, pitch: -0.1 }).ok).toBe(true);
    world.tick();
    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(1);

    expect(world.releaseBow(player, { actionSeq: 1, commandSeq: 1, yaw: 0.2, pitch: -0.1 }).ok).toBe(false);
    world.tick();
    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(1);

    expect(world.releaseBow(player, { actionSeq: 2, commandSeq: 2, yaw: 0.2, pitch: -0.1 }).ok).toBe(false);
    world.tick();
    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(1);
  });

  it('a far player does not receive another player bow.shoot', async () => {
    const { world, player, sink } = await boot();
    const farSink = new MemorySink();
    const far = world.join({ name: 'SoundB', sink: farSink });
    if ('error' in far) throw new Error(far.error);
    far.player.controller.teleport([player.controller.position.x + 80, player.controller.position.y, player.controller.position.z]);
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    player.inventory.addItem(ItemId.Bow, 1);
    player.inventory.addItem(ItemId.Arrow, 1);
    player.selectedSlot = 0;
    player.bowUseTicks = 20;
    sink.payloads.length = 0;
    farSink.payloads.length = 0;

    expect(world.releaseBow(player, { actionSeq: 1, commandSeq: 1, yaw: 0, pitch: 0 }).ok).toBe(true);
    world.tick();
    expect(eventsNamed(sink, 'bow.shoot')).toHaveLength(1);
    expect(eventsNamed(farSink, 'bow.shoot')).toHaveLength(0);
  });

  it('item spawn, snapshot, teleport, despawn, and reappear do not play item.pickup', async () => {
    const { world, player, sink } = await boot();
    world.setGameMode(player, 'survival');
    const origin = player.controller.position.clone();
    world.gameplay.drops.spawn(createItemStack('dirt', 1), new Vec3(origin.x + 2, origin.y, origin.z + 2), {
      pickupDelaySeconds: 999,
      merge: false,
    });
    sink.payloads.length = 0;
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(0);

    player.controller.teleport([origin.x + 2, origin.y, origin.z + 2]);
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(0);

    const id = [...world.gameplay.drops.entities][0]!.id;
    world.gameplay.drops.remove(id);
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(0);

    world.gameplay.drops.spawn(createItemStack('dirt', 1), new Vec3(origin.x + 2, origin.y, origin.z + 2), {
      id,
      pickupDelaySeconds: 999,
      merge: false,
    });
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(0);
  });

  it('server-confirmed pickup plays item.pickup once and teleport after that does not repeat it', async () => {
    const { world, player, sink } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    const origin = player.controller.position.clone();
    world.gameplay.drops.spawn(createItemStack('dirt', 1), new Vec3(origin.x, origin.y + 0.2, origin.z), {
      pickupDelaySeconds: 0,
      merge: false,
    });
    sink.payloads.length = 0;
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(1);
    expect(player.inventory.has('dirt', 1)).toBe(true);

    player.controller.teleport([origin.x + 40, origin.y, origin.z]);
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(1);
  });

  it('a far player does not hear another player item.pickup', async () => {
    const { world, player, sink } = await boot();
    const farSink = new MemorySink();
    const far = world.join({ name: 'SoundC', sink: farSink });
    if ('error' in far) throw new Error(far.error);
    far.player.controller.teleport([player.controller.position.x + 80, player.controller.position.y, player.controller.position.z]);
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    const origin = player.controller.position.clone();
    world.gameplay.drops.spawn(createItemStack('cobblestone', 1), new Vec3(origin.x, origin.y + 0.2, origin.z), {
      pickupDelaySeconds: 0,
      merge: false,
    });
    sink.payloads.length = 0;
    farSink.payloads.length = 0;
    world.tick();
    expect(eventsNamed(sink, 'item.pickup')).toHaveLength(1);
    expect(eventsNamed(farSink, 'item.pickup')).toHaveLength(0);
  });
});
