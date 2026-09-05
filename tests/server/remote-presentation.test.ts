import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId, getBlockDefinition, miningProgressPerTick } from '../../src/blocks';
import { createItemStack } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import { blockTargetFromHit } from '../../src/net/actionIntent';
import { parseClientMessage, type ClientInputMessage, type ServerMessage } from '../../shared/protocol';
import { WorldInstance, type ServerPlayer } from '../../server/WorldInstance';
import { loadServerConfig } from '../../server/config';

function input(seq = 1, extra: Partial<ClientInputMessage> = {}): ClientInputMessage {
  return { type: 'input', seq, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
    descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0, mining: true, ...extra };
}
function target(world: WorldInstance, player: ServerPlayer, x = 8) {
  world.world.setBlock(x, 71, 5, BlockId.Stone);
  const eye = player.controller.eyePosition();
  const hit = world.world.raycast(eye, new Vec3(x + 0.5, 71.5, 5.5).sub(eye).normalize(), 5);
  if (!hit) throw new Error('missing target');
  return blockTargetFromHit(hit);
}

describe('server remote presentation publication', { timeout: 20_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });
  async function boot() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-presentation-'));
    dirs.push(dir);
    const config = loadServerConfig({ HOST: '127.0.0.1', PORT: '0', CHUNK_VIEW_RADIUS: '1', MAX_PLAYERS: '4' }, process.cwd());
    const world = new WorldInstance({ ...config, dataDir: dir, port: 0, chunkViewRadius: 1 });
    worlds.push(world);
    await world.initialize();
    const packets: ServerMessage[] = [];
    const joined = world.join({ name: 'Actor', sink: { send: p => packets.push(p as ServerMessage) } });
    if ('error' in joined) throw new Error(joined.error);
    const player = joined.player;
    world.setGameMode(player, 'creative');
    player.controller.teleport([8.5, 70, 8.5]);
    for (let x = 7; x <= 10; x++) for (let z = 4; z <= 9; z++) {
      for (let y = 70; y <= 73; y++) world.world.setBlock(x, y, z, BlockId.Air);
      world.world.setBlock(x, 69, z, BlockId.Stone);
    }
    player.inventory.clear();
    world.applyInput(player, input());
    world.tick();
    return { world, player, packets };
  }

  it('publishes exact authoritative target/progress on join and player_state; abort clears both', async () => {
    const { world, player, packets } = await boot();
    const intent = target(world, player);
    world.setGameMode(player, 'survival');
    expect(world.beginMining(player, intent, 1, 1).ok).toBe(true);
    expect(player.remoteInfo().presentation?.mining).toMatchObject({ x: 8, y: 71, z: 5, blockId: BlockId.Stone, progress: 0 });
    world.gameplay.advanceMining(player);
    const progress = miningProgressPerTick(getBlockDefinition(BlockId.Stone));
    expect(player.snapshot().presentation?.mining?.progress).toBeCloseTo(progress);
    const observer = world.join({ name: 'Observer', sink: { send: () => {} } });
    if ('error' in observer) throw new Error(observer.error);
    expect(world.connectedPlayers().find(p => p.id === player.id)?.remoteInfo().presentation).toEqual(player.presentation());
    world.tick();
    const state = packets.filter(p => p.type === 'player_state').at(-1);
    expect(state?.type).toBe('player_state');
    if (state?.type === 'player_state') {
      expect(state.players.find(p => p.id === player.id)?.presentation?.mining?.progress).toBeCloseTo(progress * 2);
    }
    world.abortMining(player);
    expect(player.remoteInfo().presentation?.mining).toBeNull();
  });

  it('finishes from real server progress and clears all miners when the voxel changes', async () => {
    const { world, player } = await boot();
    const intent = target(world, player);
    world.setGameMode(player, 'survival');
    world.beginMining(player, intent, 1, 1);
    for (let tick = 0; tick < 200 && player.miningTarget; tick++) world.gameplay.advanceMining(player);
    expect(world.world.getBlock(8, 71, 5)).toBe(BlockId.Air);
    expect(player.presentation().mining).toBeNull();
    expect(player.presentation().swingSeq).toBe(1);
  });

  it('clears on replacement and starts target B with zero progress', async () => {
    const { world, player } = await boot();
    world.beginMining(player, target(world, player), 1, 1);
    world.world.setBlock(8, 71, 5, BlockId.Dirt);
    expect(player.presentation().mining).toBeNull();
    const b = target(world, player, 9);
    expect(world.beginMining(player, b, 2, 1).ok).toBe(true);
    expect(player.presentation().mining).toMatchObject({ x: 9, progress: 0 });
  });

  it('rejects malformed/stale/duplicate/plugin-cancelled use without fake swings; accepted placement increments once', async () => {
    const { world, player } = await boot();
    const intent = target(world, player);
    player.inventory.setSlot(0, createItemStack('dirt', 64));
    const seq = () => player.presentation().swingSeq;
    expect(world.interact(player, { ...intent, faceX: 1, faceY: 1 }, 1, 1).ok).toBe(false);
    expect(world.interact(player, { ...intent, targetBlockId: BlockId.Dirt }, 2, 1).ok).toBe(false);
    expect(seq()).toBe(0);
    expect(world.interact(player, intent, 3, 1).ok).toBe(true);
    expect(seq()).toBe(1);
    expect(world.interact(player, intent, 3, 1).ok).toBe(false);
    expect(seq()).toBe(1);
    world.world.setBlock(8, 71, 6, BlockId.Air);
    world.events.on('blockPlace', event => { event.cancelled = true; });
    world.interact(player, intent, 4, 1);
    expect(seq()).toBe(1);
    expect(parseClientMessage({ type: 'attack', actionSeq: Number.NaN })).toHaveProperty('error');
  });

  it('replicates only selected authoritative item, rejects input presentation injection, and uses server bow/food/block state', async () => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow'));
    const parsed = parseClientMessage({ ...input(2), presentation: { heldItemId: 'diamond_sword', bowCharge: 1 } });
    expect(parsed).not.toHaveProperty('presentation');
    expect(player.presentation().heldItemId).toBe('bow');
    expect(player.presentation().bowCharge).toBe(0);
    world.interact(player, undefined, 1);
    for (let n = 0; n < 9; n++) world.gameplay.advanceUseHold(player, true);
    expect(player.presentation().bowCharge).toBeCloseTo(player.combat.bowCharge(10).power);
    const before = player.presentation().swingSeq;
    expect(world.releaseBow(player, { actionSeq: 2, commandSeq: 1, yaw: 0.5, pitch: 0.2 }).ok).toBe(true);
    expect(player.presentation()).toMatchObject({ bowCharge: 0, swingSeq: before + 1 });
    expect(world.releaseBow(player, { actionSeq: 2, commandSeq: 1, yaw: 0, pitch: 0 }).ok).toBe(false);
    expect(player.presentation().swingSeq).toBe(before + 1);
    player.inventory.setSlot(1, createItemStack('golden_apple'));
    player.selectedSlot = 1;
    world.interact(player, undefined, 3);
    expect(player.presentation()).toMatchObject({ heldItemId: 'golden_apple', foodUseProgress: 1 / 32, bowCharge: 0 });
    player.inventory.setSlot(2, createItemStack('iron_sword'));
    player.selectedSlot = 2;
    player.combat.setHeldItem('iron_sword');
    player.combat.updateUse(true, true, true);
    expect(player.presentation()).toMatchObject({ heldItemId: 'iron_sword', swordBlocking: true, foodUseProgress: 0 });
    expect(player.remoteInfo()).not.toHaveProperty('inventory');
  });

  it('does not publish failed bow releases and presents a valid attack miss once', async () => {
    const { world, player } = await boot();
    player.inventory.setSlot(0, createItemStack('bow'));
    world.interact(player, undefined, 1);
    expect(world.releaseBow(player, { actionSeq: 2, commandSeq: 1, yaw: 0, pitch: 0 }).ok).toBe(false);
    expect(player.presentation().swingSeq).toBe(0);
    world.attack(player);
    expect(player.presentation().swingSeq).toBe(1);
    expect(player.snapshot().presentation?.swingSeq).toBe(1);
    expect(player.snapshot().presentation?.swingSeq).toBe(1);
  });

  it('clears on death/respawn and session resume without rewinding the server event counter', async () => {
    const { world, player } = await boot();
    world.beginMining(player, target(world, player), 1, 1);
    player.bowUseTicks = 10;
    player.foodUseTicks = 10;
    player.presentSwing();
    player.survival.damage(100, 'generic');
    expect(player.presentation().mining).toBeNull();
    world.attack(player);
    expect(player.presentation().swingSeq).toBe(1);
    world.gameplay.respawnIfDead(player);
    expect(player.presentation()).toMatchObject({ mining: null, bowCharge: 0, foodUseProgress: 0 });
    const resumed = world.join({ name: 'Actor', sessionToken: player.sessionToken, sink: { send: () => {} } });
    if ('error' in resumed) throw new Error(resumed.error);
    expect(resumed.player.presentation()).toMatchObject({ mining: null, swingSeq: 1 });
  });
});
