import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { PLAYER_NET_REACH } from '../../src/core/constants';
import { createItemStack } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import { blockTargetFromHit } from '../../src/net/actionIntent';
import { viewDirectionFromLook } from '../../src/player/localAim';
import type { ClientInputMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { ItemId } from '../../src/items';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-actions-int-'));
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

function prepareTarget(world: WorldInstance, player: ServerPlayer, offsetX = 0) {
  const eye = player.controller.eyePosition();
  const targetX = Math.floor(eye.x) + offsetX;
  const targetY = Math.floor(eye.y);
  const targetZ = Math.floor(eye.z) - 3;
  for (let x = Math.min(Math.floor(eye.x), targetX) - 1; x <= Math.max(Math.floor(eye.x), targetX) + 1; x += 1) {
    for (let y = targetY - 1; y <= targetY + 1; y += 1) {
      for (let z = targetZ; z <= Math.floor(eye.z); z += 1) world.world.setBlock(x, y, z, BlockId.Air);
    }
  }
  world.world.setBlock(targetX, targetY, targetZ, BlockId.Stone);
  const center = new Vec3(targetX + 0.5, targetY + 0.5, targetZ + 0.5);
  const direction = center.sub(eye).normalize();
  const hit = world.world.raycast(eye, direction, PLAYER_NET_REACH);
  if (!hit) throw new Error('test target was not raycastable');
  return hit;
}

describe('online block intent WorldInstance', { timeout: 20_000 }, () => {
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
    const joined = world.join({ sink: new MemorySink(), name: 'ActionTester' });
    if ('error' in joined) throw new Error(joined.error);
    world.setGameMode(joined.player, 'creative');
    joined.player.controller.teleport([8.5, 70, 8.5]);
    return { world, player: joined.player };
  }

  it('places against captured target A after a yaw flick and never substitutes B', async () => {
    const { world, player } = await boot();
    const hitA = prepareTarget(world, player, 0);
    const targetB = { x: hitA.x + 2, y: hitA.y, z: hitA.z };
    world.world.setBlock(targetB.x, targetB.y, targetB.z, BlockId.Stone);
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    world.applyInput(player, input(1));
    world.tick();
    const intent = blockTargetFromHit(hitA);
    player.controller.yaw = Math.atan2(
      -(targetB.x + 0.5 - player.controller.eyePosition().x),
      -(targetB.z + 1 - player.controller.eyePosition().z),
    );
    expect(world.interact(player, intent, 1, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(hitA.x + hitA.normal.x, hitA.y + hitA.normal.y, hitA.z + hitA.normal.z))
      .toBe(BlockId.Dirt);
    expect(world.world.getBlock(targetB.x, targetB.y, targetB.z + 1)).toBe(BlockId.Air);
  });

  it('rejects stale targetBlockId, invalid face, and duplicate actionSeq', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player);
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    world.applyInput(player, input(1));
    world.tick();
    const base = blockTargetFromHit(hit);
    expect(world.interact(player, { ...base, faceX: 1, faceY: 1, faceZ: 0 }, 1, 1))
      .toEqual({ ok: false, reason: 'face' });
    expect(world.interact(player, { ...base, targetBlockId: BlockId.Dirt }, 2, 1))
      .toEqual({ ok: false, reason: 'stale' });
    expect(world.interact(player, base, 3, 1)).toEqual({ ok: true });
    expect(world.interact(player, base, 3, 1)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('validates action A from commandSeq history after the player has walked away', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player);
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    world.applyInput(player, input(1));
    world.tick();
    const intent = blockTargetFromHit(hit);
    player.controller.teleport([8.5, 70, 24.5]);
    world.applyInput(player, input(2));
    world.tick();
    expect(world.interact(player, intent, 1, 2)).toEqual({ ok: false, reason: 'reach' });
    expect(world.interact(player, intent, 2, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x + hit.normal.x, hit.y + hit.normal.y, hit.z + hit.normal.z))
      .toBe(BlockId.Dirt);
  });

  it('keeps survival break start/finish locked to the captured target', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    const hit = prepareTarget(world, player);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    const intent = blockTargetFromHit(hit);
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    player.controller.yaw += Math.PI / 2;
    expect(world.tryBreak(player, hit.x + 1, hit.y, hit.z, {
      ...intent,
      targetX: hit.x + 1,
    }, 1)).toEqual({ ok: false, reason: 'mining' });
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('lets creative break a different cell without the survival mining lock', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player);
    const other = { x: hit.x + 2, y: hit.y, z: hit.z };
    world.world.setBlock(other.x, other.y, other.z, BlockId.Dirt);
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    const intent = blockTargetFromHit(hit);
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    expect(world.tryBreak(player, other.x, other.y, other.z)).toEqual({ ok: true });
    expect(world.world.getBlock(other.x, other.y, other.z)).toBe(BlockId.Air);
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Stone);
  });

  it('accepts a survival finish while server mining is still below 0.95', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    const hit = prepareTarget(world, player);
    world.world.setBlock(hit.x, hit.y, hit.z, BlockId.Dirt);
    const dirtHit = { ...hit, block: BlockId.Dirt };
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    const intent = blockTargetFromHit(dirtHit);
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    expect(player.miningProgress).toBe(0);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 1)).toEqual({ ok: false, reason: 'in_progress' });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(player.miningProgress).toBeGreaterThan(0);
    expect(player.miningProgress).toBeLessThan(0.95);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('accepts a locked finish after look drifted to a later commandSeq', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    const hit = prepareTarget(world, player);
    world.world.setBlock(hit.x, hit.y, hit.z, BlockId.Dirt);
    const intent = blockTargetFromHit({ ...hit, block: BlockId.Dirt });
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    player.controller.yaw += Math.PI / 2;
    world.applyInput(player, input(3, { mining: true, yaw: player.controller.yaw }));
    world.tick();
    expect(player.miningProgress).toBeGreaterThan(0);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 3)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('lets Survival and Creative break the same cell after a failed finish without reconnect', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player);
    world.world.setBlock(hit.x, hit.y, hit.z, BlockId.Dirt);
    const intent = blockTargetFromHit({ ...hit, block: BlockId.Dirt });
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    const before = world.world.getBlock(hit.x, hit.y, hit.z);
    expect(before).toBe(BlockId.Dirt);

    world.setGameMode(player, 'survival');
    const staleFinish = world.tryBreak(player, hit.x, hit.y, hit.z, {
      ...intent,
      targetBlockId: BlockId.Stone,
    }, 1);
    expect(staleFinish).toEqual({ ok: false, reason: 'stale' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Dirt);
    expect(player.miningTarget).toMatchObject({ x: hit.x, y: hit.y, z: hit.z });

    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 2)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);

    world.world.setBlock(hit.x, hit.y, hit.z, BlockId.Dirt);
    world.setGameMode(player, 'creative');
    world.applyInput(player, input(3, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 3, 3)).toEqual({ ok: true });
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, {
      ...intent,
      targetBlockId: BlockId.Stone,
    }, 3)).toEqual({ ok: false, reason: 'stale' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Dirt);
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 4)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('wipes unfinished mining when the client stops holding before finish', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    const hit = prepareTarget(world, player);
    world.world.setBlock(hit.x, hit.y, hit.z, BlockId.Dirt);
    const intent = blockTargetFromHit({ ...hit, block: BlockId.Dirt });
    world.applyInput(player, input(1, { mining: true }));
    world.tick();
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    world.applyInput(player, input(2, { mining: true }));
    world.tick();
    expect(player.miningProgress).toBeGreaterThan(0);
    world.applyInput(player, input(3, { mining: false }));
    world.tick();
    expect(player.miningTarget).toBeUndefined();
    expect(world.tryBreak(player, hit.x, hit.y, hit.z, intent, 1)).toEqual({ ok: false, reason: 'mining' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Dirt);
  });

  it('lets a distant player break the same cell an intersecting player cannot steal', async () => {
    const { world, player: ada } = await boot();
    const bobJoin = world.join({ sink: new MemorySink(), name: 'Bob' });
    if ('error' in bobJoin) throw new Error(bobJoin.error);
    const bob = bobJoin.player;
    world.setGameMode(bob, 'creative');
    ada.controller.teleport([12.5, 70.2, 12.5]);
    bob.controller.teleport([12.5, 70.2, 9.5]);
    world.applyInput(ada, input(1));
    world.applyInput(bob, input(1));
    world.tick();
    const eye = ada.controller.eyePosition();
    const x = Math.floor(eye.x);
    const y = Math.floor(eye.y);
    const z = Math.floor(eye.z);
    carveAir(world, x - 1, y - 1, z - 4, x + 1, y + 1, z + 1);
    world.world.setBlock(x, y, z, BlockId.Dirt);
    const adaIntent = blockTargetFromHit({
      x, y, z, block: BlockId.Dirt,
      normal: new Vec3(0, 0, 1),
      point: new Vec3(x + 0.5, y + 0.5, z + 1),
      distance: 0.2,
    });
    expect(world.beginMining(ada, adaIntent, 1, 1).ok).toBe(true);
    const bobEye = bob.controller.eyePosition();
    const bobHit = world.world.raycast(
      bobEye,
      new Vec3(x + 0.5 - bobEye.x, y + 0.5 - bobEye.y, z + 0.5 - bobEye.z).normalize(),
      PLAYER_NET_REACH,
    );
    if (!bobHit) throw new Error('bob could not see the dirt');
    const bobIntent = blockTargetFromHit(bobHit);
    expect(world.beginMining(bob, bobIntent, 1, 1)).toEqual({ ok: true });
    expect(world.tryBreak(bob, x, y, z, bobIntent, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
  });

  it('lets the intersecting player break that cell without reconnect', async () => {
    const { world, player } = await boot();
    player.controller.teleport([12.5, 70.2, 12.5]);
    world.applyInput(player, input(1));
    world.tick();
    const eye = player.controller.eyePosition();
    const x = Math.floor(eye.x);
    const y = Math.floor(eye.y);
    const z = Math.floor(eye.z);
    carveAir(world, x - 1, y - 1, z - 1, x + 1, y + 1, z + 1);
    world.world.setBlock(x, y, z, BlockId.Dirt);
    const intent = blockTargetFromHit({
      x, y, z, block: BlockId.Dirt,
      normal: new Vec3(0, 0, 1),
      point: new Vec3(x + 0.5, y + 0.5, z + 1),
      distance: 0.2,
    });
    expect(world.beginMining(player, intent, 1, 1)).toEqual({ ok: true });
    expect(world.tryBreak(player, x, y, z, intent, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(x, y, z)).toBe(BlockId.Air);
  });

  it('lets a second player break after the first finish was rejected as stale', async () => {
    const { world, player: ada } = await boot();
    const bobJoin = world.join({ sink: new MemorySink(), name: 'Bob' });
    if ('error' in bobJoin) throw new Error(bobJoin.error);
    const bob = bobJoin.player;
    world.setGameMode(bob, 'creative');
    ada.controller.teleport([8.5, 70, 8.5]);
    bob.controller.teleport([8.5, 70, 8.5]);
    world.applyInput(ada, input(1));
    world.applyInput(bob, input(1));
    world.tick();
    const hit = prepareTarget(world, ada);
    world.world.setBlock(hit.x, hit.y, hit.z, BlockId.Dirt);
    const intent = blockTargetFromHit({ ...hit, block: BlockId.Dirt });
    expect(world.beginMining(ada, intent, 1, 1)).toEqual({ ok: true });
    expect(world.tryBreak(ada, hit.x, hit.y, hit.z, {
      ...intent,
      targetBlockId: BlockId.Stone,
    }, 1)).toEqual({ ok: false, reason: 'stale' });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Dirt);
    expect(world.tryBreak(bob, hit.x, hit.y, hit.z, intent, 1)).toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it('does not cancel an explicit bow draw when FIFO later applies use:false', async () => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.inventory.setSlot(1, createItemStack('arrow', 16));
    for (let seq = 1; seq <= 4; seq += 1) {
      world.applyInput(player, input(seq, { use: false, forward: 1 }));
    }
    world.applyInput(player, input(5, { use: true, forward: 1 }));
    expect(world.interact(player, undefined, 1, 5, 0)).toEqual({ ok: true });
    expect(player.bowUseTicks).toBeGreaterThan(0);
    for (let tick = 0; tick < 4; tick += 1) world.tick();
    expect(player.bowUseTicks).toBe(1);
    for (let tick = 0; tick < 3; tick += 1) world.tick();
    expect(player.bowUseTicks).toBeGreaterThan(3);
    expect(world.releaseBow(player, { actionSeq: 2, commandSeq: 5, yaw: 0.4, pitch: -0.1 }).ok).toBe(true);
    expect(world.gameplay.arrows.count).toBe(1);
  });

  it('starts food from the captured slot and ignores older FIFO use=false commands', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.survival.restore({ hunger: 10 });
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack('stone', 1));
    player.inventory.setSlot(3, createItemStack(ItemId.Apple, 2));
    world.applyInput(player, input(1, { selectedSlot: 0, use: false }));
    world.applyInput(player, input(2, { selectedSlot: 3, use: true }));

    expect(world.interact(player, undefined, 1, 2, 3)).toEqual({ ok: true });
    expect(player.foodUseTicks).toBe(1);
    world.tick();
    expect(player.foodUseTicks).toBe(1);
    world.tick();
    expect(player.foodUseTicks).toBe(2);
  });

  it('cancels food use on a newer release or slot switch without consuming an item', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.survival.restore({ hunger: 10 });
    player.inventory.clear();
    player.inventory.setSlot(0, createItemStack(ItemId.Apple, 2));
    player.inventory.setSlot(1, createItemStack('stone', 1));
    world.applyInput(player, input(1, { selectedSlot: 0, use: true }));
    expect(world.interact(player, undefined, 1, 1, 0)).toEqual({ ok: true });
    world.tick();
    expect(player.foodUseTicks).toBeGreaterThan(1);
    world.applyInput(player, input(2, { selectedSlot: 0, use: false }));
    world.tick();
    expect(player.foodUseTicks).toBe(0);
    expect(player.inventory.count(ItemId.Apple)).toBe(2);

    world.applyInput(player, input(3, { selectedSlot: 0, use: true }));
    expect(world.interact(player, undefined, 2, 3, 0)).toEqual({ ok: true });
    world.tick();
    world.applyInput(player, input(4, { selectedSlot: 1, use: true }));
    world.tick();
    expect(player.foodUseTicks).toBe(0);
    expect(player.inventory.count(ItemId.Apple)).toBe(2);
  });

  it('cancels captured food use metadata when the player dies and respawns', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.survival.restore({ hunger: 10 });
    player.inventory.clear();
    player.inventory.setSlot(2, createItemStack(ItemId.Apple, 1));
    world.applyInput(player, input(1, { selectedSlot: 2, use: true }));
    expect(world.interact(player, undefined, 1, 1, 2)).toEqual({ ok: true });
    expect(player.useStartCommandSeq).toBe(1);
    expect(player.useSelectedSlot).toBe(2);
    expect(player.useItemId).toBe(ItemId.Apple);

    player.survival.damage(100, 'generic', { ignoreInvulnerability: true });
    world.gameplay.respawnIfDead(player);

    expect(player.foodUseTicks).toBe(0);
    expect(player.useStartCommandSeq).toBeUndefined();
    expect(player.useSelectedSlot).toBeUndefined();
    expect(player.useItemId).toBeUndefined();
    expect(player.lastUse).toBe(false);
  });

  it.each([
    { itemId: ItemId.Apple, effect: undefined },
    { itemId: ItemId.GoldenApple, effect: 'absorption' as const },
    { itemId: ItemId.PotionRegeneration, effect: 'regeneration' as const },
    { itemId: ItemId.PotionInvisibility, effect: 'invisibility' as const },
  ])('completes authoritative online use for $itemId from the captured slot', async ({ itemId, effect }) => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.survival.restore({ hunger: 10 });
    player.inventory.clear();
    player.inventory.setSlot(4, createItemStack(itemId, 1));
    world.applyInput(player, input(1, { selectedSlot: 4, use: true }));
    expect(world.interact(player, undefined, 1, 1, 4)).toEqual({ ok: true });

    for (let tick = 0; tick < 31; tick += 1) world.tick();

    expect(player.inventory.count(itemId)).toBe(0);
    expect(player.foodUseTicks).toBe(0);
    if (effect) expect(player.survival.effectTicks(effect)).toBeGreaterThan(0);
    if (itemId === ItemId.PotionRegeneration || itemId === ItemId.PotionInvisibility) {
      expect(player.inventory.count(ItemId.GlassBottle)).toBe(1);
    }
  });

  it('drops a returned potion bottle when the authoritative inventory is full', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.clear();
    for (let slot = 0; slot < 36; slot += 1) {
      player.inventory.setSlot(slot, createItemStack('stone', 64));
    }
    player.inventory.setSlot(5, createItemStack(ItemId.PotionRegeneration, 2));
    world.applyInput(player, input(1, { selectedSlot: 5, use: true }));
    expect(world.interact(player, undefined, 1, 1, 5)).toEqual({ ok: true });

    for (let tick = 0; tick < 31; tick += 1) world.tick();

    expect(player.inventory.count(ItemId.PotionRegeneration)).toBe(1);
    expect(player.inventory.count(ItemId.GlassBottle)).toBe(0);
    expect(world.gameplay.drops.entities.some((drop) => drop.stack.itemId === ItemId.GlassBottle)).toBe(true);
  });

  it('fires 20 consecutive draw-release cycles without dropping a shot', async () => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow', 1));
    let actionSeq = 0;
    let commandSeq = 0;
    for (let shot = 0; shot < 20; shot += 1) {
      commandSeq += 1;
      world.applyInput(player, input(commandSeq, { use: true }));
      actionSeq += 1;
      expect(world.interact(player, undefined, actionSeq, commandSeq, 0)).toEqual({ ok: true });
      world.tick();
      for (let tick = 0; tick < 3; tick += 1) {
        commandSeq += 1;
        world.applyInput(player, input(commandSeq, { use: true }));
        world.tick();
      }
      commandSeq += 1;
      world.applyInput(player, input(commandSeq, { use: false }));
      actionSeq += 1;
      expect(world.releaseBow(player, {
        actionSeq,
        commandSeq,
        yaw: 0.2 * shot,
        pitch: -0.05,
      }).ok).toBe(true);
      expect(world.gameplay.arrows.count).toBe(shot + 1);
      world.tick();
    }
  });

  it.each([
    ['stationary', {}],
    ['walking', { forward: 1 }],
    ['sprinting', { forward: 1, sprint: true }],
    ['jumping', { jump: true }],
  ] as const)('keeps captured bow aim while %s after a later look flick', async (_name, movement) => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow', 1));
    world.applyInput(player, input(1, { ...movement, use: true }));
    expect(world.interact(player, undefined, 1, 1)).toEqual({ ok: true });
    player.bowUseTicks = 20;
    const yaw = 1.17;
    const pitch = 0.31;
    world.applyInput(player, input(2, { ...movement, use: false, yaw: -2.4, pitch: -0.2 }));
    world.tick();
    expect(world.releaseBow(player, { actionSeq: 2, commandSeq: 2, yaw, pitch }).ok).toBe(true);
    const expected = viewDirectionFromLook(yaw, pitch);
    const actual = world.gameplay.arrows.entities.at(-1)!.velocity.clone().normalize();
    const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z;
    expect(dot).toBeGreaterThan(1 - 1e-6);
    const released = actual.clone();
    world.applyInput(player, input(3, { yaw: 2.8, pitch: -0.7 }));
    expect(world.gameplay.arrows.entities.at(-1)!.velocity.clone().normalize()).toEqual(released);
  });

  it('rejects no-draw, insufficient charge, duplicate release, and survival ammo', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.inventory.setSlot(1, createItemStack('arrow', 1));
    expect(world.releaseBow(player, { actionSeq: 1, commandSeq: 1, yaw: 0, pitch: 0 }))
      .toEqual({ ok: false, reason: 'no-draw' });
    expect(world.interact(player, undefined, 2, 1)).toEqual({ ok: true });
    expect(world.releaseBow(player, { actionSeq: 3, commandSeq: 1, yaw: 0, pitch: 0 }))
      .toEqual({ ok: false, reason: 'charge' });
    player.bowUseTicks = 20;
    const release = { actionSeq: 4, commandSeq: 1, yaw: 0.7, pitch: 0.1 };
    expect(world.releaseBow(player, release).ok).toBe(true);
    expect(player.inventory.count('arrow')).toBe(0);
    expect(world.releaseBow(player, release)).toEqual({ ok: false, reason: 'duplicate' });
    player.bowUseTicks = 20;
    expect(world.releaseBow(player, { actionSeq: 5, commandSeq: 1, yaw: 0, pitch: 0 }))
      .toEqual({ ok: false, reason: 'ammo' });
  });
});
