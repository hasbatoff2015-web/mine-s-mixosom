import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink } from '../../server/WorldInstance';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-spawnpet-'));
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
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
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

describe('/spawnpet operator command', { timeout: 30_000 }, () => {
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
    const joined = world.join({ sink, name: 'Owner' });
    if ('error' in joined) throw new Error('join failed');
    joined.player.controller.yaw = 0;
    for (let dx = -6; dx <= 6; dx += 1) {
      for (let dz = -6; dz <= 6; dz += 1) {
        world.world.setBlock(20 + dx, 79, 20 + dz, BlockId.Stone);
        for (let height = 0; height <= 4; height += 1) world.world.setBlock(20 + dx, 80 + height, 20 + dz, BlockId.Air);
      }
    }
    joined.player.controller.teleport([20.5, 80, 20.5]);
    return { world, player: joined.player, sink };
  }

  it('rejects a player without a donate rank', async () => {
    const { world, player, sink } = await boot();
    sink.payloads.length = 0;
    world.handleChat(player, '/spawnpet bee');
    world.handleChat(player, '/petspawn creeper');
    const lines = resultLines(sink);
    expect(lines.some((line) => line.includes('Для призыва пчёлки нужна привилегия BOSS.'))).toBe(true);
    expect(lines.some((line) => line.includes('Для призыва мини-крипера нужна привилегия TITAN.'))).toBe(true);
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee' || mob.kind === 'pet_creeper')).toHaveLength(0);
    expect(player.cosmeticPet).toBeNull();
  });

  it('rejects wolf, cat, and console use without creating an animal', async () => {
    const { world, player, sink } = await boot();
    world.permissions.op(player.name);
    world.permissions.op(player.id);
    sink.payloads.length = 0;
    world.handleChat(player, '/spawnpet wolf');
    world.handleChat(player, '/spawnpet cat');
    expect(resultLines(sink).some((line) => line.includes('Usage: /spawnpet <bee|creeper|off>'))).toBe(true);
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'wolf' || mob.kind === 'cat')).toHaveLength(0);
    const consoleResult = world.dispatchConsole('spawnpet bee');
    expect(consoleResult.ok).toBe(false);
    expect(consoleResult.lines.some((line) => line.toLowerCase().includes('player'))).toBe(true);
    expect(world.gameplay.mobs.entities).toHaveLength(0);
  });

  it('follows BOSS, TITAN, and OP and removes the pet when the rank ends', async () => {
    const { world, player, sink } = await boot();
    const say = (text: string) => {
      sink.payloads.length = 0;
      world.handleChat(player, text);
      return resultLines(sink);
    };
    const cosmetic = () => world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee' || mob.kind === 'pet_creeper');

    for (const rank of ['vip', 'premium'] as const) {
      expect(world.donation.grant(player.id, rank).ok).toBe(true);
      expect(say('/spawnpet bee').some((line) => line.includes('BOSS'))).toBe(true);
      expect(say('/spawnpet creeper').some((line) => line.includes('TITAN'))).toBe(true);
      expect(cosmetic()).toHaveLength(0);
      expect(say('/give dirt 1').some((line) => line.includes('Недостаточно прав'))).toBe(true);
    }

    expect(world.donation.grant(player.id, 'boss').ok).toBe(true);
    expect(say('/spawnpet bee').some((line) => line.includes('Рядом появилась пчела.'))).toBe(true);
    expect(cosmetic().map((mob) => mob.kind)).toEqual(['pet_bee']);
    expect(say('/spawnpet creeper').some((line) => line.includes('TITAN'))).toBe(true);
    expect(cosmetic().some((mob) => mob.kind === 'pet_creeper')).toBe(false);
    expect(player.cosmeticPet).toBe('bee');

    expect(world.donation.revoke(player.id).ok).toBe(true);
    world.tick();
    expect(cosmetic()).toHaveLength(0);
    expect(player.cosmeticPet).toBe('bee');
    expect(say('/spawnpet bee').some((line) => line.includes('BOSS'))).toBe(true);
    expect(cosmetic()).toHaveLength(0);

    expect(world.donation.grant(player.id, 'titan').ok).toBe(true);
    expect(say('/spawnpet bee').some((line) => line.includes('пчела'))).toBe(true);
    expect(say('/petspawn creeper').some((line) => line.includes('мини-крипер'))).toBe(true);
    expect(cosmetic().map((mob) => mob.kind)).toEqual(['pet_creeper']);

    expect(world.donation.revoke(player.id).ok).toBe(true);
    world.permissions.op(player.name);
    expect(world.donation.effectiveRank(player.id)).toBe('default');
    expect(say('/spawnpet bee').some((line) => line.includes('пчела'))).toBe(true);
    expect(say('/spawnpet creeper').some((line) => line.includes('мини-крипер'))).toBe(true);
    expect(world.donation.grant(player.id, 'vip').ok).toBe(true);
    expect(say('/spawnpet creeper').some((line) => line.includes('мини-крипер'))).toBe(true);
    expect(world.permissions.deop(player.name).ok).toBe(true);
    world.tick();
    expect(cosmetic()).toHaveLength(0);
    expect(say('/spawnpet creeper').some((line) => line.includes('TITAN'))).toBe(true);
    expect(say('/spawnpet off').some((line) => line.includes('отключён'))).toBe(true);
    expect(player.cosmeticPet).toBeNull();
  });

  it('keeps the donate pets screen on the same server check', async () => {
    const { world, player, sink } = await boot();
    const menu = () => sink.payloads.filter((payload) => (payload as { type?: string }).type === 'menu').at(-1) as {
      screen?: string;
      message?: string;
      donate?: {
        actions?: { id: string; label: string; screen?: string }[];
        pets?: { id: string; available: boolean; detail: string; label: string }[];
      };
    };
    world.handleMenuAction(player, { type: 'menu_action', action: 'open', screen: 'donate' });
    expect(menu().donate?.actions?.find((action) => action.id === 'pets')).toMatchObject({
      label: 'Питомцы',
      screen: 'donate-pets',
    });
    expect(menu().donate?.pets?.find((pet) => pet.id === 'bee')?.available).toBe(false);
    expect(menu().donate?.pets?.find((pet) => pet.id === 'creeper')?.detail).toContain('TITAN');
    world.handleMenuAction(player, { type: 'menu_action', action: 'open', screen: 'donate-pets' });
    expect(menu().screen).toBe('donate-pets');
    world.handleMenuAction(player, { type: 'menu_action', action: 'donate_pet', name: 'bee' });
    expect(menu().screen).toBe('donate-pets');
    expect(menu().message).toContain('BOSS');
    world.handleMenuAction(player, { type: 'menu_action', action: 'donate_pet', name: 'creeper' });
    expect(menu().message).toContain('TITAN');
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_bee' || mob.kind === 'pet_creeper')).toHaveLength(0);
    world.handleMenuAction(player, { type: 'menu_action', action: 'back' });
    expect(menu().screen).toBe('donate');
    world.handleMenuAction(player, { type: 'menu_action', action: 'open', screen: 'donate-pets' });
    expect(menu().screen).toBe('donate-pets');

    expect(world.donation.grant(player.id, 'boss').ok).toBe(true);
    world.handleMenuAction(player, { type: 'menu_action', action: 'open', screen: 'donate-pets' });
    expect(menu().donate?.pets?.find((pet) => pet.id === 'bee')?.available).toBe(true);
    expect(menu().donate?.pets?.find((pet) => pet.id === 'creeper')?.available).toBe(false);
    world.handleMenuAction(player, { type: 'menu_action', action: 'donate_pet', name: 'bee' });
    expect(menu().screen).toBe('donate-pets');
    expect(menu().message).toContain('Рядом появилась пчела.');
    expect(world.gameplay.mobs.entities.some((mob) => mob.kind === 'pet_bee')).toBe(true);
    world.handleMenuAction(player, { type: 'menu_action', action: 'donate_pet', name: 'creeper' });
    expect(menu().screen).toBe('donate-pets');
    expect(menu().message).toContain('TITAN');
    expect(world.gameplay.mobs.entities.some((mob) => mob.kind === 'pet_creeper')).toBe(false);

    expect(world.donation.grant(player.id, 'titan').ok).toBe(true);
    world.handleMenuAction(player, { type: 'menu_action', action: 'donate_pet', name: 'creeper' });
    expect(menu().message).toContain('мини-крипер');
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_creeper')).toHaveLength(1);
    world.handleMenuAction(player, { type: 'menu_action', action: 'donate_pet', name: 'dragon' });
    expect(menu().screen).toBe('donate-pets');
    expect(menu().message).toContain('bee|creeper|off');
    expect(world.gameplay.mobs.entities.filter((mob) => mob.kind === 'pet_creeper')).toHaveLength(1);
  });
});
