import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition, miningProgressPerTick } from '../../src/blocks';
import { PLAYER_NET_REACH } from '../../src/core/constants';
import { Vec3 } from '../../src/math/vec3';
import { blockTargetFromHit } from '../../src/net/actionIntent';
import type { ClientInputMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { ACTION_POSE_HISTORY_MAX } from '../../shared/actionPoseHistory';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-oak-planks-mine-'));
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

function carveAir(world: WorldInstance, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) world.world.setBlock(x, y, z, BlockId.Air);
    }
  }
}

function prepareTarget(world: WorldInstance, player: ServerPlayer, block: BlockId, offsetX = 0) {
  const eye = player.controller.eyePosition();
  const targetX = Math.floor(eye.x) + offsetX;
  const targetY = Math.floor(eye.y);
  const targetZ = Math.floor(eye.z) - 3;
  for (let x = Math.min(Math.floor(eye.x), targetX) - 1; x <= Math.max(Math.floor(eye.x), targetX) + 1; x += 1) {
    for (let y = targetY - 1; y <= targetY + 1; y += 1) {
      for (let z = targetZ; z <= Math.floor(eye.z); z += 1) world.world.setBlock(x, y, z, BlockId.Air);
    }
  }
  world.world.setBlock(targetX, targetY, targetZ, block);
  const center = new Vec3(targetX + 0.5, targetY + 0.5, targetZ + 0.5);
  const direction = center.sub(eye).normalize();
  const hit = world.world.raycast(eye, direction, PLAYER_NET_REACH);
  if (!hit) throw new Error('test target was not raycastable');
  return { ...hit, block };
}

function clientTicksToFinish(block: BlockId): number {
  return Math.ceil(1 / miningProgressPerTick(getBlockDefinition(block)));
}

function blockUpdatesFor(sink: MemorySink, x: number, y: number, z: number) {
  return sink.payloads.filter((payload) => {
    const message = payload as { type?: string; x?: number; y?: number; z?: number };
    return message.type === 'block_update' && message.x === x && message.y === y && message.z === z;
  }) as Array<{ type: string; x: number; y: number; z: number; blockId: number }>;
}

