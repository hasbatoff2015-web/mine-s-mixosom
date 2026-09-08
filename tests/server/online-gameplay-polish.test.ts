import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import type { ClientInputMessage, WorldSoundEvent } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-online-polish-'));
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

function idleInput(seq: number): ClientInputMessage {
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
  };
}

describe('online gameplay polish — death scatter, respawn, craft, sounds', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<{ world: WorldInstance; player: ServerPlayer; sink: MemorySink }> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ name: 'Polish', sink });
    if ('error' in joined) throw new Error(joined.error);
    return { world, player: joined.player, sink };
  }

  it('scatters death drops around the player instead of stacking on the look vector', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    player.inventory.addItem('dirt', 64);
    player.inventory.addItem('cobblestone', 64);
    player.inventory.addItem('oak_planks', 32);
    player.controller.teleport([40.5, 80, 40.5]);
    player.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
    world.gameplay.respawnIfDead(player);
    expect(player.survival.dead).toBe(true);
    expect(player.inventory.has('dirt', 1)).toBe(false);
    const drops = [...world.gameplay.drops.entities];
    expect(drops.length).toBeGreaterThanOrEqual(3);
    const xs = new Set(drops.map((drop) => drop.position.x.toFixed(3)));
    const zs = new Set(drops.map((drop) => drop.position.z.toFixed(3)));
    expect(xs.size + zs.size).toBeGreaterThan(2);
    for (const drop of drops) {
      expect(Math.hypot(drop.position.x - 40.5, drop.position.z - 40.5)).toBeLessThan(1.2);
      expect(Math.hypot(drop.velocity.x, drop.velocity.z)).toBeGreaterThan(0);
    }
    world.gameplay.respawnIfDead(player);
    expect(world.gameplay.drops.count).toBe(drops.length);
    expect(world.respawn(player)).toBe(true);
    expect(player.survival.dead).toBe(false);
    expect(world.respawn(player)).toBe(false);
  });

  it('keeps the player dead until an explicit respawn and ignores a second request', async () => {
    const { world, player, sink } = await boot();
    world.setGameMode(player, 'survival');
    player.survival.damage(1000, 'generic', { ignoreInvulnerability: true, bypassArmor: true });
    world.gameplay.respawnIfDead(player);
    expect(player.survival.dead).toBe(true);
    expect(player.snapshot().dead).toBe(true);
    world.applyInput(player, { ...idleInput(1), forward: 1, jump: true });
    world.tick();
    expect(player.survival.dead).toBe(true);
    expect(player.controller.velocity.x).toBe(0);
    expect(world.respawn(player)).toBe(true);
    const health = sink.payloads.filter((payload): payload is { type: 'health'; dead: boolean; fire: boolean } => (
      Boolean(payload) && typeof payload === 'object' && (payload as { type?: string }).type === 'health'
    ));
    expect(health.some((entry) => entry.dead === true)).toBe(true);
    expect(health.at(-1)?.dead).toBe(false);
    expect(health.at(-1)?.fire).toBe(false);
  });

  it('lets recipe selection ghost missing ingredients while craft still rejects empties', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'recipe',
      recipeId: 'sticks',
    });
    expect(player.craftSlots.every((slot) => slot === null)).toBe(true);
    expect(player.inventory.has('oak_planks', 1)).toBe(false);
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'click',
      key: 'result',
      button: 'left',
    });
    expect(player.cursor).toBeNull();
    player.inventory.setSlot(0, createItemStack('oak_planks', 2));
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'recipe',
      recipeId: 'sticks',
    });
    expect(player.craftSlots.some((slot) => slot?.itemId === 'oak_planks')).toBe(true);
    world.applyInventoryAction(player, {
      type: 'inventory_action',
      action: 'click',
      key: 'result',
      button: 'left',
    });
    expect(player.cursor?.itemId).toBe(ItemId.Stick);
  });

  it('emits explosion world_sound without texture bytes', async () => {
    const { world, player, sink } = await boot();
    const pos = player.controller.position;
    world.gameplay.explosions.enqueue({
      x: pos.x, y: pos.y + 0.5, z: pos.z, radius: 2, power: 3,
    });
    world.tick();
    const sounds = sink.payloads.filter((payload): payload is { type: 'world_sound'; sounds: WorldSoundEvent[] } => (
      Boolean(payload) && typeof payload === 'object' && (payload as { type?: string }).type === 'world_sound'
    ));
    expect(sounds.some((message) => message.sounds.some((sound) => sound.event === 'explosion'))).toBe(true);
    expect(JSON.stringify(sounds)).not.toMatch(/base64|data:image|texturePath/i);
  });
});
