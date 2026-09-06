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

describe('server mining lock hold vs omitted mining', { timeout: 30_000 }, () => {
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
    return { world, player: joined.player };
  }

  async function holdThenFinish(block: BlockId) {
    const { world, player } = await boot(`Hold-${getBlockDefinition(block).key}`);
    const hit = prepareTarget(world, player, block);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    const ticks = clientTicksToFinish(block);
    let seq = 1;
    for (let tick = 1; tick <= ticks; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
      if (world.world.getBlock(hit.x, hit.y, hit.z) === BlockId.Air) {
        return { world, player, hit, ticks, auto: true };
      }
    }
    expect(player.miningTarget).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    expect(player.miningProgress).toBeGreaterThan(0);
    const finish = world.tryBreak(player, hit.x, hit.y, hit.z, intent, seq);
    expect(finish, `${getBlockDefinition(block).key} finish`).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
    return { world, player, hit, ticks, auto: false };
  }

  it('1) long hold with mining:true every tick breaks the block', async () => {
    const result = await holdThenFinish(BlockId.OakPlanks);
    expect(result.ticks).toBe(60);
  });

  it('2) omitted mining during an active lock is cancel, not idle — client must not send it while holding', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.OakPlanks);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(player.miningTarget).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    world.applyInput(player, input(3));
    world.tick();
    expect(player.miningTarget).toBeUndefined();
    expect(player.miningProgress).toBe(0);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 3)).toEqual({ ok: false, reason: 'mining' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.OakPlanks);
  });

  it('3) oak log 60 ticks with mining:true breaks', async () => {
    const result = await holdThenFinish(BlockId.OakLog);
    expect(result.ticks).toBe(60);
  });

  it('4) oak planks 60 ticks with mining:true breaks', async () => {
    const result = await holdThenFinish(BlockId.OakPlanks);
    expect(result.ticks).toBe(60);
  });

  it('5) stone 150 ticks with mining:true breaks', async () => {
    const result = await holdThenFinish(BlockId.Stone);
    expect(result.ticks).toBe(150);
  });

  it('6-7) mining reject → resend start → wait progress>0 → finish ok; finish at progress=0 fails', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.OakPlanks);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    world.applyInput(player, input(3));
    world.tick();
    expect(player.miningTarget).toBeUndefined();
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 3)).toEqual({ ok: false, reason: 'mining' });

    world.applyInput(player, input(4, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 2, 4)).toEqual({ ok: true });
    expect(player.miningProgress).toBe(0);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 4)).toEqual({ ok: false, reason: 'in_progress' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.OakPlanks);

    world.applyInput(player, input(5, { mining: true }));
    world.tick();
    expect(player.miningProgress).toBeGreaterThan(0);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 5)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('8) mouse-up (mining omitted) clears server miningTarget', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.OakLog);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(player.miningTarget).toBeDefined();
    world.applyInput(player, input(3));
    world.tick();
    expect(player.miningTarget).toBeUndefined();
  });

  it('9) changing target replaces the server lock; cell A is not left active', async () => {
    const { world, player } = await boot();
    const first = prepareTarget(world, player, BlockId.OakPlanks, 0);
    const second = prepareTarget(world, player, BlockId.Dirt, 1);
    world.world.setBlock(first.x, first.y, first.z, BlockId.OakPlanks);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, blockTargetFromHit(first), 1, 1)).toEqual({ ok: true });
    expect(player.miningTarget).toEqual({ x: first.x, y: first.y, z: first.z });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(world.beginMining(player, blockTargetFromHit(second), 2, 2)).toEqual({ ok: true });
    expect(player.miningTarget).toEqual({ x: second.x, y: second.y, z: second.z });
    expect(player.miningTarget).not.toEqual({ x: first.x, y: first.y, z: first.z });
    expect(world.world.getBlock(first.x, first.y, first.z)).toBe(BlockId.OakPlanks);
  });

  it('10) Ada mining X and Bob mining Y stay independent', async () => {
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
    world.world.setBlock(bobX, bobY, bobZ, BlockId.OakLog);
    const bobRay = world.world.raycast(
      bobEye,
      new Vec3(bobX + 0.5 - bobEye.x, bobY + 0.5 - bobEye.y, bobZ + 0.5 - bobEye.z).normalize(),
      PLAYER_NET_REACH,
    );
    if (!bobRay) throw new Error('bob log was not raycastable');
    const bobHit = { ...bobRay, block: BlockId.OakLog };
    world.applyInput(ada, input(2, { mining: true }));
    world.applyInput(bob, input(2, { mining: true }));
    world.tick();
    expect(world.beginMining(ada, blockTargetFromHit(adaHit), 1, 2)).toEqual({ ok: true });
    expect(world.beginMining(bob, blockTargetFromHit(bobHit), 1, 2)).toEqual({ ok: true });
    expect(ada.miningTarget).not.toEqual(bob.miningTarget);
    world.applyInput(ada, input(3, { mining: true }));
    world.applyInput(bob, input(3, { mining: true }));
    world.tick();
    expect(ada.miningTarget).toEqual({ x: adaHit.x, y: adaHit.y, z: adaHit.z });
    expect(bob.miningTarget).toEqual({ x: bobHit.x, y: bobHit.y, z: bobHit.z });
    expect(world.world.getBlock(adaHit.x, adaHit.y, adaHit.z)).toBe(BlockId.OakPlanks);
    expect(world.world.getBlock(bobHit.x, bobHit.y, bobHit.z)).toBe(BlockId.OakLog);
  });
});

