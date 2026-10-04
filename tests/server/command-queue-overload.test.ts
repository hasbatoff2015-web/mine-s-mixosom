import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { createItemStack } from '../../src/inventory';
import { ItemId } from '../../src/items';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { MAX_PENDING_MELEE_TICKS } from '../../server/combatPoseHistory';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import { COMMAND_QUEUE_MAX } from '../../shared/playerCommand';
import type { AttackAction, BowReleaseAction, EntityUseAction } from '../../shared/playerActions';
import type { ClientInputMessage, PlayerSnapshot, ServerActionResultMessage } from '../../shared/protocol';

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
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

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input', seq, clientTick: seq, forward: 0, right: 0, jump: false,
    sneak: false, sprint: false, descend: false, flySprint: false,
    yaw: 0, pitch: 0, selectedSlot: 0, use: false, mining: false,
    ...extra,
  };
}

function lookAt(attacker: ServerPlayer, target: ServerPlayer) {
  const origin = attacker.controller.eyePosition();
  const point = new Vec3(target.controller.position.x, target.controller.position.y + 0.9, target.controller.position.z);
  const direction = point.sub(origin).normalize();
  return {
    yaw: Math.atan2(-direction.x, -direction.z),
    pitch: Math.asin(direction.y),
  };
}

function results(sink: MemorySink, kind: string): ServerActionResultMessage[] {
  return sink.payloads.filter((payload): payload is ServerActionResultMessage => (
    typeof payload === 'object' && payload !== null
    && (payload as { type?: string }).type === 'action_result'
    && (payload as { kind?: string }).kind === kind
  ));
}

