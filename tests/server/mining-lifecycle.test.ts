import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition, miningProgressPerTick } from '../../src/blocks';
import { PLAYER_NET_REACH } from '../../src/core/constants';
import { Vec3 } from '../../src/math/vec3';
import { blockTargetFromHit } from '../../src/net/actionIntent';
import {
  applyBreakActionResult,
  noteBreakAbortSent,
  noteBreakFinishSent,
  noteBreakStartSent,
  noteResendBreakStart,
  resolveOnlineMiningTick,
  shouldHoldServerMining,
  shouldResendBreakStartAfterFinishReject,
  shouldSendBreakAbort,
  type OnlineBreakGate,
} from '../../src/net/onlineMining';
import type { ClientInputMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import type { VoxelHit } from '../../src/world/World';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-mine-lifecycle-'));
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

function keyOf(hit: { x: number; y: number; z: number }): string {
  return `${hit.x},${hit.y},${hit.z}`;
}

/** Client tickOnline order: input packet, then START/FINISH, matching Game.ts. */
class MineLoop {
  readonly gate: OnlineBreakGate = {};
  miningTarget?: string;
  miningProgress = 0;
  inputSeq = 0;
  actionSeq = 0;
  buttonDown = false;
  overlayResets = 0;
  startCount = 0;
  readonly traces: string[] = [];
  readonly finishes: Array<{
    ok: boolean;
    reason?: string;
    clientProgress: number;
    serverProgress: number;
    startCmd?: number;
    applied: number;
    finishCmd: number;
    queueDepth: number;
    actionSeq: number;
    inputMining: boolean;
    target: string;
    blockId: number;
  }> = [];

  constructor(
    readonly world: WorldInstance,
    readonly player: ServerPlayer,
  ) {}

  enqueueIdles(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.inputSeq += 1;
      this.world.applyInput(this.player, input(this.inputSeq));
    }
  }

  tick(look: VoxelHit | undefined, serverTick = true): void {
    this.inputSeq += 1;
    const hold = shouldHoldServerMining({
      buttonDown: this.buttonDown,
      finishKey: this.gate.miningFinishKey,
      miningLocked: this.gate.miningLocked,
    });
    this.world.applyInput(this.player, input(this.inputSeq, hold ? { mining: true } : {}));

    if (!this.buttonDown && this.miningTarget && shouldSendBreakAbort({
      miningReleased: true,
      miningTarget: this.miningTarget,
      finishKey: this.gate.miningFinishKey,
      awaitingAutoBreak: this.gate.awaitingAutoBreak,
    })) {
      this.world.abortMining(this.player);
      noteBreakAbortSent(this.gate);
    }

    if (this.gate.miningFinishKey) {
      this.gate.finishWaitTicks = (this.gate.finishWaitTicks ?? 0) + 1;
    } else {
      this.gate.finishWaitTicks = 0;
    }

    const targetKey = look ? keyOf(look) : undefined;
    const op = resolveOnlineMiningTick({
      buttonDown: this.buttonDown,
      targetKey,
      miningTarget: this.miningTarget,
      finishKey: this.gate.miningFinishKey,
      clientWaitFinish: this.gate.clientWaitFinish,
      miningLocked: this.gate.miningLocked,
      finishWaitTicks: this.gate.finishWaitTicks,
      awaitingAutoBreak: this.gate.awaitingAutoBreak,
    });

    if (op.type === 'abandon-start' || op.type === 'abandon-idle') {
      this.world.abortMining(this.player);
      noteBreakAbortSent(this.gate);
      this.miningTarget = undefined;
      this.miningProgress = 0;
      if (op.type === 'abandon-idle') {
        if (serverTick) this.world.tick();
        return;
      }
      this.start(look!);
      this.advance(look!);
      if (serverTick) this.world.tick();
      return;
    }
    if (op.type === 'idle') {
      if (this.gate.miningLocked && !this.gate.miningFinishKey) {
        this.world.abortMining(this.player);
        noteBreakAbortSent(this.gate);
      }
      this.miningTarget = undefined;
      this.miningProgress = 0;
      if (serverTick) this.world.tick();
      return;
    }
    if (op.type === 'start') {
      this.start(look!);
      this.advance(look!);
      if (serverTick) this.world.tick();
      return;
    }
    if (op.type === 'progress' || op.type === 'wait' || op.type === 'hold-idle') {
      if (op.type === 'progress') this.advance(look!);
      if (serverTick) this.world.tick();
    }
  }

  private start(look: VoxelHit): void {
    const targetKey = keyOf(look);
    this.miningTarget = targetKey;
    this.miningProgress = 0;
    this.gate.miningFinishKey = undefined;
    this.gate.clientWaitFinish = false;
    this.gate.pendingBlockAction = undefined;
    this.gate.finishWaitTicks = 0;
    this.gate.miningLocked = false;
    this.gate.awaitingAutoBreak = false;
    this.actionSeq += 1;
    this.startCount += 1;
    const intent = blockTargetFromHit(look);
    const start = this.world.beginMining(this.player, intent, this.actionSeq, this.inputSeq);
    noteBreakStartSent(this.gate, look.x, look.y, look.z);
    applyBreakActionResult(this.gate, {
      ok: start.ok,
      reason: 'reason' in start ? start.reason : undefined,
      kind: 'block_break_start',
      x: look.x, y: look.y, z: look.z,
    });
    this.traces.push(
      `CLIENT START target=${targetKey} id=${look.block} clientProgress=0.000`
      + ` cmd=${this.inputSeq} actionSeq=${this.actionSeq}`
      + ` startCmd=${this.player.miningStartCommandSeq ?? '—'} applied=${this.player.appliedCommandSeq}`
      + ` queue=${this.player.commandQueue.length} input.mining=${shouldHoldServerMining({
        buttonDown: this.buttonDown,
        finishKey: this.gate.miningFinishKey,
        miningLocked: this.gate.miningLocked,
      }) ? 1 : 0}`,
    );
    this.traces.push(
      `SERVER START target=${targetKey} id=${look.block} serverProgress=${this.player.miningProgress.toFixed(3)}`
      + ` startCmd=${this.player.miningStartCommandSeq ?? '—'} applied=${this.player.appliedCommandSeq}`
      + ` queue=${this.player.commandQueue.length} ok=${start.ok}`,
    );
  }

  private advance(look: VoxelHit): void {
    const targetKey = keyOf(look);
    const delta = miningProgressPerTick(getBlockDefinition(look.block));
    this.miningProgress += delta;
    this.traces.push(`CLIENT progress target=${targetKey} clientProgress=${this.miningProgress.toFixed(3)} serverProgress=${this.player.miningProgress.toFixed(3)}`);
    if (this.miningProgress < 1) return;
    this.traces.push(`CLIENT progress 1.000 target=${targetKey}`);
    if (!this.miningTarget) return;
    this.finish(look);
  }

  private finish(look: VoxelHit): void {
    const targetKey = keyOf(look);
    const hold = this.gate.miningStartUnacked
      ? 'awaiting-start'
      : this.gate.miningFinishKey === targetKey
        ? 'finish-inflight'
        : 'ok';
    if (hold !== 'ok') {
      this.traces.push(`CLIENT FINISH held hold=${hold} target=${targetKey} clientProgress=${this.miningProgress.toFixed(3)}`);
      return;
    }
    noteBreakFinishSent(this.gate, look.x, look.y, look.z);
    this.actionSeq += 1;
    const intent = blockTargetFromHit(look);
    const beforeProgress = this.player.miningProgress;
    const result = this.world.tryBreak(this.player, look.x, look.y, look.z, intent, this.inputSeq);
    const record = {
      ok: result.ok,
      reason: 'reason' in result ? result.reason : undefined,
      clientProgress: this.miningProgress,
      serverProgress: beforeProgress,
      startCmd: this.player.miningStartCommandSeq,
      applied: this.player.appliedCommandSeq,
      finishCmd: this.inputSeq,
      queueDepth: this.player.commandQueue.length,
      actionSeq: this.actionSeq,
      inputMining: this.player.lastInput.mining === true,
      target: targetKey,
      blockId: look.block,
    };
    this.finishes.push(record);
    this.traces.push(
      `CLIENT FINISH target=${targetKey} id=${look.block} clientProgress=${this.miningProgress.toFixed(3)}`
      + ` cmd=${this.inputSeq} actionSeq=${this.actionSeq}`,
    );
    this.traces.push(
      `SERVER FINISH target=${targetKey} id=${look.block} serverProgress=${beforeProgress.toFixed(3)}`
      + ` startCmd=${record.startCmd ?? '—'} applied=${record.applied} finishCmd=${record.finishCmd}`
      + ` input.mining=${record.inputMining ? 1 : 0} queue=${record.queueDepth}`
      + ` reason=${record.reason ?? 'ok'} mutated=${result.ok ? 1 : 0}`,
    );
    applyBreakActionResult(this.gate, {
      ok: result.ok,
      reason: record.reason,
      kind: 'block_break_finish',
      x: look.x, y: look.y, z: look.z,
    });
    if (result.ok) {
      this.miningTarget = undefined;
      this.miningProgress = 0;
      return;
    }
    if (shouldResendBreakStartAfterFinishReject(record.reason) && this.buttonDown && this.miningTarget === targetKey) {
      this.overlayResets += 1;
      this.miningProgress = 0;
      noteResendBreakStart(this.gate);
      this.start(look);
    }
  }
}