/**
 * Live bug after PR #59: first START→FINISH is a dry cycle, the second breaks.
 * Neighbors then break on the first cycle while LMB stays down.
 *
 * Cause: `tickOnline` sends `input` then `block_break_start`. The server
 * accepts START immediately, but `PlayerCommandQueue` still applies older
 * idle commands (no `mining`) one per physics tick and wipes `miningTarget`.
 */
describe('first mining cycle vs queued pre-START idle commands', { timeout: 30_000 }, () => {
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

  function enqueueIdles(world: WorldInstance, player: ServerPlayer, from: number, to: number) {
    for (let seq = from; seq <= to; seq += 1) world.applyInput(player, input(seq));
  }

  it('queued idles applied after beginMining must not wipe the lock (cycle #1 would otherwise fail)', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.Dirt);
    const intent = blockTargetFromHit(hit);
    const leftover = 8;
    const startSeq = leftover + 1;

    enqueueIdles(world, player, 1, leftover);
    world.applyInput(player, input(startSeq, { mining: true }));
    expect(world.beginMining(player, intent, 1, startSeq)).toEqual({ ok: true });
    expect(player.miningTarget).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    expect(player.miningProgress).toBe(0);

    const afterStart = {
      target: player.miningTarget ? { ...player.miningTarget } : undefined,
      progress: player.miningProgress,
      applied: player.appliedCommandSeq,
      startSeq,
    };

    for (let i = 0; i < leftover; i += 1) world.tick();

    const afterDrain = {
      target: player.miningTarget ? { ...player.miningTarget } : undefined,
      progress: player.miningProgress,
      applied: player.appliedCommandSeq,
    };

    expect(
      afterDrain.target,
      `START #1 accepted ${JSON.stringify(afterStart)} then leftover idles wiped the lock: ${JSON.stringify(afterDrain)}`,
    ).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    expect(player.miningProgress, 'stale pre-START idles must still count as hold ticks after START').toBeGreaterThan(0);

    const ticks = clientTicksToFinish(BlockId.Dirt);
    let seq = startSeq;
    for (let tick = leftover + 1; tick <= ticks; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
    }
    const finish1 = world.world.getBlock(hit.x, hit.y, hit.z) === BlockId.Air
      ? { ok: true as const, reason: 'auto-break' }
      : world.tryBreak(player, hit.x, hit.y, hit.z, intent, seq);
    expect(finish1.ok, `FINISH #1 ${JSON.stringify(finish1)} progress=${player.miningProgress}`).toBe(true);
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('START A#1 with leftover idles, A#2 after remine, then neighbor B on first cycle while holding', async () => {
    const { world, player } = await boot();
    const first = prepareTarget(world, player, BlockId.OakPlanks, 0);
    const firstIntent = blockTargetFromHit(first);
    const leftover = 8;
    const start1 = leftover + 1;

    enqueueIdles(world, player, 1, leftover);
    world.applyInput(player, input(start1, { mining: true }));
    expect(world.beginMining(player, firstIntent, 1, start1)).toEqual({ ok: true });

    const ticks = clientTicksToFinish(BlockId.OakPlanks);
    let seq = start1;
    for (let step = 0; step < leftover; step += 1) world.tick();
    expect(player.miningTarget, 'cycle #1 lock must survive leftover idle drain').toEqual({
      x: first.x, y: first.y, z: first.z,
    });

    for (let tick = leftover + 1; tick <= ticks; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
    }
    if (world.world.getBlock(first.x, first.y, first.z) !== BlockId.Air) {
      const finish1 = world.tryBreak(player, first.x, first.y, first.z, firstIntent, seq);
      expect(finish1, 'FINISH A#1').toEqual({ ok: true });
    }
    expect(world.world.getBlock(first.x, first.y, first.z)).toBe(BlockId.Air);

    const second = prepareTarget(world, player, BlockId.Dirt, 1);
    const secondIntent = blockTargetFromHit(second);
    seq += 1;
    const startB = seq;
    world.applyInput(player, input(startB, { mining: true }));
    expect(world.beginMining(player, secondIntent, 2, startB)).toEqual({ ok: true });
    const dirtTicks = clientTicksToFinish(BlockId.Dirt);
    for (let tick = 1; tick <= dirtTicks; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
    }
    if (world.world.getBlock(second.x, second.y, second.z) !== BlockId.Air) {
      expect(world.tryBreak(player, second.x, second.y, second.z, secondIntent, seq)).toEqual({ ok: true });
    }
    expect(world.world.getBlock(second.x, second.y, second.z)).toBe(BlockId.Air);
  });

  it('omitted mining with seq >= START still cancels (real mouse-up)', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.OakLog);
    const intent = blockTargetFromHit(hit);
    enqueueIdles(world, player, 1, 4);
    world.applyInput(player, input(5, { mining: true }));
    expect(world.beginMining(player, intent, 1, 5)).toEqual({ ok: true });
    for (let i = 0; i < 4; i += 1) world.tick();
    world.tick();
    expect(player.miningTarget).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    world.applyInput(player, input(6, { mining: true }));
    world.tick();
    world.applyInput(player, input(7));
    world.tick();
    expect(player.miningTarget).toBeUndefined();
    expect(player.miningProgress).toBe(0);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 7)).toEqual({ ok: false, reason: 'mining' });
  });

  it('sticky lastApplied idle with seq < START must not wipe before the mining command is dequeued', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player, BlockId.Dirt);
    const intent = blockTargetFromHit(hit);
    world.applyInput(player, input(1));
    world.tick();
    expect(player.appliedCommandSeq).toBe(1);
    expect(world.beginMining(player, intent, 1, 5)).toEqual({ ok: true });
    world.tick();
    expect(player.miningTarget).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    expect(player.miningProgress).toBeGreaterThan(0);
    world.applyInput(player, input(5, { mining: true }));
    const ticks = clientTicksToFinish(BlockId.Dirt);
    let seq = 5;
    for (let tick = 2; tick <= ticks; tick += 1) {
      seq += 1;
      world.applyInput(player, input(seq, { mining: true }));
      world.tick();
    }
    if (world.world.getBlock(hit.x, hit.y, hit.z) !== BlockId.Air) {
      expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, seq)).toEqual({ ok: true });
    }
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('Bob connected does not change Ada leftover-idle first cycle', async () => {
    const { world, player: ada } = await boot('Ada');
    const bobJoin = world.join({ sink: new MemorySink(), name: 'Bob' });
    if ('error' in bobJoin) throw new Error(bobJoin.error);
    const bob = bobJoin.player;
    world.setGameMode(bob, 'survival');
    bob.controller.teleport([12.5, 70, 8.5]);
    world.applyInput(bob, input(1));
    world.tick();

    const hit = prepareTarget(world, ada, BlockId.Dirt);
    const intent = blockTargetFromHit(hit);
    enqueueIdles(world, ada, 1, 8);
    world.applyInput(ada, input(9, { mining: true }));
    expect(world.beginMining(ada, intent, 1, 9)).toEqual({ ok: true });
    for (let i = 0; i < 8; i += 1) world.tick();
    expect(ada.miningTarget).toEqual({ x: hit.x, y: hit.y, z: hit.z });
    expect(bob.miningTarget).toBeUndefined();
  });

  it('matrix: leftover-idle first cycle breaks dirt, stone, oak log, oak planks', async () => {
    const rows: Array<{ key: string; firstCycleOk: boolean }> = [];
    for (const block of [BlockId.Dirt, BlockId.Stone, BlockId.OakLog, BlockId.OakPlanks] as const) {
      const { world, player } = await boot(`Matrix-${getBlockDefinition(block).key}`);
      const hit = prepareTarget(world, player, block);
      const intent = blockTargetFromHit(hit);
      const leftover = 8;
      const startSeq = leftover + 1;
      enqueueIdles(world, player, 1, leftover);
      world.applyInput(player, input(startSeq, { mining: true }));
      expect(world.beginMining(player, intent, 1, startSeq)).toEqual({ ok: true });
      const ticks = clientTicksToFinish(block);
      let seq = startSeq;
      for (let step = 0; step < leftover; step += 1) world.tick();
      for (let tick = leftover + 1; tick <= ticks; tick += 1) {
        seq += 1;
        world.applyInput(player, input(seq, { mining: true }));
        world.tick();
      }
      const auto = world.world.getBlock(hit.x, hit.y, hit.z) === BlockId.Air;
      const finish = auto ? { ok: true as const } : world.tryBreak(player, hit.x, hit.y, hit.z, intent, seq);
      rows.push({ key: getBlockDefinition(block).key, firstCycleOk: finish.ok && world.world.getBlock(hit.x, hit.y, hit.z) === BlockId.Air });
    }
    for (const row of rows) {
      expect(row.firstCycleOk, `${row.key} first cycle`).toBe(true);
    }
  });
});