describe('oak planks mining pipeline vs dirt/stone/oak log', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(name = 'Ada') {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, 'survival');
    joined.player.controller.teleport([8.5, 70, 8.5]);
    return { world, player: joined.player, sink };
  }

  function traceBreak(
    world: WorldInstance,
    player: ServerPlayer,
    block: BlockId,
    opts?: { readonly finishWithStartSeq?: boolean; readonly wipeBeforeFinish?: boolean },
  ) {
    const hit = prepareTarget(world, player, block);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    const before = world.world.getBlock(hit.x, hit.y, hit.z);
    const start = world.beginMining(player, intent, 1, 1);
    const clientTicks = clientTicksToFinish(block);
    const holdTicks = opts?.wipeBeforeFinish ? Math.max(2, clientTicks - 10) : clientTicks;
    let seq = 1;
    let autoBrokeAt: number | undefined;
    for (let tick = 1; tick <= holdTicks; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
      if (world.world.getBlock(hit.x, hit.y, hit.z) === BlockId.Air) {
        autoBrokeAt = tick;
        break;
      }
    }
    if (opts?.wipeBeforeFinish && autoBrokeAt === undefined) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: false }));
      world.tick();
    }
    const elapsed = player.miningProgress;
    const miningTarget = player.miningTarget
      ? { ...player.miningTarget }
      : undefined;
    const finishSeq = opts?.finishWithStartSeq ? 1 : seq;
    const finish = autoBrokeAt === undefined
      ? world.tryBreak(player, hit.x, hit.y, hit.z, intent, finishSeq)
      : { ok: true as const, reason: 'auto-break' };
    const after = world.world.getBlock(hit.x, hit.y, hit.z);
    return {
      block,
      key: getBlockDefinition(block).key,
      coords: { x: hit.x, y: hit.y, z: hit.z },
      before,
      after,
      clientTicks,
      requiredDuration: clientTicks / 20,
      start,
      autoBrokeAt,
      miningTarget,
      elapsed,
      finish,
      finishSeq,
    };
  }

  it('A) traces dirt, stone, oak log, oak planks through the same survival finish path', async () => {
    const traces = [];
    for (const block of [BlockId.Dirt, BlockId.Stone, BlockId.OakLog, BlockId.OakPlanks] as const) {
      const { world, player } = await boot(`Trace-${getBlockDefinition(block).key}`);
      traces.push(traceBreak(world, player, block));
    }

    const byKey = Object.fromEntries(traces.map((trace) => [trace.key, trace]));
    expect(byKey.dirt?.before).toBe(BlockId.Dirt);
    expect(byKey.stone?.before).toBe(BlockId.Stone);
    expect(byKey.oak_log?.before).toBe(BlockId.OakLog);
    expect(byKey.oak_planks?.before).toBe(BlockId.OakPlanks);

    expect(byKey.dirt?.clientTicks).toBe(15);
    expect(byKey.oak_log?.clientTicks).toBe(60);
    expect(byKey.oak_planks?.clientTicks).toBe(60);
    expect(byKey.stone?.clientTicks).toBe(150);

    for (const trace of traces) {
      expect(trace.start).toEqual({ ok: true });
      expect(trace.before).toBe(trace.block);
      expect(trace.after, `${trace.key} should be air after a held survival mine`).toBe(BlockId.Air);
      expect(trace.finish.ok, `${trace.key} finish ${JSON.stringify(trace.finish)}`).toBe(true);
    }
  });

  it('E) client overlay ticks match server miningProgressPerTick for all four blocks', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.OakPlanks);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    const perTick = miningProgressPerTick(getBlockDefinition(BlockId.OakPlanks));
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(player.miningProgress).toBeCloseTo(perTick, 10);
    expect(player.miningProgress).toBeCloseTo(1 / 60, 10);
  });

  it('B) a failed oak planks finish (wiped mining) does not mutate the cell; the next block can still break', async () => {
    const { world, player } = await boot();
    const planks = traceBreak(world, player, BlockId.OakPlanks, { wipeBeforeFinish: true });
    expect(planks.autoBrokeAt).toBeUndefined();
    expect(planks.finish).toEqual({ ok: false, reason: 'mining' });
    expect(planks.after).toBe(BlockId.OakPlanks);
    expect(player.miningTarget).toBeUndefined();

    const dirt = prepareTarget(world, player, BlockId.Dirt, 1);
    const dirtIntent = blockTargetFromHit(dirt);
    world.applyInput(player, input(90, { mining: true }));
    world.tick();
    expect(world.beginMining(player, dirtIntent, 2, 90)).toEqual({ ok: true });
    for (let seq = 91; seq <= 106; seq += 1) {
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
    }
    expect(world.world.getBlock(dirt.x, dirt.y, dirt.z)).toBe(BlockId.Air);
  });

  it('rejects finish that reuses the start commandSeq after pose history eviction', async () => {
    const { world, player } = await boot();
    for (let seq = 1; seq <= ACTION_POSE_HISTORY_MAX + 4; seq += 1) {
      world.applyInput(player, input(seq));
      world.tick();
    }
    const hit = prepareTarget(world, player, BlockId.OakPlanks);
    const intent = blockTargetFromHit(hit);
    const startSeq = ACTION_POSE_HISTORY_MAX + 5;
    world.applyInput(player, input(startSeq, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, startSeq)).toEqual({ ok: true });
    let seq = startSeq;
    for (let tick = 0; tick < 50; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
    }
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.OakPlanks);
    for (let extra = 0; extra < 20; extra += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: false }));
      world.tick();
    }
    expect(player.miningTarget).toBeUndefined();
    const finish = world.tryBreak(player, hit.x, hit.y, hit.z, intent, startSeq);
    expect(finish).toEqual({ ok: false, reason: 'stale' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.OakPlanks);
  });

  it('C) Ada failed oak planks finish, Bob breaks that cell, Ada can mine again', async () => {
    const { world, player: ada, sink: adaSink } = await boot('Ada');
    const bobSink = new MemorySink();
    const bobJoin = world.join({ sink: bobSink, name: 'Bob' });
    if ('error' in bobJoin) throw new Error(bobJoin.error);
    const bob = bobJoin.player;
    world.setGameMode(bob, 'survival');
    bob.controller.teleport([8.5, 70, 8.5]);
    world.applyInput(bob, input(1));
    world.tick();

    const failed = traceBreak(world, ada, BlockId.OakPlanks, { wipeBeforeFinish: true });
    expect(failed.finish).toEqual({ ok: false, reason: 'mining' });
    expect(world.world.getBlock(failed.coords.x, failed.coords.y, failed.coords.z)).toBe(BlockId.OakPlanks);
    expect(ada.miningTarget).toBeUndefined();
    expect(bob.miningTarget).toBeUndefined();

    const bobHit = world.world.raycast(
      bob.controller.eyePosition(),
      new Vec3(
        failed.coords.x + 0.5 - bob.controller.eyePosition().x,
        failed.coords.y + 0.5 - bob.controller.eyePosition().y,
        failed.coords.z + 0.5 - bob.controller.eyePosition().z,
      ).normalize(),
      PLAYER_NET_REACH,
    );
    if (!bobHit) throw new Error('bob cannot see the oak planks');
    const bobIntent = blockTargetFromHit({ ...bobHit, block: BlockId.OakPlanks });
    world.applyInput(bob, input(2, { mining: true }));
    world.tick();
    expect(world.beginMining(bob, bobIntent, 1, 2)).toEqual({ ok: true });
    for (let seq = 3; seq <= 63; seq += 1) {
      world.applyInput(bob, input(seq, { mining: true }));
      world.tick();
    }
    expect(world.world.getBlock(failed.coords.x, failed.coords.y, failed.coords.z)).toBe(BlockId.Air);
    expect(ada.miningTarget).toBeUndefined();
    expect(bob.miningTarget).toBeUndefined();

    const adaAir = blockUpdatesFor(adaSink, failed.coords.x, failed.coords.y, failed.coords.z)
      .filter((message) => message.blockId === BlockId.Air);
    expect(adaAir.length).toBeGreaterThan(0);

    const dirt = prepareTarget(world, ada, BlockId.Dirt, 1);
    const dirtIntent = blockTargetFromHit(dirt);
    world.applyInput(ada, input(200, { mining: true }));
    world.tick();
    expect(world.beginMining(ada, dirtIntent, 3, 200)).toEqual({ ok: true });
    for (let seq = 201; seq <= 216; seq += 1) {
      world.applyInput(ada, input(seq, { mining: true }));
      world.tick();
    }
    expect(world.world.getBlock(dirt.x, dirt.y, dirt.z)).toBe(BlockId.Air);
  });

  it('D) Ada and Bob mine different blocks independently; one miningTarget is not global', async () => {
    const { world, player: ada } = await boot('Ada');
    const bobJoin = world.join({ sink: new MemorySink(), name: 'Bob' });
    if ('error' in bobJoin) throw new Error(bobJoin.error);
    const bob = bobJoin.player;
    world.setGameMode(bob, 'survival');
    bob.controller.teleport([12.5, 70, 8.5]);
    world.applyInput(bob, input(1));
    world.tick();

    const adaHit = prepareTarget(world, ada, BlockId.OakPlanks, 0);
    const bobEye = bob.controller.eyePosition();
    const bobX = Math.floor(bobEye.x);
    const bobY = Math.floor(bobEye.y);
    const bobZ = Math.floor(bobEye.z) - 3;
    carveAir(world, bobX - 1, bobY - 1, bobZ, bobX + 1, bobY + 1, Math.floor(bobEye.z));
    world.world.setBlock(bobX, bobY, bobZ, BlockId.Dirt);
    const bobRay = world.world.raycast(
      bobEye,
      new Vec3(bobX + 0.5 - bobEye.x, bobY + 0.5 - bobEye.y, bobZ + 0.5 - bobEye.z).normalize(),
      PLAYER_NET_REACH,
    );
    if (!bobRay) throw new Error('bob dirt was not raycastable');
    const bobHit = { ...bobRay, block: BlockId.Dirt };
    expect(`${adaHit.x},${adaHit.y},${adaHit.z}`).not.toBe(`${bobHit.x},${bobHit.y},${bobHit.z}`);
    expect(world.world.getBlock(adaHit.x, adaHit.y, adaHit.z)).toBe(BlockId.OakPlanks);

    world.applyInput(ada, input(2, { mining: true }));
    world.applyInput(bob, input(2, { mining: true }));
    world.tick();
    expect(world.beginMining(ada, blockTargetFromHit(adaHit), 1, 2)).toEqual({ ok: true });
    expect(world.beginMining(bob, blockTargetFromHit(bobHit), 1, 2)).toEqual({ ok: true });
    expect(ada.miningTarget).toEqual({ x: adaHit.x, y: adaHit.y, z: adaHit.z });
    expect(bob.miningTarget).toEqual({ x: bobHit.x, y: bobHit.y, z: bobHit.z });
    expect(ada.miningTarget).not.toBe(bob.miningTarget);

    world.applyInput(ada, input(3, { mining: true }));
    world.applyInput(bob, input(3, { mining: true }));
    world.tick();
    expect(ada.miningProgress).toBeCloseTo(1 / 60, 8);
    expect(bob.miningProgress).toBeCloseTo(1 / 15, 8);

    for (let seq = 4; seq <= 18; seq += 1) {
      world.applyInput(ada, input(seq, { mining: true }));
      world.applyInput(bob, input(seq, { mining: true }));
      world.tick();
    }
    expect(world.world.getBlock(bobHit.x, bobHit.y, bobHit.z)).toBe(BlockId.Air);
    expect(world.world.getBlock(adaHit.x, adaHit.y, adaHit.z)).toBe(BlockId.OakPlanks);
    expect(ada.miningTarget).toEqual({ x: adaHit.x, y: adaHit.y, z: adaHit.z });
  });

  it('does not share a WorldInstance-level miningTarget; Air on Ada cell wipes only Ada', async () => {
    const { world, player: ada } = await boot('Ada');
    const bobJoin = world.join({ sink: new MemorySink(), name: 'Bob' });
    if ('error' in bobJoin) throw new Error(bobJoin.error);
    const bob = bobJoin.player;
    world.setGameMode(bob, 'creative');
    bob.controller.teleport([8.5, 70, 8.5]);
    world.applyInput(bob, input(1));
    world.tick();
    const hit = prepareTarget(world, ada, BlockId.OakPlanks);
    world.applyInput(ada, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(ada, blockTargetFromHit(hit), 1, 1)).toEqual({ ok: true });
    expect(bob.miningTarget).toBeUndefined();
    expect((world as unknown as { miningTarget?: unknown }).miningTarget).toBeUndefined();
    world.applyInput(ada, input(2, { mining: true }));
    world.tick();
    const bobIntent = blockTargetFromHit(hit);
    expect(world.tryBreak(bob, hit.x, hit.y, hit.z, bobIntent, 1)).toEqual({ ok: true });
    world.applyInput(ada, input(3, { mining: true }));
    world.tick();
    expect(ada.miningTarget).toBeUndefined();
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });
});
