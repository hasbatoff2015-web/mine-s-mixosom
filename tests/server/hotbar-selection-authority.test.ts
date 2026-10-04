import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { Vec3 } from '../../src/math/vec3';
import type { AttackAction } from '../../shared/playerActions';
import type { ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import type { ClientInputMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-hotbar-'));
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
  };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input', seq, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
    descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0, ...extra,
  };
}

function lastInventory(sink: MemorySink): { selectedSlot?: number } | undefined {
  for (let i = sink.payloads.length - 1; i >= 0; i -= 1) {
    const payload = sink.payloads[i] as { type?: string; selectedSlot?: number };
    if (payload?.type === 'inventory') return payload;
  }
  return undefined;
}

describe('authoritative hotbar select then instant use', { timeout: 20_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot() {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Hotbar' });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, 'survival');
    joined.player.survival.restore({ hunger: 10, dead: false });
    return { world, player: joined.player, sink };
  }

  it('select slot 1 then immediately use that slot, not the previous one', async () => {
    const { world, player, sink } = await boot();
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack('stone', 1));
    player.inventory.setSlot(1, createItemStack(ItemId.Apple, 1));
    world.applyInput(player, input(10, { selectedSlot: 0 }));
    world.tick();
    expect(player.selectedSlot).toBe(0);
    expect(world.interact(player, undefined, 1, 10, 1)).toEqual({ ok: true });
    expect(player.selectedSlot).toBe(1);
    expect(player.foodUseTicks).toBe(1);
    expect(lastInventory(sink)?.selectedSlot).toBe(1);
    world.tick();
    expect(player.selectedSlot).toBe(1);
  });

  it('select then left-click / right-click / place keep the new slot after a queued old command applies', async () => {
    const { world, player } = await boot();
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack('stone', 8));
    player.inventory.setSlot(8, createItemStack('dirt', 8));
    player.inventory.setSlot(3, createItemStack(ItemId.Apple, 1));
    player.inventory.setSlot(5, createItemStack('oak_planks', 8));
    world.applyInput(player, input(1, { selectedSlot: 0 }));
    world.applyInput(player, input(2, { selectedSlot: 0 }));
    expect(world.interact(player, undefined, 1, 2, 8)).toEqual({ ok: true });
    expect(player.selectedSlot).toBe(8);
    world.tick();
    expect(player.selectedSlot).toBe(8);

    world.applyInput(player, input(3, { selectedSlot: 8 }));
    expect(world.interact(player, undefined, 2, 3, 3)).toEqual({ ok: true });
    expect(player.selectedSlot).toBe(3);
    expect(player.foodUseTicks).toBeGreaterThan(0);
    world.tick();
    expect(player.selectedSlot).toBe(3);

    world.applyInput(player, input(4, { selectedSlot: 3 }));
    expect(world.interact(player, undefined, 3, 4, 5)).toEqual({ ok: true });
    expect(player.selectedSlot).toBe(5);
  });

  it('rapid 1→2→3 then use operates on slot 3 and does not roll back', async () => {
    const { world, player, sink } = await boot();
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack('stone', 1));
    player.inventory.setSlot(1, createItemStack('dirt', 1));
    player.inventory.setSlot(2, createItemStack('oak_planks', 1));
    player.inventory.setSlot(3, createItemStack(ItemId.Apple, 2));
    world.applyInput(player, input(1, { selectedSlot: 0 }));
    world.tick();
    expect(world.interact(player, undefined, 1, 1, 1)).toEqual({ ok: true });
    expect(world.interact(player, undefined, 2, 1, 2)).toEqual({ ok: true });
    expect(world.interact(player, undefined, 3, 1, 3)).toEqual({ ok: true });
    expect(player.selectedSlot).toBe(3);
    expect(lastInventory(sink)?.selectedSlot).toBe(3);
    world.applyInput(player, input(2, { selectedSlot: 3 }));
    world.tick();
    expect(player.selectedSlot).toBe(3);
  });

  function lookAt(attacker: ServerPlayer, target: ServerPlayer) {
    const origin = attacker.controller.eyePosition();
    const point = new Vec3(target.controller.position.x, target.controller.position.y + 0.9, target.controller.position.z);
    const direction = point.sub(origin).normalize();
    return {
      yaw: Math.atan2(-direction.x, -direction.z),
      pitch: Math.asin(direction.y),
    };
  }

  async function bootDuel() {
    const duel = await boot();
    const victimSink = new MemorySink();
    const joined = duel.world.join({ sink: victimSink, name: 'Victim' });
    if ('error' in joined) throw new Error(joined.error);
    duel.world.setGameMode(joined.player, 'survival');
    duel.player.controller.teleport([20.5, 100, 20.5]);
    joined.player.controller.teleport([20.5, 100, 22.5]);
    duel.world.world.setBlock(20, 99, 20, BlockId.Stone);
    duel.world.world.setBlock(20, 99, 22, BlockId.Stone);
    return { ...duel, victim: joined.player };
  }

  function swordWasUsed(player: ServerPlayer, slot: number): boolean {
    return typeof player.inventory.getSlot(slot)?.durability === 'number';
  }

  it('same-frame slot 5 attack uses the authoritative sword in that slot', async () => {
    const { world, player, victim } = await bootDuel();
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack('stone', 1));
    player.inventory.setSlot(5, createItemStack(ItemId.DiamondSword));
    const look = lookAt(player, victim);
    world.applyInput(player, input(1, { selectedSlot: 0, yaw: look.yaw, pitch: look.pitch }));
    world.applyInput(victim, input(1));
    world.tick();
    const before = victim.survival.health;
    const attack: AttackAction = {
      kind: 'attack', actionSeq: 1, commandSeq: 1, selectedSlot: 5,
      yaw: look.yaw, pitch: look.pitch, targetId: victim.id, targetRenderTick: world.tickNumber,
    };
    world.handleSequencedAttack(player, attack);
    expect(victim.survival.health).toBeLessThan(before);
    expect(player.selectedSlot).toBe(5);
    expect(player.inventory.getSlot(5)?.itemId).toBe(ItemId.DiamondSword);
    expect(swordWasUsed(player, 5)).toBe(true);
    expect(player.inventory.getSlot(0)?.itemId).toBe('stone');
  });

  it('rapid 1→2→3 then attack uses slot 3', async () => {
    const { world, player, victim } = await bootDuel();
    player.inventory.clear();
    player.inventory.setSlot(1, createItemStack('dirt', 1));
    player.inventory.setSlot(2, createItemStack('oak_planks', 1));
    player.inventory.setSlot(3, createItemStack(ItemId.DiamondSword));
    const look = lookAt(player, victim);
    world.applyInput(player, input(1, { selectedSlot: 0, yaw: look.yaw, pitch: look.pitch }));
    world.applyInput(victim, input(1));
    world.tick();
    const before = victim.survival.health;
    world.handleSequencedAttack(player, {
      kind: 'attack', actionSeq: 1, commandSeq: 1, selectedSlot: 3,
      yaw: look.yaw, pitch: look.pitch, targetId: victim.id, targetRenderTick: world.tickNumber,
    });
    expect(victim.survival.health).toBeLessThan(before);
    expect(player.selectedSlot).toBe(3);
    expect(player.inventory.getSlot(3)?.itemId).toBe(ItemId.DiamondSword);
    expect(swordWasUsed(player, 3)).toBe(true);
    expect(player.inventory.getSlot(1)?.itemId).toBe('dirt');
    expect(player.inventory.getSlot(2)?.itemId).toBe('oak_planks');
  });
});
