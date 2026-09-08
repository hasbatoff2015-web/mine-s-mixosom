import * as THREE from 'three';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ItemId } from '../../src/items';
import { createItemStack } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import { viewDirectionFromLook } from '../../src/player/localAim';
import { rayAabbDistance } from '../../src/world/collision';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { MAX_PVP_REWIND_TICKS, combatPoseForCommand } from '../../server/combatPoseHistory';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import type { AttackAction } from '../../shared/playerActions';
import type { ClientInputMessage, ServerActionResultMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-melee-rewind-'));
}

function testConfig(dataDir: string, plugins = false) {
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
    loadBuiltinPlugins: plugins,
  };
}

class MemorySink implements ConnectedSink {
  readonly payloads: unknown[] = [];
  send(payload: unknown): void { this.payloads.push(payload); }
}

function input(seq: number, yaw = 0, pitch = 0): ClientInputMessage {
  return {
    type: 'input', seq, clientTick: seq, forward: 0, right: 0, jump: false,
    sneak: false, sprint: false, descend: false, flySprint: false,
    yaw, pitch, selectedSlot: 0,
  };
}

function lookAt(attacker: ServerPlayer, target: ServerPlayer | { x: number; y: number; z: number }) {
  const origin = attacker.controller.eyePosition();
  const point = 'controller' in target
    ? new Vec3(target.controller.position.x, target.controller.position.y + 0.9, target.controller.position.z)
    : new Vec3(target.x, target.y, target.z);
  const direction = point.sub(origin).normalize();
  return {
    yaw: Math.atan2(-direction.x, -direction.z),
    pitch: Math.asin(direction.y),
  };
}

function action(
  actionSeq: number,
  commandSeq: number,
  look: { yaw: number; pitch: number },
  target?: ServerPlayer,
  targetRenderTick?: number,
): AttackAction {
  return {
    kind: 'attack', actionSeq, commandSeq, selectedSlot: 0,
    yaw: look.yaw, pitch: look.pitch,
    ...(target ? { targetId: target.id, targetRenderTick } : {}),
  };
}