describe('Anarchy mining lifecycle: first FINISH vs server progress 0', { timeout: 30_000 }, () => {
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
    return { world, player: joined.player, loop: new MineLoop(world, joined.player) };
  }

  function holdClientUntilOverlay(loop: MineLoop, look: VoxelHit, serverTick = false): void {
    const cap = clientTicksToFinish(look.block as BlockId) + 3;
    for (let tick = 0; tick < cap; tick += 1) {
      loop.tick(look, serverTick);
      if (loop.miningProgress >= 1) return;
    }
    throw new Error(
      `overlay did not reach 1.0 in ${cap} ticks (progress=${loop.miningProgress})\n${loop.traces.join('\n')}`,
    );
  }

  function holdUntilBroken(loop: MineLoop, look: VoxelHit, maxTicks?: number): number {
    const cap = maxTicks ?? clientTicksToFinish(look.block as BlockId) + 8;
    for (let tick = 0; tick < cap; tick += 1) {
      loop.tick(look);
      if (loop.world.world.getBlock(look.x, look.y, look.z) === BlockId.Air) return tick + 1;
    }
    throw new Error(`block ${look.block} at ${keyOf(look)} did not break in ${cap} ticks\n${loop.traces.join('\n')}`);
  }

  it('C) first overlay FINISH at server progress 0 must not dry-reset; server then breaks', async () => {
    const { world, player, loop } = await boot();
    const look = prepareTarget(world, player, BlockId.Dirt);
    loop.enqueueIdles(8);
    loop.buttonDown = true;
    holdClientUntilOverlay(loop, look, false);

    expect(loop.miningProgress, loop.traces.join('\n')).toBeGreaterThanOrEqual(1);
    expect(player.miningTarget).toEqual({ x: look.x, y: look.y, z: look.z });
    expect(player.miningProgress).toBe(0);

    const first = loop.finishes[0];
    expect(first, `expected a FINISH after overlay 1.0\n${loop.traces.join('\n')}`).toBeDefined();
    expect(first?.reason, `first FINISH must not be a missing lock\n${loop.traces.join('\n')}`).toBe('in_progress');
    expect(first?.ok).toBe(false);
    expect(first?.serverProgress).toBe(0);
    expect(first?.clientProgress).toBeGreaterThanOrEqual(1);
    expect(loop.overlayResets, 'in_progress must not restart the overlay').toBe(0);
    expect(loop.startCount).toBe(1);
    expect(loop.miningProgress).toBeGreaterThanOrEqual(1);
    expect(world.world.getBlock(look.x, look.y, look.z)).toBe(BlockId.Dirt);

    for (let i = 0; i < clientTicksToFinish(BlockId.Dirt) + 2; i += 1) {
      loop.tick(look, true);
      if (world.world.getBlock(look.x, look.y, look.z) === BlockId.Air) break;
    }
    expect(world.world.getBlock(look.x, look.y, look.z), loop.traces.join('\n')).toBe(BlockId.Air);
    expect(loop.overlayResets).toBe(0);
  });

  it('C2) catch-up ticks after in_progress must not abandon into a second overlay', async () => {
    const { world, player, loop } = await boot();
    const look = prepareTarget(world, player, BlockId.Dirt);
    loop.enqueueIdles(8);
    loop.buttonDown = true;
    holdClientUntilOverlay(loop, look, false);
    expect(loop.finishes[0]?.reason).toBe('in_progress');
    expect(loop.gate.awaitingAutoBreak).toBe(true);
    for (let i = 0; i < 50; i += 1) loop.tick(look, false);
    expect(loop.overlayResets, loop.traces.join('\n')).toBe(0);
    expect(loop.startCount, 'catch-up must not START a second cycle').toBe(1);
    expect(loop.finishes.length).toBe(1);
    expect(player.miningTarget).toEqual({ x: look.x, y: look.y, z: look.z });
    expect(world.world.getBlock(look.x, look.y, look.z)).toBe(BlockId.Dirt);
    for (let i = 0; i < clientTicksToFinish(BlockId.Dirt) + 2; i += 1) {
      loop.tick(look, true);
      if (world.world.getBlock(look.x, look.y, look.z) === BlockId.Air) break;
    }
    expect(world.world.getBlock(look.x, look.y, look.z), loop.traces.join('\n')).toBe(BlockId.Air);
    expect(loop.overlayResets).toBe(0);
  });

  it('A vs B) short hold then retarget B equals long hold then retarget B', async () => {
    const runs: Array<{ label: string; holdA: number }> = [
      { label: 'A-short', holdA: 1 },
      { label: 'B-long', holdA: 12 },
    ];
    const cycles: number[] = [];
    for (const run of runs) {
      const { world, player, loop } = await boot(run.label);
      const blockA = prepareTarget(world, player, BlockId.Dirt, 0);
      const blockB = prepareTarget(world, player, BlockId.Dirt, 1);
      loop.enqueueIdles(8);
      loop.buttonDown = true;
      for (let i = 0; i < run.holdA; i += 1) loop.tick(blockA);
      const cyclesBeforeB = loop.overlayResets;
      const started = holdUntilBroken(loop, blockB);
      expect(world.world.getBlock(blockB.x, blockB.y, blockB.z)).toBe(BlockId.Air);
      expect(loop.overlayResets).toBe(cyclesBeforeB);
      cycles.push(started);
    }
    expect(cycles[0]).toBeLessThanOrEqual(clientTicksToFinish(BlockId.Dirt) + 2);
    expect(cycles[1]).toBeLessThanOrEqual(clientTicksToFinish(BlockId.Dirt) + 2);
  });

  it('F) one client tick on A then retarget B still starts B correctly', async () => {
    const { world, player, loop } = await boot();
    const blockA = prepareTarget(world, player, BlockId.Dirt, 0);
    const blockB = prepareTarget(world, player, BlockId.Dirt, 1);
    loop.enqueueIdles(6);
    loop.buttonDown = true;
    loop.tick(blockA);
    holdUntilBroken(loop, blockB);
    expect(world.world.getBlock(blockB.x, blockB.y, blockB.z)).toBe(BlockId.Air);
    expect(loop.overlayResets).toBe(0);
  });

  it('D) dirt, stone, oak log, oak planks share the same first-cycle lifecycle', async () => {
    for (const block of [BlockId.Dirt, BlockId.Stone, BlockId.OakLog, BlockId.OakPlanks] as const) {
      const { world, player, loop } = await boot(getBlockDefinition(block).key);
      const look = prepareTarget(world, player, block);
      loop.enqueueIdles(8);
      loop.buttonDown = true;
      holdUntilBroken(loop, look, clientTicksToFinish(block) + 8);
      expect(world.world.getBlock(look.x, look.y, look.z), getBlockDefinition(block).key).toBe(BlockId.Air);
      expect(loop.overlayResets, getBlockDefinition(block).key).toBe(0);
    }
  });

  it('E) hold LMB A→B→C→D: each target breaks in one mining cycle after its START', async () => {
    const { world, player, loop } = await boot();
    const targets = [0, 1, 2, 3].map((offset) => prepareTarget(world, player, BlockId.Dirt, offset));
    loop.enqueueIdles(8);
    loop.buttonDown = true;
    for (const look of targets) {
      const resets = loop.overlayResets;
      holdUntilBroken(loop, look);
      expect(world.world.getBlock(look.x, look.y, look.z)).toBe(BlockId.Air);
      expect(loop.overlayResets).toBe(resets);
    }
  });

  it('mouse-up after START still cancels the server lock', async () => {
    const { world, player, loop } = await boot();
    const look = prepareTarget(world, player, BlockId.Dirt);
    loop.buttonDown = true;
    loop.tick(look);
    expect(player.miningTarget).toEqual({ x: look.x, y: look.y, z: look.z });
    loop.buttonDown = false;
    loop.tick(look);
    expect(player.miningTarget).toBeUndefined();
    expect(world.world.getBlock(look.x, look.y, look.z)).toBe(BlockId.Dirt);
  });

  it('mouse-up after in_progress still cancels the server lock', async () => {
    const { world, player, loop } = await boot();
    const look = prepareTarget(world, player, BlockId.Dirt);
    loop.buttonDown = true;
    holdClientUntilOverlay(loop, look, false);
    expect(loop.finishes[0]?.reason).toBe('in_progress');
    expect(player.miningTarget).toBeDefined();
    loop.buttonDown = false;
    loop.tick(look);
    expect(player.miningTarget).toBeUndefined();
    expect(world.world.getBlock(look.x, look.y, look.z)).toBe(BlockId.Dirt);
  });
});
