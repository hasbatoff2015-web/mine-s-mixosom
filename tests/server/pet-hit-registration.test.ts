import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ItemId } from '../../src/items';
import { createItemStack } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import type { EntityUseAction } from '../../shared/playerActions';
import type { ClientInputMessage, ServerActionResultMessage } from '../../shared/protocol';
import { MAX_MOB_REWIND_TICKS } from '../../src/entities';
import type { MobKind } from '../../src/entities/mobDefinitions';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-pet-hit-'));
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

function input(seq: number, yaw = 0, pitch = 0, selectedSlot = 0): ClientInputMessage {
  return {
    type: 'input', seq, clientTick: seq, forward: 0, right: 0, jump: false,
    sneak: false, sprint: false, descend: false, flySprint: false,
    yaw, pitch, selectedSlot,
  };
}

function lookAt(player: ServerPlayer, target: { x: number; y: number; z: number }) {
  const origin = player.controller.eyePosition();
  const direction = new Vec3(target.x - origin.x, target.y - origin.y, target.z - origin.z).normalize();
  return {
    yaw: Math.atan2(-direction.x, -direction.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, direction.y))),
  };
}

function actionResult(sink: MemorySink, actionSeq: number): ServerActionResultMessage {
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const candidate = sink.payloads[index] as Partial<ServerActionResultMessage>;
    if (candidate.type === 'action_result' && candidate.actionSeq === actionSeq) {
      return candidate as ServerActionResultMessage;
    }
  }
  throw new Error(`missing action_result ${actionSeq}`);
}

