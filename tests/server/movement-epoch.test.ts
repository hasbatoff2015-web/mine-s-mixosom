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
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import type { AttackAction, BowReleaseAction, EntityUseAction } from '../../shared/playerActions';
import type { ClientInputMessage, ServerActionResultMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-epoch-'));
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

function input(seq: number, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return {
    type: 'input', seq, clientTick: seq, forward: 0, right: 0, jump: false,
    sneak: false, sprint: false, descend: false, flySprint: false,
    yaw: 0, pitch: 0, selectedSlot: 0, movementEpoch: extra.movementEpoch,
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

function attack(
  actionSeq: number,
  commandSeq: number,
  look: { yaw: number; pitch: number },
  target: ServerPlayer,
  targetRenderTick: number,
  selectedSlot = 0,
): AttackAction {
  return {
    kind: 'attack', actionSeq, commandSeq, selectedSlot,
    yaw: look.yaw, pitch: look.pitch, targetId: target.id, targetRenderTick,
  };
}

function result(sink: MemorySink, actionSeq: number): ServerActionResultMessage {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const candidate = sink.payloads[index] as Partial<ServerActionResultMessage>;
    if (candidate.type === 'action_result' && candidate.actionSeq === actionSeq) {
      return candidate as ServerActionResultMessage;
    }
  }
  throw new Error(`missing action_result ${actionSeq}`);
}

describe('movement epoch rebase', { timeout: 30_000 }, () => {
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
    const attackerSink = new MemorySink();
    const victimSink = new MemorySink();
    const a = world.join({ sink: attackerSink, name: 'Attacker' });
    const b = world.join({ sink: victimSink, name: 'Victim' });
    if ('error' in a || 'error' in b) throw new Error('join failed');
    world.setGameMode(a.player, 'survival');
    world.setGameMode(b.player, 'survival');
    a.player.controller.teleport([20.5, 100, 20.5]);
    b.player.controller.teleport([20.5, 100, 22.5]);
    world.world.setBlock(20, 99, 20, BlockId.Stone);
    world.world.setBlock(20, 99, 22, BlockId.Stone);
    world.world.setBlock(80, 99, 80, BlockId.Stone);
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    expect(a.player.movementEpoch).toBe(0);
    return { world, attacker: a.player, victim: b.player, attackerSink, victimSink };
  }

  it('discards pre-teleport movement, including a held jump, at the destination', async () => {
    const { world, attacker } = await boot();
    for (let seq = 1; seq <= 12; seq += 1) {
      world.applyInput(attacker, input(seq, { forward: 1, jump: true, movementEpoch: 0 }));
    }
    expect(attacker.commandQueue.length).toBeLessThanOrEqual(4);
    const seq = attacker.lastInputSeq;
    const epoch = attacker.movementEpoch;
    expect(world.hardRelocatePlayer(attacker, 80.5, 100, 80.5)).toBe(true);
    expect(attacker.movementEpoch).toBe(epoch + 1);
    expect(attacker.lastInputSeq).toBe(seq);
    expect(attacker.commandQueue.length).toBe(0);
    expect(attacker.commandQueue.find(seq)?.jump).toBe(false);
    expect(attacker.commandQueue.find(seq)?.forward).toBe(0);
    expect(attacker.combatPoseHistory).toHaveLength(0);
    for (let tick = 0; tick < 5; tick += 1) world.tick();
    expect(attacker.controller.position.x).toBeCloseTo(80.5, 2);
    expect(attacker.controller.position.z).toBeCloseTo(80.5, 2);
    expect(attacker.controller.position.y).toBeLessThan(100.4);
    expect(attacker.controller.position.y).toBeGreaterThan(99);
  });

  it('cancels a pre-teleport attack and lets the next post-teleport attack hit', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    const look = lookAt(attacker, victim);
    world.applyInput(attacker, input(1, { ...look, movementEpoch: 0 }));
    world.applyInput(victim, input(1, { movementEpoch: 0 }));
    world.tick();
    world.applyInput(attacker, input(2, { ...look, movementEpoch: 0 }));
    attackerSink.payloads.length = 0;
    const before = victim.survival.health;
    world.handleSequencedAttack(attacker, attack(1, 2, look, victim, world.tickNumber));
    expect(attacker.pendingAttacks).toHaveLength(1);
    expect(world.hardRelocatePlayer(attacker, 80.5, 100, 80.5)).toBe(true);
    expect(attacker.pendingAttacks).toHaveLength(0);
    expect(victim.survival.health).toBe(before);
    expect(result(attackerSink, 1)).toMatchObject({ ok: false, reason: 'stale' });

    expect(world.hardRelocatePlayer(attacker, 20.5, 100, 20.5)).toBe(true);
    const nextLook = lookAt(attacker, victim);
    const seq = attacker.lastInputSeq + 1;
    expect(world.applyInput(attacker, input(seq, {
      ...nextLook, movementEpoch: attacker.movementEpoch,
    }))).toBe(true);
    world.applyInput(victim, input(victim.lastInputSeq + 1, { movementEpoch: victim.movementEpoch }));
    world.tick();
    attackerSink.payloads.length = 0;
    world.handleSequencedAttack(attacker, attack(2, seq, nextLook, victim, world.tickNumber));
    expect(victim.survival.health).toBeLessThan(before);
    expect(result(attackerSink, 2).combat?.result).toBe('hit');
  });

  it('ignores an old-epoch packet and accepts a later seq on the new epoch', async () => {
    const { world, attacker } = await boot();
    expect(world.applyInput(attacker, input(1, { movementEpoch: 0, forward: 1 }))).toBe(true);
    world.tick();
    expect(world.hardRelocatePlayer(attacker, 80.5, 100, 80.5)).toBe(true);
    const epoch = attacker.movementEpoch;
    const parked = attacker.controller.position.clone();
    const staleSeq = attacker.lastInputSeq + 1;
    expect(world.applyInput(attacker, input(staleSeq, {
      movementEpoch: 0, forward: 1, jump: true,
    }))).toBe(false);
    expect(attacker.lastInputSeq).toBe(staleSeq);
    expect(attacker.commandQueue.find(staleSeq)?.forward ?? 0).toBe(0);
    world.tick();
    expect(attacker.controller.position.x).toBeCloseTo(parked.x, 2);
    expect(attacker.controller.position.z).toBeCloseTo(parked.z, 2);
    const liveSeq = staleSeq + 1;
    expect(world.applyInput(attacker, input(liveSeq, { movementEpoch: epoch }))).toBe(true);
    expect(attacker.lastInputSeq).toBe(liveSeq);
    expect(attacker.movementEpoch).toBe(epoch);
  });

  it('rejects rewind onto a victim pose from before their teleport', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    const look = lookAt(attacker, victim);
    world.applyInput(attacker, input(1, { ...look, movementEpoch: 0 }));
    world.applyInput(victim, input(1, { movementEpoch: 0 }));
    world.tick();
    const historicalTick = world.tickNumber;
    expect(victim.combatPoseHistory.length).toBeGreaterThan(0);
    expect(world.hardRelocatePlayer(victim, 80.5, 100, 80.5)).toBe(true);
    expect(victim.combatPoseHistory).toHaveLength(0);
    expect(victim.movementEpoch).toBe(1);
    attackerSink.payloads.length = 0;
    const before = victim.survival.health;
    world.handleSequencedAttack(attacker, attack(1, 1, look, victim, historicalTick));
    expect(victim.survival.health).toBe(before);
    expect(result(attackerSink, 1).combat?.result).toBe('stale');
    world.tick();
    expect(victim.combatPoseHistory.every((pose) => pose.movementEpoch === victim.movementEpoch)).toBe(true);
  });

  it('bumps the epoch on respawn without rewinding command seq', async () => {
    const { world, attacker } = await boot();
    world.applyInput(attacker, input(4, { movementEpoch: 0, forward: 1, jump: true }));
    const seq = attacker.lastInputSeq;
    attacker.survival.restore({ health: 0, dead: true });
    expect(world.respawn(attacker)).toBe(true);
    expect(attacker.movementEpoch).toBe(1);
    expect(attacker.lastInputSeq).toBe(seq);
    expect(attacker.commandQueue.length).toBe(0);
    expect(attacker.commandQueue.find(seq)?.jump).toBe(false);
    expect(attacker.survival.dead).toBe(false);
  });

  it('does not treat a plain controller teleport as an epoch change', async () => {
    const { attacker } = await boot();
    attacker.controller.teleport([21.5, 100, 20.5]);
    expect(attacker.movementEpoch).toBe(0);
  });
});

