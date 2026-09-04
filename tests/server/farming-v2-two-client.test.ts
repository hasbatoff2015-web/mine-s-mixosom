import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';
import type { ClientInputMessage, ServerPlayerStateMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-farm-v2-'));
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
  };
}

class MemorySink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void {
    this.payloads.push(payload);
  }
}

function walkInput(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input',
    seq,
    forward: 1,
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

describe('two Anarchy clients: Farming V1 + Networking V2', () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(): Promise<WorldInstance> {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  function join(world: WorldInstance, name: string) {
    const sink = new MemorySink();
    const result = world.join({ sink, name });
    if ('error' in result) throw new Error(result.error);
    return { ...result, sink };
  }

  it('walks A on FIFO ticks; B sees ackCommandSeq snapshots without latest-input skip', async () => {
    const world = await boot();
    const a = join(world, 'Walker');
    const b = join(world, 'Watcher');
    const origin = a.player.controller.position.clone();
    expect(world.applyInput(a.player, walkInput(1, { forward: 1 }))).toBe(true);
    expect(world.applyInput(a.player, walkInput(2, { forward: -1 }))).toBe(true);
    world.tick();
    expect(a.player.snapshot().ackCommandSeq).toBe(1);
    const afterFirst = a.player.controller.position.clone();
    expect(afterFirst.distanceTo(origin)).toBeGreaterThan(0.01);
    world.tick();
    expect(a.player.snapshot().ackCommandSeq).toBe(2);
    const states = b.sink.payloads.filter((payload): payload is ServerPlayerStateMessage => (
      Boolean(payload) && typeof payload === 'object' && (payload as { type?: string }).type === 'player_state'
    ));
    expect(states.length).toBeGreaterThanOrEqual(2);
    const last = states[states.length - 1]!;
    expect(last.tick).toBe(world.tickNumber);
    const remoteA = last.players.find((player) => player.id === a.player.id);
    expect(remoteA?.ackCommandSeq).toBe(2);
    expect(world.lastTickMs).toBeLessThan(50);
  });

  it('networks farmland hydrated state to the second client', async () => {
    const world = await boot();
    const a = join(world, 'Farmer');
    const b = join(world, 'Peer');
    world.setGameMode(a.player, 'creative');
    const x = Math.floor(a.player.controller.position.x);
    const y = Math.floor(a.player.controller.position.y);
    const z = Math.floor(a.player.controller.position.z) + 2;
    world.world.setBlock(x, y, z, BlockId.Dirt);
    world.world.setBlock(x, y + 1, z, BlockId.Air);
    expect(world.world.setBlock(x, y, z, BlockId.Farmland)).toBe(true);
    world.world.setBlockState(x, y, z, { hydrated: true });
    world.tick();
    const updates = b.sink.payloads.filter((payload): payload is {
      type: string;
      x?: number;
      y?: number;
      z?: number;
      blockId?: number;
      state?: { hydrated?: boolean };
      changes?: Array<{ x: number; y: number; z: number; blockId: number; state?: { hydrated?: boolean } }>;
    } => Boolean(payload) && typeof payload === 'object' && (
      (payload as { type?: string }).type === 'block_update'
      || (payload as { type?: string }).type === 'block_batch'
    ));
    const seen = updates.some((message) => {
      if (message.type === 'block_update') {
        return message.x === x && message.y === y && message.z === z
          && message.blockId === BlockId.Farmland
          && message.state?.hydrated === true;
      }
      return message.changes?.some((change) => (
        change.x === x && change.y === y && change.z === z
        && change.blockId === BlockId.Farmland
        && change.state?.hydrated === true
      )) === true;
    });
    expect(seen).toBe(true);
  });
});
