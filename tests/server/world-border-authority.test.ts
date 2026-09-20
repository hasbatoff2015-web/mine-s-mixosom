import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';

class MemorySink {
  readonly payloads: Array<{ type?: string; code?: string; [key: string]: unknown }> = [];
  send(payload: unknown): void {
    this.payloads.push(payload as (typeof this.payloads)[number]);
  }
  last(type: string) {
    return [...this.payloads].reverse().find((message) => message.type === type);
  }
}

describe('world-border server authority holes', { timeout: 30_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-border-auth-'));
    dirs.push(dir);
    const world = new WorldInstance({
      ...loadServerConfig({
        HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000',
      }, process.cwd()),
      dataDir: dir, port: 0, chunkViewRadius: 1, persistIntervalMs: 60_000,
      pluginDir: join(dir, 'no-plugins'), loadExamplePlugin: false, loadBuiltinPlugins: true,
    });
    worlds.push(world);
    await world.initialize();
    function add(name: string) {
      const sink = new MemorySink();
      const result = world.join({ sink, name });
      if ('error' in result) throw new Error(result.error);
      return { player: result.player, sink };
    }
    return { world, add };
  }

  it('rejects beginMining on scenery outside the playable border', async () => {
    const { world, add } = await boot();
    const { player } = add('Miner');
    player.controller.teleport([9_996.5, 70, 0.5]);
    for (let x = 9_996; x <= 10_000; x += 1) {
      world.world.setBlock(x, 70, 0, BlockId.Air);
      world.world.setBlock(x, 71, 0, BlockId.Air);
    }
    world.world.setBlock(10_000, 70, 0, BlockId.Stone);
    world.applyInput(player, {
      type: 'input', seq: 1, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
      descend: false, flySprint: false, yaw: -Math.PI / 2, pitch: 0, selectedSlot: 0, mining: true,
    });
    world.tick();
    const intent = {
      targetX: 10_000,
      targetY: 70,
      targetZ: 0,
      targetBlockId: BlockId.Stone,
      faceX: -1,
      faceY: 0,
      faceZ: 0,
      hitX: 10_000,
      hitY: 70.5,
      hitZ: 0.5,
    };
    const result = world.beginMining(player, intent, 1, 1);
    expect(result).toEqual({ ok: false, reason: 'bounds' });
    expect(player.miningTarget).toBeUndefined();
  });

  it('rejects sign_update on a legacy sign outside the border', async () => {
    const { world, add } = await boot();
    const { player, sink } = add('Writer');
    player.controller.teleport([9_996.5, 70, 0.5]);
    world.world.setBlock(10_000, 69, 0, BlockId.Stone);
    world.world.setBlock(10_000, 70, 0, BlockId.OakSign);
    world.updateSign(player, {
      type: 'sign_update',
      x: 10_000, y: 70, z: 0,
      lines: ['Outside', '', '', ''],
    });
    expect(world.world.signText(10_000, 70, 0)).toBeUndefined();
    expect(sink.last('error')?.code).toBe('sign_invalid');
  });

  it('rejects enterVehicle for a legacy cart already outside the border', async () => {
    const { world, add } = await boot();
    const { player } = add('Rider');
    player.controller.teleport([9_996.5, 70, 0.5]);
    world.world.setBlock(10_000, 69, 0, BlockId.Stone);
    world.world.setBlock(10_000, 70, 0, BlockId.Rail);
    const cart = world.gameplay.minecarts.spawn(10_000, 70, 0);
    expect(cart).toBeDefined();
    cart!.position.set(10_000.5, 70, 0.5);
    expect(world.gameplay.enterVehicle(player, cart!.id)).toBe(false);
    expect(player.ridingCartId).toBeUndefined();
  });

  it('lets an inside cart still be entered', async () => {
    const { world, add } = await boot();
    const { player } = add('Inside');
    player.controller.teleport([8.5, 70, 8.5]);
    world.world.setBlock(8, 69, 8, BlockId.Stone);
    world.world.setBlock(8, 70, 8, BlockId.Rail);
    const cart = world.gameplay.minecarts.spawn(8, 70, 8)!;
    expect(world.gameplay.enterVehicle(player, cart.id)).toBe(true);
    expect(player.ridingCartId).toBe(cart.id);
  });
});
