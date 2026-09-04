import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { PLAYER_NET_REACH } from '../../src/core/constants';
import { createItemStack } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import {
  captureBlockHitIntent,
  captureBowRelease,
  captureBreakAbort,
  captureBreakFinish,
  captureBreakStart,
  captureUseAction,
} from '../../src/net/playerActions';
import type { ClientInputMessage } from '../../shared/protocol';
import { loadServerConfig } from '../../server/config';
import { directionFromCapturedLook } from '../../server/playerActionValidation';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-actions-v2-'));
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

describe('online action pipeline v2', { timeout: 20_000 }, () => {
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

  it.each([
    ['standing', {}],
    ['walking', { forward: 1 }],
    ['strafing', { right: 1 }],
    ['jumping', { jump: true }],
  ] as const)('places against the captured target while %s', async (_name, movement) => {
    const { world, player } = await boot();
    world.applyInput(player, input(1, movement));
    world.tick();
    const hit = prepareTarget(world, player);
    const direction = hit.point.clone().sub(player.controller.eyePosition()).normalize();
    const yaw = Math.atan2(-direction.x, -direction.z);
    const pitch = Math.asin(direction.y);
    world.applyInput(player, input(2, { ...movement, yaw, pitch }));
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    const action = captureUseAction({ actionSeq: 1, commandSeq: 2, selectedSlot: 0 }, hit);
    if (action.type !== 'block_use') throw new Error('expected block use');
    expect(world.blockUse(player, action)).toEqual({ ok: true });
    expect(world.world.getBlock(
      hit.x + hit.normal.x,
      hit.y + hit.normal.y,
      hit.z + hit.normal.z,
    )).toBe(BlockId.Dirt);
  });

  it('uses captured target A after a rapid yaw flick and never substitutes current target B', async () => {
    const { world, player } = await boot();
    const hitA = prepareTarget(world, player, 0);
    const targetB = { x: hitA.x + 2, y: hitA.y, z: hitA.z };
    world.world.setBlock(targetB.x, targetB.y, targetB.z, BlockId.Stone);
    const hitBPoint = new Vec3(targetB.x + 0.5, targetB.y + 0.5, targetB.z + 1);
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    world.applyInput(player, input(1));
    const action = captureUseAction({ actionSeq: 1, commandSeq: 1, selectedSlot: 0 }, hitA);
    if (action.type !== 'block_use') throw new Error('expected block use');
    player.controller.yaw = Math.atan2(
      -(hitBPoint.x - player.controller.eyePosition().x),
      -(hitBPoint.z - player.controller.eyePosition().z),
    );
    expect(world.blockUse(player, action)).toEqual({ ok: true });
    expect(world.world.getBlock(hitA.x + hitA.normal.x, hitA.y + hitA.normal.y, hitA.z + hitA.normal.z))
      .toBe(BlockId.Dirt);
    expect(world.world.getBlock(targetB.x, targetB.y, targetB.z + 1))
      .toBe(BlockId.Air);
  });

  it('rejects invalid face, stale block, out-of-reach intent, and duplicate actionSeq', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player);
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    world.applyInput(player, input(1));
    const base = { actionSeq: 1, commandSeq: 1, selectedSlot: 0, ...captureBlockHitIntent(hit) };
    expect(world.blockUse(player, { ...base, faceX: 1, faceY: 1 })).toEqual({ ok: false, reason: 'face' });
    expect(world.blockUse(player, { ...base, actionSeq: 2, targetBlockId: BlockId.Dirt })).toEqual({ ok: false, reason: 'stale' });
    player.controller.teleport([8.5, 70, 20.5]);
    expect(world.blockUse(player, { ...base, actionSeq: 3 })).toEqual({ ok: false, reason: 'reach' });
    player.controller.teleport([8.5, 70, 8.5]);
    expect(world.blockUse(player, { ...base, actionSeq: 4 })).toEqual({ ok: true });
    expect(world.blockUse(player, { ...base, actionSeq: 4 })).toEqual({ ok: false, reason: 'duplicate-action' });
  });

  it('keeps break start/abort/finish bound to one explicit target', async () => {
    const { world, player } = await boot();
    const hit = prepareTarget(world, player);
    world.applyInput(player, input(1, { mining: true }));
    expect(world.breakStart(player, captureBreakStart({ actionSeq: 1, commandSeq: 1, selectedSlot: 0 }, hit)))
      .toEqual({ ok: true });
    expect(world.breakAbort(player, captureBreakAbort({ actionSeq: 2, commandSeq: 1, selectedSlot: 0 })))
      .toEqual({ ok: true });
    expect(player.miningTarget).toBeUndefined();
    expect(world.breakStart(player, captureBreakStart({ actionSeq: 3, commandSeq: 1, selectedSlot: 0 }, hit)))
      .toEqual({ ok: true });
    player.controller.yaw += Math.PI / 2;
    expect(world.breakFinish(player, captureBreakFinish({ actionSeq: 4, commandSeq: 1, selectedSlot: 0 }, hit)))
      .toEqual({ ok: true });
    expect(world.world.getBlock(hit.x, hit.y, hit.z)).toBe(BlockId.Air);
  });

  it.each([
    ['stationary', {}],
    ['walking', { forward: 1 }],
    ['sprinting', { forward: 1, sprint: true }],
    ['jumping', { jump: true }],
  ] as const)('fires along captured bow release aim while %s', async (_name, movement) => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.inventory.setSlot(1, createItemStack('arrow', 16));
    world.applyInput(player, input(1, { ...movement, use: true }));
    expect(world.useItem(player, { actionSeq: 1, commandSeq: 1, selectedSlot: 0 })).toEqual({ ok: true });
    player.bowUseTicks = 20;
    const yaw = 1.17;
    const pitch = 0.31;
    world.applyInput(player, input(2, { ...movement, use: false, yaw: -2.4, pitch: -0.2 }));
    expect(world.bowRelease(player, captureBowRelease({ actionSeq: 2, commandSeq: 2, selectedSlot: 0 }, yaw, pitch)))
      .toEqual({ ok: true });
    const expected = directionFromCapturedLook(yaw, pitch);
    const actual = world.gameplay.arrows.entities.at(-1)!.velocity.clone().normalize();
    const dot = actual.x * expected.x + actual.y * expected.y + actual.z * expected.z;
    expect(dot).toBeGreaterThan(1 - 1e-12);
    const releasedVelocity = actual.clone();
    world.applyInput(player, input(3, { yaw: 2.8, pitch: -0.7 }));
    expect(world.gameplay.arrows.entities.at(-1)!.velocity.clone().normalize()).toEqual(releasedVelocity);
  });

  it('dedupes bow release and keeps survival ammo authoritative', async () => {
    const { world, player } = await boot();
    world.setGameMode(player, 'survival');
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.inventory.setSlot(1, createItemStack('arrow', 2));
    world.applyInput(player, input(1, { use: true }));
    world.useItem(player, { actionSeq: 1, commandSeq: 1, selectedSlot: 0 });
    player.bowUseTicks = 20;
    const release = captureBowRelease({ actionSeq: 2, commandSeq: 1, selectedSlot: 0 }, 0.7, 0.1);
    expect(world.bowRelease(player, release)).toEqual({ ok: true });
    expect(player.inventory.count('arrow')).toBe(1);
    expect(world.gameplay.arrows.count).toBe(1);
    expect(world.bowRelease(player, release)).toEqual({ ok: false, reason: 'duplicate-action' });
    expect(world.gameplay.arrows.count).toBe(1);
    expect(world.bowRelease(player, captureBowRelease({ actionSeq: 3, commandSeq: 1, selectedSlot: 0 }, 0, 0)))
      .toEqual({ ok: false, reason: 'not-drawing' });
    player.bowUseTicks = 1;
    expect(world.bowRelease(player, captureBowRelease({ actionSeq: 4, commandSeq: 1, selectedSlot: 0 }, 0, 0)))
      .toEqual({ ok: false, reason: 'charge' });
    expect(player.inventory.count('arrow')).toBe(1);
  });

  it('does not consume creative arrows', async () => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow', 1));
    player.inventory.setSlot(1, createItemStack('arrow', 2));
    world.applyInput(player, input(1, { use: true }));
    world.useItem(player, { actionSeq: 1, commandSeq: 1, selectedSlot: 0 });
    player.bowUseTicks = 20;
    expect(world.bowRelease(player, captureBowRelease({ actionSeq: 2, commandSeq: 1, selectedSlot: 0 }, 0, 0)))
      .toEqual({ ok: true });
    expect(player.inventory.count('arrow')).toBe(2);
  });
});
