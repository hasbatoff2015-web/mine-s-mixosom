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
import { parseClientMessage, type ClientInputMessage, type ServerActionResultMessage } from '../../shared/protocol';
import { MAX_MOB_REWIND_TICKS } from '../../src/entities';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-pets-anarchy-'));
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

describe('anarchy pet entity_use', { timeout: 30_000 }, () => {
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
    const bSink = new MemorySink();
    const a = world.join({ sink: aSink, name: 'Owner' });
    const b = world.join({ sink: bSink, name: 'Guest' });
    if ('error' in a || 'error' in b) throw new Error('join failed');
    a.player.controller.teleport([20.5, 100, 20.5]);
    b.player.controller.teleport([24.5, 100, 20.5]);
    world.world.setBlock(20, 99, 20, BlockId.Stone);
    world.world.setBlock(20, 99, 22, BlockId.Stone);
    world.world.setBlock(24, 99, 20, BlockId.Stone);
    return { world, owner: a.player, guest: b.player, aSink, bSink };
  }

  function prepareLook(world: WorldInstance, player: ServerPlayer, target: { x: number; y: number; z: number }, seq = 1) {
    const look = lookAt(player, target);
    player.controller.yaw = look.yaw;
    player.controller.pitch = look.pitch;
    world.applyInput(player, input(seq, look.yaw, look.pitch, player.selectedSlot));
    world.tick();
    return look;
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

  it('parses entity_use and rejects a missing targetId', () => {
    expect(parseClientMessage({
      type: 'action', kind: 'entity_use', actionSeq: 1, commandSeq: 1, selectedSlot: 0, targetId: 'mob-1',
    })).toMatchObject({ type: 'action', kind: 'entity_use', targetId: 'mob-1' });
    expect(parseClientMessage({
      type: 'action', kind: 'entity_use', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
    })).toMatchObject({ error: 'action.targetId invalid' });
  });

  it('tames on the server after three bones, sits, and shows the snapshot to another player', async () => {
    const { world, owner, guest, aSink } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.5), { force: true })!;
    owner.inventory.clear();
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 16));
    owner.selectedSlot = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const look = prepareLook(world, owner, {
        x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z,
      }, attempt);
      const result = world.handleSequencedEntityUse(owner, useAction(attempt, attempt, wolf.id, look));
      expect(result?.ok).toBe(true);
    }
    expect(wolf.ownerId).toBe(owner.id);
    expect(wolf.sitting).toBe(true);
    expect(wolf.tameProgress).toBe(0);
    expect(owner.inventory.getSlot(0)?.count).toBe(13);
    const chat = aSink.payloads.filter((payload) => (
      typeof payload === 'object' && payload !== null && (payload as { type?: string }).type === 'chat'
    )).map((payload) => (payload as { text?: string }).text);
    expect(chat).toContain('Волк: приручение 1/3');
    expect(chat).toContain('Волк: приручение 2/3');
    expect(chat).toContain('Волк приручён.');
    const snapshots = world.gameplay.snapshotsNear(guest.controller.position);
    const view = snapshots.find((entry) => entry.id === wolf.id);
    expect(view).toMatchObject({ ownerId: owner.id, sitting: true, mobKind: 'wolf' });
  });

  it('lets only the owner toggle sit and rejects a guest', async () => {
    const { world, owner, guest } = await boot();
    const cat = world.gameplay.mobs.spawn('cat', new Vec3(20.5, 100, 22.2), {
      force: true, ownerId: owner.id, sitting: true, catVariant: 'black',
    })!;
    const ownerLook = prepareLook(world, owner, { x: cat.position.x, y: cat.position.y + 0.3, z: cat.position.z }, 1);
    expect(world.handleSequencedEntityUse(owner, useAction(1, 1, cat.id, ownerLook))).toEqual({ ok: true });
    expect(cat.sitting).toBe(false);
    guest.controller.teleport([21.5, 100, 22.5]);
    const guestLook = prepareLook(world, guest, { x: cat.position.x, y: cat.position.y + 0.3, z: cat.position.z }, 1);
    expect(world.handleSequencedEntityUse(guest, useAction(1, 1, cat.id, guestLook))).toEqual({
      ok: false, reason: 'not_owner',
    });
    expect(cat.sitting).toBe(false);
  });

  it('rejects distant, occluded, stale, duplicate and wrong-slot entity_use', async () => {
    const { world, owner } = await boot();
    const near = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    const far = world.gameplay.mobs.spawn('wolf', new Vec3(120.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    owner.inventory.setSlot(1, createItemStack(ItemId.Bone, 4));
    const look = prepareLook(world, owner, { x: near.position.x, y: near.position.y + 0.4, z: near.position.z }, 1);
    expect(world.handleSequencedEntityUse(owner, useAction(1, 1, far.id, look))).toEqual({
      ok: false, reason: 'reach',
    });
    world.world.setBlock(20, 101, 21, BlockId.Stone);
    const blocked = prepareLook(world, owner, { x: near.position.x, y: near.position.y + 0.4, z: near.position.z }, 2);
    expect(world.handleSequencedEntityUse(owner, useAction(2, 2, near.id, blocked))).toEqual({
      ok: false, reason: 'los',
    });
    world.world.setBlock(20, 101, 21, BlockId.Air);
    const open = prepareLook(world, owner, { x: near.position.x, y: near.position.y + 0.4, z: near.position.z }, 3);
    expect(world.handleSequencedEntityUse(owner, useAction(3, 2, near.id, open, 1))).toEqual({
      ok: false, reason: 'slot',
    });
    expect(world.handleSequencedEntityUse(owner, useAction(4, 99, near.id, open))).toEqual({
      ok: false, reason: 'stale',
    });
    const first = world.handleSequencedEntityUse(owner, useAction(5, 3, near.id, open));
    expect(first).toBeDefined();
    const firstOk = first !== undefined && (first.ok || (!first.ok && (
      first.reason === 'reach' || first.reason === 'invalid'
    )));
    expect(firstOk).toBe(true);
    expect(world.handleSequencedEntityUse(owner, useAction(5, 3, near.id, open))).toEqual({
      ok: false, reason: 'duplicate',
    });
  });

  it('does not consume a bone when the pet limit is already reached', async () => {
    const { world, owner } = await boot();
    world.gameplay.mobs.spawn('wolf', new Vec3(18.5, 100, 20.5), {
      force: true, ownerId: owner.id, sitting: true,
    });
    world.gameplay.mobs.spawn('cat', new Vec3(19.5, 100, 20.5), {
      force: true, ownerId: owner.id, sitting: true, catVariant: 'red',
    });
    const wild = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 3));
    const look = prepareLook(world, owner, { x: wild.position.x, y: wild.position.y + 0.4, z: wild.position.z }, 1);
    expect(world.handleSequencedEntityUse(owner, useAction(1, 1, wild.id, look))).toEqual({
      ok: false, reason: 'pet_limit',
    });
    expect(owner.inventory.getSlot(0)?.count).toBe(3);
    expect(wild.ownerId).toBeUndefined();
  });

  it('rejects a forged client look that does not match the command-boundary yaw', async () => {
    const { world, owner } = await boot();
    const pet = world.gameplay.mobs.spawn('wolf', new Vec3(22.5, 100, 20.5), { force: true })!;
    world.world.setBlock(22, 99, 20, BlockId.Stone);
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 4));
    const north = prepareLook(world, owner, { x: 20.5, y: 100, z: 18.5 }, 1);
    expect(north.yaw).toBeCloseTo(0, 5);
    const east = lookAt(owner, { x: pet.position.x, y: pet.position.y + 0.4, z: pet.position.z });
    expect(world.handleSequencedEntityUse(owner, useAction(1, 1, pet.id, east))).toEqual({
      ok: false, reason: 'reach',
    });
    expect(pet.ownerId).toBeUndefined();
  });

  it('accepts a moving pet at the rendered tick and rejects stale or future ticks', async () => {
    const { world, owner } = await boot();
    const pet = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), {
      force: true, ownerId: owner.id, sitting: false,
    })!;
    world.world.setBlock(24, 99, 20, BlockId.Stone);
    const look = prepareLook(world, owner, {
      x: pet.position.x, y: pet.position.y + 0.4, z: pet.position.z,
    }, 1);
    const renderTick = world.tickNumber;
    pet.position.set(24.5, 100, 20.5);
    pet.previousPosition.copy(pet.position);
    world.tick();
    expect(world.handleSequencedEntityUse(owner, useAction(1, 1, pet.id, look))).toEqual({
      ok: false, reason: 'reach',
    });
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(2, 1, pet.id, look, 0, renderTick - MAX_MOB_REWIND_TICKS - 1),
    )).toEqual({ ok: false, reason: 'stale' });
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(3, 1, pet.id, look, 0, world.tickNumber + 4),
    )).toEqual({ ok: false, reason: 'stale' });
    expect(world.handleSequencedEntityUse(
      owner,
      useAction(4, 1, pet.id, look, 0, renderTick),
    )).toEqual({ ok: true });
    expect(pet.sitting).toBe(true);
  });

  it('resets tame progress when a second player starts feeding', async () => {
    const { world, owner, guest } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.Bone, 8));
    guest.controller.teleport([21.5, 100, 22.5]);
    world.world.setBlock(21, 99, 22, BlockId.Stone);
    guest.inventory.setSlot(0, createItemStack(ItemId.Bone, 8));
    guest.selectedSlot = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const look = prepareLook(world, owner, {
        x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z,
      }, attempt);
      expect(world.handleSequencedEntityUse(owner, useAction(attempt, attempt, wolf.id, look))?.ok).toBe(true);
    }
    expect(wolf.tameProgress).toBe(2);
    expect(wolf.tameProgressPlayerId).toBe(owner.id);
    const guestLook = prepareLook(world, guest, {
      x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z,
    }, 1);
    expect(world.handleSequencedEntityUse(guest, useAction(1, 1, wolf.id, guestLook))?.ok).toBe(true);
    expect(wolf.ownerId).toBeUndefined();
    expect(wolf.tameProgress).toBe(1);
    expect(wolf.tameProgressPlayerId).toBe(guest.id);
    expect(guest.inventory.getSlot(0)?.count).toBe(7);
  });

  it('hits a moving pet at the rendered pose and rejects stale, future, occluded and over-reach attacks', async () => {
    const { world, owner, aSink } = await boot();
    const wolf = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 22.2), { force: true })!;
    owner.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    const look = prepareLook(world, owner, {
      x: wolf.position.x, y: wolf.position.y + 0.4, z: wolf.position.z,
    }, 1);
    const renderTick = world.tickNumber;
    const before = wolf.health;
    wolf.position.set(40.5, 100, 20.5);
    wolf.previousPosition.copy(wolf.position);
    world.tick();
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 1, commandSeq: 1, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch,
    });
    expect(wolf.health).toBe(before);
    expect(attackResult(aSink, 1).combat?.result).toBe('miss');
    aSink.payloads.length = 0;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 2, commandSeq: 1, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch,
      targetId: wolf.id, targetRenderTick: renderTick,
    });
    expect(wolf.health).toBeLessThan(before);
    expect(attackResult(aSink, 2).combat).toMatchObject({
      result: 'hit', targetId: wolf.id, requestedRenderTick: renderTick, resolvedRenderTick: renderTick,
    });
    expect(wolf.position.x).toBeGreaterThan(39);
    expect(wolf.position.z).toBeCloseTo(20.5, 1);
    aSink.payloads.length = 0;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 3, commandSeq: 1, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch,
      targetId: wolf.id, targetRenderTick: renderTick - MAX_MOB_REWIND_TICKS - 1,
    });
    expect(attackResult(aSink, 3).reason ?? attackResult(aSink, 3).combat?.result).toMatch(/stale/);
    aSink.payloads.length = 0;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 4, commandSeq: 1, selectedSlot: 0,
      yaw: look.yaw, pitch: look.pitch,
      targetId: wolf.id, targetRenderTick: world.tickNumber + 3,
    });
    expect(attackResult(aSink, 4).reason ?? attackResult(aSink, 4).combat?.result).toMatch(/stale/);

    const far = world.gameplay.mobs.spawn('wolf', new Vec3(20.5, 100, 28.5), { force: true })!;
    const farLook = prepareLook(world, owner, {
      x: far.position.x, y: far.position.y + 0.4, z: far.position.z,
    }, 4);
    const farTick = world.tickNumber;
    aSink.payloads.length = 0;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 5, commandSeq: 4, selectedSlot: 0,
      yaw: farLook.yaw, pitch: farLook.pitch,
      targetId: far.id, targetRenderTick: farTick,
    });
    expect(attackResult(aSink, 5).combat?.result).toBe('out_of_reach');

    const cat = world.gameplay.mobs.spawn('cat', new Vec3(20.5, 100, 22.4), { force: true })!;
    const wallLook = prepareLook(world, owner, {
      x: cat.position.x, y: cat.position.y + 0.3, z: cat.position.z,
    }, 6);
    const catTick = world.tickNumber;
    world.world.setBlock(20, 101, 21, BlockId.Stone);
    aSink.payloads.length = 0;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 6, commandSeq: 6, selectedSlot: 0,
      yaw: wallLook.yaw, pitch: wallLook.pitch,
      targetId: cat.id, targetRenderTick: catTick,
    });
    expect(attackResult(aSink, 6).combat?.result).toBe('occluded');
    world.world.setBlock(20, 101, 21, BlockId.Air);
    cat.health = 0;
    cat.state = 'die';
    aSink.payloads.length = 0;
    world.handleSequencedAttack(owner, {
      kind: 'attack', actionSeq: 7, commandSeq: 6, selectedSlot: 0,
      yaw: wallLook.yaw, pitch: wallLook.pitch,
      targetId: cat.id, targetRenderTick: catTick,
    });
    expect(attackResult(aSink, 7).reason ?? attackResult(aSink, 7).combat?.result).toMatch(/stale/);
  });
});

function attackResult(sink: MemorySink, actionSeq: number): ServerActionResultMessage {
  let found: unknown;
  for (let index = sink.payloads.length - 1; index >= 0; index -= 1) {
    const candidate = sink.payloads[index] as Partial<ServerActionResultMessage>;
    if (candidate.type === 'action_result' && candidate.actionSeq === actionSeq) {
      found = candidate;
      break;
    }
  }
  if (!found) throw new Error(`missing action_result ${actionSeq}`);
  return found as ServerActionResultMessage;
}
