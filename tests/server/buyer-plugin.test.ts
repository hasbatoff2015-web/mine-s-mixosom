import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';
import type { ServerBuyerMessage } from '../../shared/protocol';
import { BUYER_EXAMPLE_PUMPKIN_PRICE, buyerHologramName } from '../../shared/buyers';
import { ECONOMY_INITIAL_BALANCE } from '../../server/services/economy';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-buyer-plugin-'));
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

function resultLines(sink: MemorySink): string[] {
  const lines: string[] = [];
  for (const payload of sink.payloads) {
    const record = payload as { type?: string; lines?: string[]; text?: string };
    if (record.type === 'command_result' && record.lines) lines.push(...record.lines);
    if (record.type === 'chat' && record.text) lines.push(record.text);
  }
  return lines;
}

function lastBuyer(sink: MemorySink): ServerBuyerMessage | undefined {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const payload = sink.payloads[index] as { type?: string };
    if (payload.type === 'buyer') return payload as ServerBuyerMessage;
  }
  return undefined;
}

describe('Buyer plugin', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(dataDir?: string): Promise<WorldInstance> {
    const dir = dataDir ?? await tempDir();
    if (!dataDir) dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    await world.loadPlugins();
    await world.plugins.enableAll();
    return world;
  }

  function join(world: WorldInstance, name: string, sessionToken?: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name, sessionToken });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  function chat(world: WorldInstance, player: ReturnType<typeof join>, text: string): string[] {
    player.sink.payloads.length = 0;
    world.handleChat(player.player, text);
    return resultLines(player.sink);
  }

  it('lets OP create, list, move and delete a buyer NPC', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    expect(chat(world, op, '/buyer create Farmer').some((line) => line.includes('Farmer'))).toBe(true);
    expect(lastBuyer(op.sink)?.screen).toBe('admin');
    const npc = world.buyer.findByName('Farmer');
    expect(npc?.yaw).toBe(op.player.controller.yaw);
    expect(npc?.pitch).toBe(op.player.controller.pitch);
    expect(world.holograms.get(npc!.hologramName)?.lines[0]).toBe('Farmer');
    expect(chat(world, op, '/buyer list').some((line) => line.includes('Farmer'))).toBe(true);
    op.player.controller.teleport([12, 70, -4]);
    op.player.controller.yaw = 1.5;
    expect(chat(world, op, '/buyer move Farmer').some((line) => line.includes('перемещён'))).toBe(true);
    expect(world.buyer.findByName('Farmer')?.x).toBeCloseTo(12);
    expect(world.holograms.get(npc!.hologramName)?.x).toBeCloseTo(12);
    expect(chat(world, op, '/buyer delete Farmer').some((line) => line.includes('удалён'))).toBe(true);
    expect(chat(world, op, '/buyer list').some((line) => line.includes('нет'))).toBe(true);
    expect(world.holograms.get(buyerHologramName(npc!.id))).toBeUndefined();
  });

  it('opens admin GUI for OP and trade GUI for a normal player', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    chat(world, op, '/buyer create Farmer');
    const id = world.buyer.findByName('Farmer')!.id;
    world.buyer.configure(id, { itemId: 'pumpkin', pricePerItem: BUYER_EXAMPLE_PUMPKIN_PRICE });
    op.sink.payloads.length = 0;
    world.interactBuyer(op.player, id);
    expect(lastBuyer(op.sink)?.screen).toBe('admin');
    ada.sink.payloads.length = 0;
    world.interactBuyer(ada.player, id);
    expect(lastBuyer(ada.sink)?.screen).toBe('trade');
    expect(lastBuyer(ada.sink)?.configured).toBe(true);
  });

  it('sells through the live world, restores on close, and survives restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const world = await boot(dir);
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    chat(world, op, '/buyer create Farmer');
    const id = world.buyer.findByName('Farmer')!.id;
    world.buyer.configure(id, { itemId: 'pumpkin', pricePerItem: 50 });
    ada.player.inventory.setSlot(0, createItemStack('pumpkin', 32));
    world.interactBuyer(ada.player, id);
    world.handleBuyerAction(ada.player, { type: 'buyer_action', action: 'select_slot', slot: 0 });
    expect(ada.player.inventory.getSlot(0)).toBeNull();
    world.handleBuyerAction(ada.player, { type: 'buyer_action', action: 'close' });
    expect(ada.player.inventory.count('pumpkin')).toBe(32);
    world.interactBuyer(ada.player, id);
    world.handleBuyerAction(ada.player, { type: 'buyer_action', action: 'select_slot', slot: 0 });
    world.handleBuyerAction(ada.player, { type: 'buyer_action', action: 'sell' });
    expect(ada.player.inventory.count('pumpkin')).toBe(0);
    expect(world.economy.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 1600);
    const hologramName = world.buyer.findByName('Farmer')!.hologramName;
    await world.stop();
    worlds.pop();
    const again = await boot(dir);
    const restored = again.buyer.findByName('Farmer');
    expect(restored?.itemId).toBe('pumpkin');
    expect(restored?.pricePerItem).toBe(50);
    expect(again.holograms.get(hologramName)?.lines[0]).toBe('Farmer');
    expect(again.economy.getBalance(ada.player.id)).toBe(ECONOMY_INITIAL_BALANCE + 1600);
  });

  it('denies create for a default player and ignores spoofed admin save', async () => {
    const world = await boot();
    const ada = join(world, 'Ada');
    expect(chat(world, ada, '/buyer create Farmer').some((line) => /permission/i.test(line))).toBe(true);
    expect(world.buyer.list()).toHaveLength(0);
    const op = join(world, 'Op');
    chat(world, op, '/buyer create Farmer');
    const id = world.buyer.findByName('Farmer')!.id;
    ada.sink.payloads.length = 0;
    world.handleBuyerAction(ada.player, {
      type: 'buyer_action',
      action: 'save',
      buyerId: id,
      price: 1,
      name: 'Hacked',
    });
    expect(world.buyer.findByName('Farmer')?.pricePerItem).toBeUndefined();
    expect(world.buyer.findByName('Hacked')).toBeUndefined();
  });

  it('blocks hologram commands on buyer-owned names and restores items on delete', async () => {
    const world = await boot();
    const op = join(world, 'Op');
    const ada = join(world, 'Ada');
    chat(world, op, '/buyer create Farmer');
    const npc = world.buyer.findByName('Farmer')!;
    world.buyer.configure(npc.id, { itemId: 'pumpkin', pricePerItem: 50 });
    expect(chat(world, op, `/holograms delete ${npc.hologramName}`).some((line) => /скупщик/i.test(line))).toBe(true);
    expect(world.holograms.get(npc.hologramName)).toBeDefined();
    ada.player.inventory.setSlot(0, createItemStack('pumpkin', 8));
    world.interactBuyer(ada.player, npc.id);
    world.handleBuyerAction(ada.player, { type: 'buyer_action', action: 'select_slot', slot: 0 });
    expect(ada.player.inventory.getSlot(0)).toBeNull();
    expect(chat(world, op, '/buyer delete Farmer').some((line) => line.includes('удалён'))).toBe(true);
    expect(ada.player.inventory.count('pumpkin')).toBe(8);
    expect(lastBuyer(ada.sink)?.screen).toBe('closed');
  });
});