describe('pet hit registration timing', { timeout: 30_000 }, () => {
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
    const aSink = new MemorySink();
    const joined = world.join({ sink: aSink, name: 'Owner' });
    if ('error' in joined) throw new Error('join failed');
    joined.player.controller.teleport([20.5, 100, 20.5]);
    world.world.setBlock(20, 99, 20, BlockId.Stone);
    world.world.setBlock(20, 99, 22, BlockId.Stone);
    world.world.setBlock(22, 99, 20, BlockId.Stone);
    return { world, owner: joined.player, aSink };
  }

  function useAction(
    actionSeq: number,
    commandSeq: number,
    targetId: string,
    look: { yaw: number; pitch: number },
    selectedSlot = 0,
    targetRenderTick?: number,
  ): EntityUseAction {
    return {
      kind: 'entity_use',
      actionSeq,
      commandSeq,
      selectedSlot,
      targetId,
      yaw: look.yaw,
      pitch: look.pitch,
      ...(targetRenderTick !== undefined ? { targetRenderTick } : {}),
    };
  }

  function applyAway(world: WorldInstance, player: ServerPlayer, seq: number, slot = 0) {
    player.controller.yaw = 0;
    player.controller.pitch = 0;
    world.applyInput(player, input(seq, 0, 0, slot));
    world.tick();
  }

  it('registers LMB from click aim when command-boundary look points away', async () => {
    const { world, owner, aSink } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    const before = wolf.health;
    const renderTick = world.tickNumber;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch,
      targetId: wolf.id, targetRenderTick: renderTick,
    });
    expect(wolf.health).toBeLessThan(before);
    expect(actionResult(aSink, 1).combat?.result).toBe('hit');
  });

  it('misses LMB when click aim points away even if command-boundary look hits', async () => {
    const { world, owner, aSink } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    owner.controller.yaw = look.yaw;
    owner.controller.pitch = look.pitch;
    world.applyInput(owner, input(1, look.yaw, look.pitch, 0));
    world.tick();
    const before = wolf.health;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
      yaw: 0, pitch: 0,
      targetId: wolf.id, targetRenderTick: world.tickNumber,
    });
    expect(wolf.health).toBe(before);
    expect(actionResult(aSink, 1).combat?.result).toBe('miss');
  });

  it('tames 1/3 from click aim when command-boundary look points away', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 1, wolf.id, look, 0, world.tickNumber),
    )).toEqual({ ok: true });
    expect(wolf.tameProgress).toBe(1);
    expect(owner.inventory.getSlot(0)?.count).toBe(3);
  });

  it('keeps a receive-time frozen entity_use valid after several command-wait ticks', async () => {
    const { world, owner, aSink } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    const renderTick = world.tickNumber;
    for (let seq = 2; seq <= 8; seq += 1) {
      world.applyInput(owner, input(seq, 0, 0, 0));
    }
    expect(owner.pendingEntityUses).toHaveLength(0);
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 8, wolf.id, look, 0, renderTick),
    )).toBeUndefined();
    expect(owner.pendingEntityUses).toHaveLength(1);
    for (let step = 0; step < 6; step += 1) {
      wolf.position.x += 0.15;
      wolf.previousPosition.copy(wolf.position);
      world.tick();
      expect(wolf.tameProgress).toBe(0);
      expect(owner.pendingEntityUses.length).toBeGreaterThan(0);
    }
    world.tick();
    expect(wolf.tameProgress).toBe(1);
    expect(owner.inventory.getSlot(0)?.count).toBe(3);
    const result = actionResult(aSink, 1);
    expect(result.ok).toBe(true);
    expect(result.entityUse?.result).toBe('accepted');
    expect(result.entityUse?.receivedServerTick).toBe(renderTick);
    expect(result.entityUse?.resolvedRenderTick).toBe(renderTick);
    expect((result.entityUse?.pendingTicks ?? 0)).toBeGreaterThanOrEqual(6);
  });

  it('rejects entity_use that is already stale or future at packet receive', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    for (let seq = 2; seq <= 8; seq += 1) world.applyInput(owner, input(seq, 0, 0, 0));
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 8, wolf.id, look, 0, world.tickNumber - MAX_MOB_REWIND_TICKS - 1),
    )).toEqual({ ok: false, reason: 'stale' });
    expect(owner.pendingEntityUses).toHaveLength(0);
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(2, 8, wolf.id, look, 0, world.tickNumber + 4),
    )).toEqual({ ok: false, reason: 'stale' });
    expect(owner.pendingEntityUses).toHaveLength(0);
    expect(wolf.tameProgress).toBe(0);
  });

  it('rejects a pending entity_use if the target dies before resolution', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    const renderTick = world.tickNumber;
    for (let seq = 2; seq <= 4; seq += 1) world.applyInput(owner, input(seq, 0, 0, 0));
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 4, wolf.id, look, 0, renderTick),
    )).toBeUndefined();
    wolf.health = 0;
    wolf.state = 'die';
    world.tick();
    world.tick();
    world.tick();
    expect(wolf.tameProgress).toBe(0);
    expect(owner.inventory.getSlot(0)?.count).toBe(4);
  });

  it('rejects a pending entity_use when the command-boundary slot does not match', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    owner.inventory.setSlot(1, createItemStack(ItemId.Stick, 1));
    applyAway(world, owner, 1, 0);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    const renderTick = world.tickNumber;
    for (let seq = 2; seq <= 4; seq += 1) world.applyInput(owner, input(seq, 0, 0, 1));
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 4, wolf.id, look, 0, renderTick),
    )).toBeUndefined();
    world.tick();
    world.tick();
    world.tick();
    expect(wolf.tameProgress).toBe(0);
    expect(owner.inventory.getSlot(0)?.count).toBe(4);
  });

  it('rejects a pending entity_use when current-world LOS becomes blocked', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    const renderTick = world.tickNumber;
    for (let seq = 2; seq <= 4; seq += 1) world.applyInput(owner, input(seq, 0, 0, 0));
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 4, wolf.id, look, 0, renderTick),
    )).toBeUndefined();
    world.world.setBlock(20, 101, 21, BlockId.Stone);
    world.tick();
    world.tick();
    world.tick();
    expect(wolf.tameProgress).toBe(0);
    expect(owner.inventory.getSlot(0)?.count).toBe(4);
  });

  it('accepts mob rewind at MAX ticks and rejects MAX+1 and future', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 8));
    applyAway(world, owner, 1);
    const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    const renderTick = world.tickNumber;
    for (let i = 0; i < MAX_MOB_REWIND_TICKS; i += 1) world.tick();
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(1, 1, wolf.id, look, 0, renderTick),
    )).toEqual({ ok: true });
    expect(wolf.tameProgress).toBe(1);
    world.tick();
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(2, 1, wolf.id, look, 0, renderTick),
    )).toEqual({ ok: false, reason: 'stale' });
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(3, 1, wolf.id, look, 0, world.tickNumber + 2),
    )).toEqual({ ok: false, reason: 'stale' });
  });

  it('tames a moving wolf with three click-aim Bone feeds', async () => {
    const { world, owner } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 5));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      wolf.position.x = 20.5 + attempt * 0.12;
      wolf.previousPosition.copy(wolf.position);
      applyAway(world, owner, attempt);
      const look = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
      expect(world.handleSequencedEntityUse(
        owner,
        useAction(attempt, attempt, wolf.id, look, 0, world.tickNumber),
      )?.ok).toBe(true);
    }
    expect(wolf.ownerId).toBe(owner.id);
    expect(wolf.sitting).toBe(true);
    expect(owner.inventory.getSlot(0)?.count).toBe(2);
  });

  it('tames a moving cat with mixed meats using click aim', async () => {
    const { world, owner } = await boot();
    const cat = world.gameplay.mobs.spawn('cat', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Beef, 2));
    owner.inventory.setSlot(1, createItemStack(ItemId.CookedPorkchop, 2));
    owner.inventory.setSlot(2, createItemStack(ItemId.Chicken, 2));
    const meats = [0, 1, 2] as const;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const slot = meats[attempt - 1]!;
      owner.selectedSlot = slot;
      cat.position.z = 22.2 + attempt * 0.08;
      cat.previousPosition.copy(cat.position);
      applyAway(world, owner, attempt, slot);
      const look = lookAt(owner, { x: cat.position.x, y: cat.position.y + 0.35, z: cat.position.z });
      expect(world.handleSequencedEntityUse(
        owner,
        useAction(attempt, attempt, cat.id, look, slot, world.tickNumber),
      )?.ok).toBe(true);
    }
    expect(cat.ownerId).toBe(owner.id);
    expect(owner.inventory.getSlot(0)?.count).toBe(1);
    expect(owner.inventory.getSlot(1)?.count).toBe(1);
    expect(owner.inventory.getSlot(2)?.count).toBe(1);
  });

  it('registers LMB against every moving passive kind with click-time aim', async () => {
    const { world, owner, aSink } = await boot();
    const kinds: readonly MobKind[] = ['cow', 'pig', 'chicken', 'sheep', 'wolf', 'cat'];
    owner.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    applyAway(world, owner, 1);
    let actionSeq = 1;
    for (const kind of kinds) {
      const mob = world.gameplay.mobs.spawn(kind, new Vec3(20.5, 100, 22.15), { force: true })!;
      mob.position.x += 0.08;
      mob.previousPosition.copy(mob.position);
      world.tick();
      const look = lookAt(owner, {
        x: mob.position.x,
        y: mob.position.y + Math.min(0.5, mob.definition.height * 0.6),
        z: mob.position.z,
      });
      const before = mob.health;
      aSink.payloads.length = 0;
      world.handleSequencedAttack(owner, {
        kind: 'attack',
        actionSeq,
        commandSeq: 1,
        selectedSlot: 0,
        yaw: look.yaw,
        pitch: look.pitch,
        targetId: mob.id,
        targetRenderTick: world.tickNumber,
      });
      expect(mob.health, kind).toBeLessThan(before);
      expect(actionResult(aSink, actionSeq).combat?.result, kind).toBe('hit');
      actionSeq += 1;
    }
  });

  it('still rejects occluded and over-reach pet hits', async () => {
    const { world, owner, aSink } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 28.5), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    applyAway(world, owner, 1);
    const farLook = lookAt(owner, { x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z });
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
      yaw: farLook.yaw, pitch: farLook.pitch,
      targetId: wolf.id, targetRenderTick: world.tickNumber,
    });
    expect(actionResult(aSink, 1).combat?.result).toBe('out_of_reach');
    const cat = world.gameplay.mobs.spawn('cat', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 2));
    world.tick();
    const blocked = lookAt(owner, { x: cat.position.x, y: cat.position.y + 0.3, z: cat.position.z });
    world.world.setBlock(20, 101, 21, BlockId.Stone);
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(2, 1, cat.id, blocked, 0, world.tickNumber),
    )).toEqual({ ok: false, reason: 'los' });
  });
});