function result(sink: MemorySink, actionSeq: number): ServerActionResultMessage {
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

describe('sequenced melee PvP lag compensation', { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(withPlugins = false) {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir, withPlugins));
    worlds.push(world);
    await world.initialize();
    if (withPlugins) {
      await world.loadPlugins();
      await world.plugins.enableAll();
    }
    const attackerSink = new MemorySink();
    const victimSink = new MemorySink();
    const a = world.join({ sink: attackerSink, name: 'Attacker' });
    const b = world.join({ sink: victimSink, name: 'Victim' });
    if ('error' in a || 'error' in b) throw new Error('join failed');
    a.player.controller.teleport([20.5, 100, 20.5]);
    b.player.controller.teleport([20.5, 100, 22.5]);
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    return { world, attacker: a.player, victim: b.player, attackerSink, victimSink };
  }

  function recordInitial(world: WorldInstance, attacker: ServerPlayer, victim: ServerPlayer, seq = 1) {
    const look = lookAt(attacker, victim);
    world.applyInput(attacker, input(seq, look.yaw, look.pitch));
    world.applyInput(victim, input(seq));
    world.tick();
    return look;
  }

  it('FAST FLICK waits for command N and uses its authoritative look, never the old pose', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    world.applyInput(attacker, input(1, 0, 0));
    world.applyInput(victim, input(1));
    world.tick();
    const look = lookAt(attacker, victim);
    world.applyInput(attacker, input(2, look.yaw, look.pitch));
    attackerSink.payloads.length = 0;
    const before = victim.survival.health;
    world.handleSequencedAttack(attacker, action(1, 2, look, victim, 1));
    expect(attacker.pendingAttacks).toHaveLength(1);
    expect(victim.survival.health).toBe(before);
    expect(attackerSink.payloads.some((entry) => (entry as { type?: string }).type === 'action_result')).toBe(false);
    world.tick();
    expect(attacker.pendingAttacks).toHaveLength(0);
    expect(victim.survival.health).toBeLessThan(before);
    expect(result(attackerSink, 1).combat?.result).toBe('hit');
    expect(combatPoseForCommand(attacker.combatPoseHistory, 2)?.yaw).toBeCloseTo(look.yaw);
  });

  it('MOVING TARGET hits the rendered historical AABB when the current ray would miss', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    const look = recordInitial(world, attacker, victim);
    victim.controller.teleport([22.5, 100, 22.5]);
    world.applyInput(victim, input(2));
    world.tick();
    const attackerPose = combatPoseForCommand(attacker.combatPoseHistory, 1)!;
    const currentMiss = rayAabbDistance(
      { x: attackerPose.eyeX, y: attackerPose.eyeY, z: attackerPose.eyeZ },
      viewDirectionFromLook(attackerPose.yaw, attackerPose.pitch),
      victim.controller.aabb,
    );
    expect(currentMiss).toBeUndefined();
    const before = victim.survival.health;
    attackerSink.payloads.length = 0;
    world.handleSequencedAttack(attacker, action(1, 1, look, victim, 1));
    expect(victim.survival.health).toBeLessThan(before);
    expect(result(attackerSink, 1).combat).toMatchObject({
      result: 'hit', requestedRenderTick: 1, resolvedRenderTick: 1, rewindTicks: 1,
    });
  });

  it('rejects rewind older than five ticks and any future target tick', async () => {
    const old = await boot();
    const look = recordInitial(old.world, old.attacker, old.victim);
    old.victim.controller.teleport([24.5, 100, 22.5]);
    for (let seq = 2; seq <= MAX_PVP_REWIND_TICKS + 2; seq += 1) {
      old.world.applyInput(old.victim, input(seq));
      old.world.tick();
    }
    const before = old.victim.survival.health;
    old.attackerSink.payloads.length = 0;
    old.world.handleSequencedAttack(old.attacker, action(1, 1, look, old.victim, 1));
    expect(old.victim.survival.health).toBe(before);
    expect(result(old.attackerSink, 1).combat?.result).toBe('stale');

    const future = await boot();
    const futureLook = recordInitial(future.world, future.attacker, future.victim);
    future.attackerSink.payloads.length = 0;
    future.world.handleSequencedAttack(
      future.attacker,
      action(1, 1, futureLook, future.victim, future.world.tickNumber + 1),
    );
    expect(future.victim.survival.health).toBe(20);
    expect(result(future.attackerSink, 1).combat?.result).toBe('stale');
  });

  it('classifies current-world wall occlusion and reach beyond three blocks', async () => {
    const wall = await boot();
    wall.victim.controller.teleport([20.5, 100, 23.5]);
    const wallLook = recordInitial(wall.world, wall.attacker, wall.victim);
    wall.world.world.setBlock(20, 101, 22, BlockId.Stone);
    wall.attackerSink.payloads.length = 0;
    wall.world.handleSequencedAttack(wall.attacker, action(1, 1, wallLook, wall.victim, 1));
    expect(wall.victim.survival.health).toBe(20);
    expect(result(wall.attackerSink, 1).combat?.result).toBe('occluded');

    const reach = await boot();
    reach.victim.controller.teleport([20.5, 100, 24.5]);
    const reachLook = recordInitial(reach.world, reach.attacker, reach.victim);
    reach.attackerSink.payloads.length = 0;
    reach.world.handleSequencedAttack(reach.attacker, action(1, 1, reachLook, reach.victim, 1));
    expect(reach.victim.survival.health).toBe(20);
    expect(result(reach.attackerSink, 1).combat?.result).toBe('out_of_reach');
  });

  it('deduplicates actionSeq and reports hurt-resistance immunity as a ray hit, not a miss', async () => {
    const duplicate = await boot();
    const look = recordInitial(duplicate.world, duplicate.attacker, duplicate.victim);
    duplicate.attackerSink.payloads.length = 0;
    duplicate.world.handleSequencedAttack(duplicate.attacker, action(1, 1, look, duplicate.victim, 1));
    const once = duplicate.victim.survival.health;
    duplicate.world.handleSequencedAttack(duplicate.attacker, action(1, 1, look, duplicate.victim, 1));
    expect(duplicate.victim.survival.health).toBe(once);
    expect(result(duplicate.attackerSink, 1)).toMatchObject({ ok: false, reason: 'duplicate' });

    const immune = await boot();
    const immuneLook = recordInitial(immune.world, immune.attacker, immune.victim);
    immune.world.handleSequencedAttack(immune.attacker, action(1, 1, immuneLook, immune.victim, 1));
    const afterFirst = immune.victim.survival.health;
    immune.attackerSink.payloads.length = 0;
    immune.world.handleSequencedAttack(immune.attacker, action(2, 1, immuneLook, immune.victim, 1));
    expect(immune.victim.survival.health).toBe(afterFirst);
    expect(result(immune.attackerSink, 2)).toMatchObject({ ok: true, combat: { result: 'immune' } });
  });

  it.each(['attacker', 'victim'] as const)('preserves %s-side Claims PvP denial on the sequenced path', async (side) => {
    const { world, attacker, victim, attackerSink } = await boot(true);
    const look = recordInitial(world, attacker, victim);
    const pos = side === 'attacker' ? attacker.controller.position : victim.controller.position;
    world.pluginStore.save('claims/claims', {
      claims: [{
        id: 'safe-attacker', name: 'safe-attacker', owner: 'owner', worldId: world.worldId,
        volume: {
          minX: Math.floor(pos.x), minY: Math.floor(pos.y) - 1, minZ: Math.floor(pos.z),
          maxX: Math.floor(pos.x), maxY: Math.floor(pos.y) + 2, maxZ: Math.floor(pos.z),
        },
        members: [], priority: 0, flags: { pvp: false, 'player-damage': true },
      }],
    });
    attackerSink.payloads.length = 0;
    world.handleSequencedAttack(attacker, action(1, 1, look, victim, 1));
    expect(victim.survival.health).toBe(20);
    expect(result(attackerSink, 1).combat?.result).toBe('blocked');
  });

  it('keeps sequenced mob/minecart melee and swing-on-air-miss working without a player hint', async () => {
    const mobCase = await boot();
    mobCase.victim.controller.teleport([30.5, 100, 30.5]);
    const mobPos = new THREE.Vector3(20.5, 100, 18.5);
    const mob = mobCase.world.gameplay.mobs.spawn('zombie', mobPos, { force: true });
    if (!mob) throw new Error('mob spawn failed');
    const mobLook = lookAt(mobCase.attacker, { x: mobPos.x, y: mobPos.y + 1, z: mobPos.z });
    mobCase.world.applyInput(mobCase.attacker, input(1, mobLook.yaw, mobLook.pitch));
    mobCase.world.applyInput(mobCase.victim, input(1));
    mobCase.world.tick();
    const health = mob.health;
    mobCase.attackerSink.payloads.length = 0;
    mobCase.world.handleSequencedAttack(mobCase.attacker, action(1, 1, mobLook));
    expect(mob.health).toBeLessThan(health);
    expect(result(mobCase.attackerSink, 1).combat?.result).toBe('hit');

    const cartCase = await boot();
    cartCase.victim.controller.teleport([30.5, 100, 30.5]);
    cartCase.world.world.setBlock(20, 99, 18, BlockId.Stone);
    cartCase.world.world.setBlock(20, 100, 18, BlockId.Rail);
    const cart = cartCase.world.gameplay.minecarts.spawn(20, 100, 18);
    if (!cart) throw new Error('minecart spawn failed');
    const cartLook = lookAt(cartCase.attacker, {
      x: cart.position.x, y: cart.position.y + 0.55, z: cart.position.z,
    });
    cartCase.world.applyInput(cartCase.attacker, input(1, cartLook.yaw, cartLook.pitch));
    cartCase.world.applyInput(cartCase.victim, input(1));
    cartCase.world.tick();
    cartCase.attackerSink.payloads.length = 0;
    cartCase.world.handleSequencedAttack(cartCase.attacker, action(1, 1, cartLook));
    expect(cartCase.world.gameplay.minecarts.count).toBe(0);
    expect(result(cartCase.attackerSink, 1).combat?.result).toBe('hit');

    const air = await boot();
    air.victim.controller.teleport([30.5, 100, 30.5]);
    const airLook = { yaw: 0, pitch: 0 };
    air.world.applyInput(air.attacker, input(1, airLook.yaw, airLook.pitch));
    air.world.applyInput(air.victim, input(1));
    air.world.tick();
    const swing = air.attacker.presentation().swingSeq;
    air.attackerSink.payloads.length = 0;
    air.world.handleSequencedAttack(air.attacker, action(1, 1, airLook));
    expect(air.attacker.presentation().swingSeq).toBe(swing + 1);
    expect(result(air.attackerSink, 1).combat?.result).toBe('miss');
  });
});