describe('command queue overload on WorldInstance', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function bootWorld(): Promise<WorldInstance> {
    const dir = await mkdtemp(join(tmpdir(), 'fc-queue-overload-'));
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    return world;
  }

  async function bootFight() {
    const world = await bootWorld();
    const attackerSink = new MemorySink();
    const victimSink = new MemorySink();
    const a = world.join({ sink: attackerSink, name: 'Attacker' });
    const b = world.join({ sink: victimSink, name: 'Victim' });
    if ('error' in a || 'error' in b) throw new Error('join failed');
    a.player.controller.teleport([20.5, 100, 20.5]);
    b.player.controller.teleport([20.5, 100, 22.5]);
    world.world.setBlock(20, 99, 20, BlockId.Stone);
    world.world.setBlock(20, 99, 22, BlockId.Stone);
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    const look = lookAt(a.player, b.player);
    world.applyInput(a.player, input(1, look));
    world.applyInput(b.player, input(1));
    world.tick();
    return { world, attacker: a.player, victim: b.player, attackerSink, look };
  }

  async function bootArcher() {
    const world = await bootWorld();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Archer' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack(ItemId.Bow));
    player.inventory.setSlot(1, createItemStack(ItemId.Arrow, 64));
    player.controller.teleport([8.5, 72, 8.5]);
    world.applyInput(player, input(1, { use: true }));
    expect(world.interact(player, undefined, 1, 1, 0)).toEqual({ ok: true });
    world.tick();
    player.bowUseTicks = 20;
    sink.payloads.length = 0;
    return { world, player, sink };
  }

  it('compacts a continuous burst and still lands melee before the pending timeout', async () => {
    const { world, attacker, victim, attackerSink, look } = await bootFight();
    const boundary = 20;
    for (let seq = 2; seq <= boundary; seq += 1) {
      world.applyInput(attacker, input(seq, look));
    }
    expect(attacker.commandQueue.length).toBeLessThanOrEqual(4);
    expect(attacker.commandQueue.length).toBeGreaterThan(0);
    expect(attacker.commandQueue.find(boundary)?.commandSeq).toBe(boundary);
    attackerSink.payloads.length = 0;
    const before = victim.survival.health;
    const attack: AttackAction = {
      kind: 'attack', actionSeq: 1, commandSeq: boundary, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch, targetId: victim.id, targetRenderTick: world.tickNumber,
    };
    world.handleSequencedAttack(attacker, attack);
    for (let tick = 0; tick < 4; tick += 1) world.tick();
    expect(victim.survival.health).toBeLessThan(before);
    expect(results(attackerSink, 'attack').some((entry) => entry.combat?.result === 'pending_timeout')).toBe(false);
    expect(results(attackerSink, 'attack').some((entry) => entry.combat?.result === 'hit')).toBe(true);
  });

  it('keeps an admitted melee boundary while later edge spam is rejected', async () => {
    const { world, attacker, victim, attackerSink, look } = await bootFight();
    world.applyInput(attacker, input(2, look));
    const attack: AttackAction = {
      kind: 'attack', actionSeq: 1, commandSeq: 2, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch, targetId: victim.id, targetRenderTick: world.tickNumber,
    };
    world.handleSequencedAttack(attacker, attack);
    expect(attacker.pendingAttacks).toHaveLength(1);
    for (let seq = 3; seq <= 80; seq += 1) {
      world.applyInput(attacker, input(seq, { ...look, jump: seq % 2 === 0 }));
    }
    expect(attacker.commandQueue.find(2)?.commandSeq).toBe(2);
    expect(attacker.commandQueue.length).toBeLessThanOrEqual(COMMAND_QUEUE_MAX);
    expect(attacker.commandQueue.wasOverloadSkipped(2)).toBe(false);
    attackerSink.payloads.length = 0;
    const before = victim.survival.health;
    world.tick();
    expect(attacker.appliedCommandSeq).toBe(2);
    expect(victim.survival.health).toBeLessThan(before);
    expect(results(attackerSink, 'attack')[0]?.combat?.result).toBe('hit');
    expect(attacker.pendingAttacks).toHaveLength(0);
  });

  it('keeps an admitted bow boundary and does not spawn a second arrow', async () => {
    const { world, player, sink } = await bootArcher();
    world.applyInput(player, input(2, { use: false }));
    const release: BowReleaseAction = {
      kind: 'bow_release', actionSeq: 2, commandSeq: 2, selectedSlot: 0, yaw: 0.2, pitch: 0,
    };
    world.handleSequencedBowRelease(player, release);
    expect(player.pendingBowReleases).toHaveLength(1);
    for (let seq = 3; seq <= 80; seq += 1) {
      world.applyInput(player, input(seq, { jump: seq % 2 === 0 }));
    }
    expect(player.commandQueue.find(2)?.commandSeq).toBe(2);
    expect(player.commandQueue.length).toBeLessThanOrEqual(COMMAND_QUEUE_MAX);
    sink.payloads.length = 0;
    world.tick();
    expect(player.appliedCommandSeq).toBe(2);
    expect(world.gameplay.arrows.count).toBe(1);
    expect(results(sink, 'bow_release')[0]?.ok).toBe(true);
    expect(results(sink, 'bow_release')[0]?.bow?.rejectReason).not.toBe('command_overload');
    expect(results(sink, 'bow_release').filter((entry) => entry.ok)).toHaveLength(1);
    world.handleSequencedBowRelease(player, release);
    expect(world.gameplay.arrows.count).toBe(1);
    expect(results(sink, 'bow_release').filter((entry) => entry.ok)).toHaveLength(1);
  });

  it('rejects a bow boundary that arrives after the queue is saturated', async () => {
    const { world, player, sink } = await bootArcher();
    for (let seq = 2; seq <= COMMAND_QUEUE_MAX + 1; seq += 1) {
      world.applyInput(player, input(seq, { jump: seq % 2 === 0 }));
    }
    expect(player.commandQueue.length).toBe(COMMAND_QUEUE_MAX);
    const blocked = COMMAND_QUEUE_MAX + 2;
    world.handleSequencedBowRelease(player, {
      kind: 'bow_release', actionSeq: 2, commandSeq: blocked, selectedSlot: 0, yaw: 0.2, pitch: 0,
    });
    expect(player.pendingBowReleases).toHaveLength(1);
    sink.payloads.length = 0;
    expect(world.applyInput(player, input(blocked, { use: false }))).toBe(true);
    expect(player.commandQueue.isQueued(blocked)).toBe(false);
    expect(player.commandQueue.length).toBe(COMMAND_QUEUE_MAX);
    expect(player.commandQueue.wasOverloadSkipped(blocked)).toBe(true);
    expect(player.pendingBowReleases).toHaveLength(0);
    expect(results(sink, 'bow_release')[0]?.bow?.rejectReason).toBe('command_overload');
    expect(world.gameplay.arrows.count).toBe(0);
    for (let tick = 0; tick <= MAX_PENDING_MELEE_TICKS; tick += 1) world.tick();
    expect(world.gameplay.arrows.count).toBe(0);
    expect(results(sink, 'bow_release').some((entry) => entry.bow?.rejectReason === 'pending_timeout')).toBe(false);
  });

  it('keeps an entity-use boundary under edge pressure and does not leave it pending', async () => {
    const { world, player, sink } = await bootArcher();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(8.5, 72, 10), { force: true });
    expect(wolf).toBeDefined();
    world.applyInput(player, input(2));
    const use: EntityUseAction = {
      kind: 'entity_use', actionSeq: 2, commandSeq: 2, selectedSlot: 0, targetId: wolf!.id,
    };
    expect(world.handleSequencedEntityUse(player, use)).toBeUndefined();
    expect(player.pendingEntityUses).toHaveLength(1);
    for (let seq = 3; seq <= 70; seq += 1) {
      world.applyInput(player, input(seq, { jump: seq % 2 === 0 }));
    }
    expect(player.commandQueue.find(2)?.commandSeq).toBe(2);
    expect(player.commandQueue.length).toBeLessThanOrEqual(COMMAND_QUEUE_MAX);
    sink.payloads.length = 0;
    world.tick();
    expect(player.appliedCommandSeq).toBe(2);
    expect(player.pendingEntityUses).toHaveLength(0);
    const first = results(sink, 'entity_use');
    expect(first).toHaveLength(1);
    expect(first[0]?.reason).not.toBe('pending_timeout');
    expect(first[0]?.reason).not.toBe('command_overload');
    world.tick();
    expect(results(sink, 'entity_use')).toHaveLength(1);
  });

  it('reports disjoint skips, then accepts the next epoch without rewinding seq', async () => {
    const world = await bootWorld();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Runner' });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    for (let seq = 1; seq <= 6; seq += 1) world.applyInput(player, input(seq, { forward: 1 }));
    for (let seq = 7; seq <= COMMAND_QUEUE_MAX + 20; seq += 1) {
      world.applyInput(player, input(seq, { jump: seq % 2 === 0 }));
    }
    expect(player.commandQueue.length).toBeLessThanOrEqual(COMMAND_QUEUE_MAX);
    expect(player.commandQueue.length).toBe(COMMAND_QUEUE_MAX);
    expect(player.commandQueue.skippedRanges.length).toBe(2);
    const snapshot = player.snapshot();
    expect(snapshot.queueCompacted).toBeUndefined();
    expect(snapshot.queueSkippedRanges).toEqual(player.commandQueue.skippedRanges);
    const kept = snapshot.queueSkippedRanges![0]!.toCommandSeq + 1;
    expect(player.commandQueue.find(kept)?.commandSeq).toBe(kept);
    expect(snapshot.session?.commandQueue).toBe(COMMAND_QUEUE_MAX);
    expect(snapshot.session?.commandQueueOverload).toBeGreaterThan(0);
    expect(snapshot.session?.lastInputSeq).toBe(COMMAND_QUEUE_MAX + 20);
    const epoch = player.movementEpoch;
    const highWater = player.lastInputSeq;
    expect(world.hardRelocatePlayer(player, 24.5, 80, 24.5)).toBe(true);
    expect(player.movementEpoch).toBe(epoch + 1);
    expect(player.commandQueue.length).toBe(0);
    expect(player.lastInputSeq).toBe(highWater);
    expect(player.pendingAttacks).toHaveLength(0);
    expect(player.pendingBowReleases).toHaveLength(0);
    expect(world.applyInput(player, input(highWater, { movementEpoch: player.movementEpoch }))).toBe(false);
    expect(world.applyInput(player, input(highWater + 1, { forward: 1, movementEpoch: player.movementEpoch }))).toBe(true);
    expect(player.commandQueue.isQueued(highWater + 1)).toBe(true);
    expect(player.lastInputSeq).toBe(highWater + 1);
    const flushed = player.snapshot() as PlayerSnapshot;
    expect(flushed.movementEpoch).toBe(epoch + 1);
  });
});