describe('bow and entity-use across a teleport', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function bootArcher() {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir));
    worlds.push(world);
    await world.initialize();
    const sink = new MemorySink();
    const joined = world.join({ sink, name: 'Archer' });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, 'survival');
    joined.player.inventory.clear();
    joined.player.inventory.setSlot(0, createItemStack(ItemId.Bow));
    joined.player.inventory.setSlot(1, createItemStack(ItemId.Arrow, 64));
    joined.player.controller.teleport([8.5, 80, 8.5]);
    world.world.setBlock(8, 79, 8, BlockId.Stone);
    world.world.setBlock(40, 79, 40, BlockId.Stone);
    world.applyInput(joined.player, input(1, { use: true, movementEpoch: 0 }));
    expect(world.interact(joined.player, undefined, 1, 1, 0)).toEqual({ ok: true });
    world.tick();
    joined.player.bowUseTicks = 20;
    sink.payloads.length = 0;
    return { world, player: joined.player, sink };
  }

  it('does not fire a pre-teleport bow release at the destination', async () => {
    const { world, player, sink } = await bootArcher();
    world.applyInput(player, input(2, { use: false, movementEpoch: 0 }));
    const release: BowReleaseAction = {
      kind: 'bow_release', actionSeq: 2, commandSeq: 2, selectedSlot: 0, yaw: 0.2, pitch: 0,
    };
    world.handleSequencedBowRelease(player, release);
    expect(player.pendingBowReleases).toHaveLength(1);
    expect(world.gameplay.arrows.count).toBe(0);
    expect(world.hardRelocatePlayer(player, 40.5, 80, 40.5)).toBe(true);
    expect(player.pendingBowReleases).toHaveLength(0);
    expect(player.bowUseTicks).toBe(0);
    expect(world.gameplay.arrows.count).toBe(0);
    expect(result(sink, 2)).toMatchObject({ ok: false, reason: 'stale' });
    for (let tick = 0; tick < 3; tick += 1) world.tick();
    expect(world.gameplay.arrows.count).toBe(0);
    expect(player.controller.position.x).toBeCloseTo(40.5, 2);

    const epoch = player.movementEpoch;
    const drawSeq = player.lastInputSeq + 1;
    expect(world.applyInput(player, input(drawSeq, { use: true, movementEpoch: epoch }))).toBe(true);
    expect(world.interact(player, undefined, 3, drawSeq, 0)).toEqual({ ok: true });
    world.tick();
    player.bowUseTicks = 20;
    const releaseSeq = drawSeq + 1;
    world.applyInput(player, input(releaseSeq, { use: false, movementEpoch: epoch }));
    world.tick();
    sink.payloads.length = 0;
    world.handleSequencedBowRelease(player, {
      kind: 'bow_release', actionSeq: 4, commandSeq: releaseSeq, selectedSlot: 0, yaw: 0.2, pitch: 0,
    });
    expect(world.gameplay.arrows.count).toBe(1);
    expect(result(sink, 4).ok).toBe(true);
  });

  it('protects a pending bow boundary and a pending entity-use boundary from compaction', async () => {
    const { world, player } = await bootArcher();
    world.applyInput(player, input(2, { use: false, movementEpoch: 0 }));
    world.handleSequencedBowRelease(player, {
      kind: 'bow_release', actionSeq: 2, commandSeq: 2, selectedSlot: 0, yaw: 0, pitch: 0,
    });
    expect(player.pendingBowReleases).toHaveLength(1);
    for (let seq = 3; seq <= 18; seq += 1) {
      world.applyInput(player, input(seq, { use: false, forward: 1, movementEpoch: 0 }));
    }
    expect(player.commandQueue.find(2)?.commandSeq).toBe(2);
    for (const range of player.commandQueue.skippedRanges) {
      expect(2 < range.fromCommandSeq || 2 > range.toCommandSeq).toBe(true);
    }

    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(8.5, 80, 11), { force: true });
    expect(wolf).toBeDefined();
    const petSeq = player.lastInputSeq + 1;
    world.applyInput(player, input(petSeq, { movementEpoch: player.movementEpoch }));
    const use: EntityUseAction = {
      kind: 'entity_use', actionSeq: 5, commandSeq: petSeq, selectedSlot: 0, targetId: wolf!.id,
    };
    expect(world.handleSequencedEntityUse(player, use)).toBeUndefined();
    expect(player.pendingEntityUses).toHaveLength(1);
    for (let seq = petSeq + 1; seq <= petSeq + 12; seq += 1) {
      world.applyInput(player, input(seq, { forward: 1, movementEpoch: player.movementEpoch }));
    }
    expect(player.commandQueue.find(petSeq)?.commandSeq).toBe(petSeq);
    for (const range of player.commandQueue.skippedRanges) {
      expect(petSeq < range.fromCommandSeq || petSeq > range.toCommandSeq).toBe(true);
    }
  });
});
