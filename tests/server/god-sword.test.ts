import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../../src/blocks';
import { ItemId } from '../../src/items';
import { createItemStack, parseSerializedItemStack } from '../../src/inventory';
import { Vec3 } from '../../src/math/vec3';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig, type ServerMode } from '../../server/config';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from '../../server/WorldInstance';
import type { AttackAction } from '../../shared/playerActions';
import type { ClientInputMessage, ServerActionResultMessage } from '../../shared/protocol';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fc-god-sword-'));
}

function testConfig(dataDir: string, serverMode: ServerMode = 'anarchy') {
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
    serverMode,
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

function lookAt(attacker: ServerPlayer, target: ServerPlayer | { x: number; y: number; z: number }) {
  const origin = attacker.controller.eyePosition();
  const point = 'controller' in target
    ? new Vec3(target.controller.position.x, target.controller.position.y + 0.9, target.controller.position.z)
    : new Vec3(target.x, target.y, target.z);
  return {
    yaw: Math.atan2(-(point.x - origin.x), -(point.z - origin.z)),
    pitch: Math.asin((point.y - origin.y) / Math.max(1e-6, Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z))),
  };
}

function action(
  actionSeq: number,
  commandSeq: number,
  look: { yaw: number; pitch: number },
  target?: { id: string },
  targetRenderTick?: number,
  selectedSlot = 0,
): AttackAction {
  return {
    kind: 'attack', actionSeq, commandSeq, selectedSlot,
    yaw: look.yaw, pitch: look.pitch,
    ...(target ? { targetId: target.id, targetRenderTick } : {}),
  };
}

function result(sink: MemorySink, actionSeq: number): ServerActionResultMessage {
  const found = [...sink.payloads].reverse().find((entry) => {
    const candidate = entry as Partial<ServerActionResultMessage>;
    return candidate.type === 'action_result' && candidate.actionSeq === actionSeq;
  });
  if (!found) throw new Error(`missing action_result ${actionSeq}`);
  return found as ServerActionResultMessage;
}

describe('authoritative God Sword combat', { timeout: 120_000 }, () => {
  const dirs: string[] = [];
  const worlds: WorldInstance[] = [];

  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot(serverMode: ServerMode = 'anarchy') {
    const dir = await tempDir();
    dirs.push(dir);
    const world = new WorldInstance(testConfig(dir, serverMode));
    worlds.push(world);
    await world.initialize();
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
    b.player.inventory.clear();
    a.player.gamemode = 'survival';
    b.player.gamemode = 'survival';
    return { world, attacker: a.player, victim: b.player, attackerSink, victimSink };
  }

  function stand(
    world: WorldInstance,
    attacker: ServerPlayer,
    victim: ServerPlayer,
    seq = 1,
    selectedSlot = 0,
  ) {
    const look = lookAt(attacker, victim);
    world.applyInput(attacker, input(seq, look.yaw, look.pitch, selectedSlot));
    world.applyInput(victim, input(seq));
    world.tick();
    return look;
  }

  function giveGodSword(attacker: ServerPlayer, slot = 0) {
    const stack = parseSerializedItemStack({ itemId: ItemId.GodSword, count: 1 });
    if (!stack) throw new Error('god sword stack was rejected');
    expect(stack.durability).toBeUndefined();
    attacker.inventory.setSlot(slot, stack);
  }

  function strike(
    world: WorldInstance,
    attacker: ServerPlayer,
    victim: ServerPlayer,
    sink: MemorySink,
    look: { yaw: number; pitch: number },
    actionSeq: number,
    commandSeq: number,
    selectedSlot = 0,
    target: { id: string } | undefined = victim,
  ) {
    sink.payloads.length = 0;
    world.handleSequencedAttack(
      attacker,
      action(actionSeq, commandSeq, look, target, target ? world.tickNumber : undefined, selectedSlot),
    );
    return result(sink, actionSeq);
  }

  function equipTitanium(victim: ServerPlayer, durability = 100) {
    const pieces = [
      ['head', ItemId.TitaniumHelmet],
      ['chest', ItemId.TitaniumChestplate],
      ['legs', ItemId.TitaniumLeggings],
      ['feet', ItemId.TitaniumBoots],
    ] as const;
    for (const [slot, itemId] of pieces) {
      victim.inventory.setSlot({ section: 'armor', slot }, createItemStack(itemId, 1, { durability }));
    }
  }

  it('kills a full-health survival player from the authoritative slot and breaks the sword', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    giveGodSword(attacker);
    attacker.inventory.setSlot(1, createItemStack(ItemId.TitaniumSword));
    const look = stand(world, attacker, victim, 1, 0);
    attacker.selectedSlot = 1;
    const amounts: number[] = [];
    const deaths: string[] = [];
    world.events.on('playerDamaged', (event) => amounts.push(event.amount));
    world.events.on('entityDeath', (event) => deaths.push(event.cause));
    const combat = strike(world, attacker, victim, attackerSink, look, 1, 1, 0);
    expect(combat.combat?.result).toBe('hit');
    expect(victim.survival.dead).toBe(true);
    expect(victim.survival.health).toBe(0);
    expect(amounts).toEqual([10]);
    expect(deaths).toEqual(['melee']);
    expect(attacker.inventory.getSlot(0)).toBeNull();
    expect(attacker.inventory.getSlot(1)?.itemId).toBe(ItemId.TitaniumSword);
    expect(victim.survival.lastDamage).toMatchObject({
      source: 'melee',
      requested: 10,
      dealt: 20,
      killed: true,
    });
  });

  it('kills a 1 HP player and a fully armored player, including absorption, blocking, and hurt resistance', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    attacker.inventory.setSlot(0, createItemStack(ItemId.TitaniumSword));
    const look = stand(world, attacker, victim);
    const ordinary = strike(world, attacker, victim, attackerSink, look, 1, 1);
    expect(ordinary.combat?.result).toBe('hit');
    expect(victim.survival.dead).toBe(false);
    expect(victim.survival.health).toBe(10);
    expect(victim.survival.hurtResistance.remainingTicks).toBeGreaterThan(10);
    const resisted = strike(world, attacker, victim, attackerSink, look, 2, 1);
    expect(resisted.combat?.result).toBe('immune');
    expect(victim.survival.health).toBe(10);
    expect(attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.TitaniumSword);

    giveGodSword(attacker);
    const lethal = strike(world, attacker, victim, attackerSink, look, 3, 1);
    expect(lethal.combat?.result).toBe('hit');
    expect(victim.survival.dead).toBe(true);
    expect(attacker.inventory.getSlot(0)).toBeNull();

    const low = await boot();
    giveGodSword(low.attacker);
    low.victim.survival.health = 1;
    const lowLook = stand(low.world, low.attacker, low.victim);
    strike(low.world, low.attacker, low.victim, low.attackerSink, lowLook, 1, 1);
    expect(low.victim.survival.dead).toBe(true);
    expect(low.victim.survival.health).toBe(0);

    const armored = await boot();
    giveGodSword(armored.attacker);
    equipTitanium(armored.victim);
    armored.victim.survival.applyEffect({ id: 'absorption', amplifier: 1, durationTicks: 200 });
    armored.victim.inventory.setSlot(0, createItemStack(ItemId.IronSword));
    armored.victim.combat.setHeldItem(ItemId.IronSword);
    armored.victim.combat.updateUse(true, true, true);
    expect(armored.victim.survival.absorption).toBe(8);
    expect(armored.victim.combat.swordBlocking).toBe(true);
    let worn = false;
    armored.victim.survival.addDamageListener((event) => { worn = event.armorWorn === true; });
    const armorLook = stand(armored.world, armored.attacker, armored.victim);
    expect(armored.victim.combat.swordBlocking).toBe(false);
    armored.victim.combat.setHeldItem(ItemId.IronSword);
    armored.victim.combat.updateUse(true, true, true);
    strike(armored.world, armored.attacker, armored.victim, armored.attackerSink, armorLook, 1, 1);
    expect(armored.victim.survival.dead).toBe(true);
    expect(worn).toBe(false);
    expect(armored.attacker.inventory.getSlot(0)).toBeNull();
  });

  it('lets an offhand Totem save the victim and still breaks the sword', async () => {
    const { world, attacker, victim, attackerSink, victimSink } = await boot();
    giveGodSword(attacker);
    equipTitanium(victim);
    victim.survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 100 });
    victim.inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.TotemOfUndying));
    const look = stand(world, attacker, victim);
    const deaths: string[] = [];
    world.events.on('entityDeath', (event) => deaths.push(event.entityId));
    const combat = strike(world, attacker, victim, attackerSink, look, 1, 1);
    expect(combat.combat?.result).toBe('hit');
    expect(victim.survival.dead).toBe(false);
    expect(victim.survival.health).toBe(1);
    expect(victim.survival.hasEffect('regeneration')).toBe(true);
    expect(victim.survival.hasEffect('fire_resistance')).toBe(true);
    expect(victim.survival.hasEffect('absorption')).toBe(true);
    expect(victim.survival.absorption).toBe(8);
    expect(victim.inventory.offhand).toBeNull();
    expect(victim.inventory.getSlot({ section: 'armor', slot: 'chest' })?.durability).toBe(100);
    expect(attacker.inventory.getSlot(0)).toBeNull();
    expect(victim.totemActivated).toBe(true);
    expect(deaths).toEqual([]);
    world.tick();
    expect(victim.totemActivated).toBe(false);
    expect(victimSink.payloads.some((entry) => (entry as { type?: string }).type === 'totem_activate')).toBe(true);
    expect(victimSink.payloads.some((entry) => {
      const sound = entry as { type?: string; sounds?: Array<{ event?: string }> };
      return sound.type === 'world_sound' && sound.sounds?.some((cue) => cue.event === 'totem.activate');
    })).toBe(true);
  });

  it('does not treat a Totem outside the offhand as protection', async () => {
    const { world, attacker, victim, attackerSink, victimSink } = await boot();
    giveGodSword(attacker);
    victim.inventory.setSlot(4, createItemStack(ItemId.TotemOfUndying));
    const look = stand(world, attacker, victim);
    strike(world, attacker, victim, attackerSink, look, 1, 1);
    expect(victim.survival.dead).toBe(true);
    expect(victim.totemActivated).toBe(false);
    expect(victim.inventory.offhand).toBeNull();
    expect(world.gameplay.drops.entities.some((drop) => drop.stack.itemId === ItemId.TotemOfUndying)).toBe(true);
    world.tick();
    expect(victimSink.payloads.some((entry) => (entry as { type?: string }).type === 'totem_activate')).toBe(false);
    expect(attacker.inventory.getSlot(0)).toBeNull();
  });

  it('uses the attack slot rather than the current hotbar selection', async () => {
    const { world, attacker, victim, attackerSink } = await boot();
    giveGodSword(attacker, 0);
    attacker.inventory.setSlot(1, createItemStack(ItemId.TitaniumSword));
    const look = stand(world, attacker, victim, 1, 1);
    attacker.selectedSlot = 0;
    const combat = strike(world, attacker, victim, attackerSink, look, 1, 1, 1);
    expect(combat.combat?.result).toBe('hit');
    expect(victim.survival.dead).toBe(false);
    expect(victim.survival.health).toBe(10);
    expect(attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);
    expect(attacker.inventory.getSlot(1)?.durability).toBe(2799);
  });

  it('keeps the sword when the swing misses, is out of reach, is blocked, or is rejected', async () => {
    const missed = await boot();
    giveGodSword(missed.attacker);
    const missLook = stand(missed.world, missed.attacker, missed.victim);
    const miss = strike(missed.world, missed.attacker, missed.victim, missed.attackerSink, { ...missLook, pitch: -1.4 }, 1, 1);
    expect(miss.combat?.result).toBe('miss');
    expect(missed.victim.survival.health).toBe(20);
    expect(missed.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);

    const far = await boot();
    far.victim.controller.teleport([20.5, 100, 28.5]);
    far.world.world.setBlock(20, 99, 28, BlockId.Stone);
    giveGodSword(far.attacker);
    const farLook = stand(far.world, far.attacker, far.victim);
    const reach = strike(far.world, far.attacker, far.victim, far.attackerSink, farLook, 1, 1);
    expect(reach.combat?.result).toBe('out_of_reach');
    expect(far.victim.survival.dead).toBe(false);
    expect(far.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);

    const wall = await boot();
    wall.world.world.setBlock(20, 101, 21, BlockId.Stone);
    giveGodSword(wall.attacker);
    const wallLook = stand(wall.world, wall.attacker, wall.victim);
    const occluded = strike(wall.world, wall.attacker, wall.victim, wall.attackerSink, wallLook, 1, 1);
    expect(occluded.combat?.result).toBe('occluded');
    expect(wall.victim.survival.health).toBe(20);
    expect(wall.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);

    const stale = await boot();
    giveGodSword(stale.attacker);
    const staleLook = stand(stale.world, stale.attacker, stale.victim);
    stale.attackerSink.payloads.length = 0;
    stale.world.handleSequencedAttack(stale.attacker, action(1, 40, staleLook, stale.victim, -100));
    expect(result(stale.attackerSink, 1).ok).toBe(false);
    expect(stale.victim.survival.health).toBe(20);
    expect(stale.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);

    const creative = await boot();
    giveGodSword(creative.attacker);
    creative.victim.gamemode = 'creative';
    const creativeLook = stand(creative.world, creative.attacker, creative.victim);
    creative.attackerSink.payloads.length = 0;
    creative.world.handleSequencedAttack(creative.attacker, action(1, 1, creativeLook, creative.victim, creative.world.tickNumber));
    expect(result(creative.attackerSink, 1).combat?.result).toBe('stale');
    expect(creative.victim.survival.dead).toBe(false);
    expect(creative.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);

    const cancelled = await boot();
    giveGodSword(cancelled.attacker);
    const cancelLook = stand(cancelled.world, cancelled.attacker, cancelled.victim);
    cancelled.world.events.on('playerDamage', (event) => event.cancel());
    const blocked = strike(cancelled.world, cancelled.attacker, cancelled.victim, cancelled.attackerSink, cancelLook, 1, 1);
    expect(blocked.combat?.result).toBe('blocked');
    expect(cancelled.victim.survival.health).toBe(20);
    expect(cancelled.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);

    const peaceful = await boot('peaceful');
    giveGodSword(peaceful.attacker);
    const peaceLook = stand(peaceful.world, peaceful.attacker, peaceful.victim);
    const denied = strike(peaceful.world, peaceful.attacker, peaceful.victim, peaceful.attackerSink, peaceLook, 1, 1);
    expect(denied.combat?.result).toBe('blocked');
    expect(peaceful.victim.survival.dead).toBe(false);
    expect(peaceful.attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);
  });

  it('spends the sword on a living mob without a lethal player rule', async () => {
    const { world, attacker, attackerSink } = await boot();
    giveGodSword(attacker);
    const mob = world.gameplay.mobs.spawn('zombie', { x: 20.5, y: 100, z: 18.5 }, { force: true });
    if (!mob) throw new Error('zombie spawn failed');
    world.world.setBlock(20, 99, 18, BlockId.Stone);
    const look = lookAt(attacker, { x: mob.position.x, y: mob.position.y + 0.9, z: mob.position.z });
    world.applyInput(attacker, input(1, look.yaw, look.pitch, 0));
    world.tick();
    const aimed = lookAt(attacker, { x: mob.position.x, y: mob.position.y + 0.9, z: mob.position.z });
    attackerSink.payloads.length = 0;
    world.handleSequencedAttack(attacker, action(1, 1, aimed, mob, world.tickNumber));
    expect(result(attackerSink, 1).combat?.result).toBe('hit');
    expect(mob.alive).toBe(true);
    expect(mob.health).toBeGreaterThan(0);
    expect(mob.health).toBeLessThan(20);
    expect(attacker.inventory.getSlot(0)).toBeNull();
  });

  it('does not spend the sword when it breaks a block, while a titanium sword still wears', async () => {
    const { world, attacker } = await boot();
    giveGodSword(attacker);
    attacker.selectedSlot = 0;
    world.world.setBlock(21, 100, 20, BlockId.Dirt);
    attacker.miningTarget = { x: 21, y: 100, z: 20 };
    attacker.miningProgress = 1;
    expect(world.tryBreak(attacker, 21, 100, 20)).toEqual({ ok: true });
    expect(world.world.getBlock(21, 100, 20)).toBe(BlockId.Air);
    expect(attacker.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);
    expect(attacker.inventory.getSlot(0)?.durability).toBeUndefined();

    attacker.inventory.setSlot(0, createItemStack(ItemId.TitaniumSword));
    world.world.setBlock(21, 101, 20, BlockId.Dirt);
    attacker.miningTarget = { x: 21, y: 101, z: 20 };
    attacker.miningProgress = 1;
    expect(world.tryBreak(attacker, 21, 101, 20)).toEqual({ ok: true });
    expect(attacker.inventory.getSlot(0)?.durability).toBe(2799);
  });

  it('gives the hidden item through /give and keeps it across a restart', async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const first = new WorldInstance(testConfig(dir));
    worlds.push(first);
    await first.initialize();
    const joined = first.join({ sink: new MemorySink(), name: 'Keeper' });
    if ('error' in joined) throw new Error('join failed');
    joined.player.inventory.clear();
    first.handleChat(joined.player, '/give god_sword 1');
    expect(joined.player.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);
    expect(joined.player.inventory.getSlot(0)?.durability).toBeUndefined();
    await first.save();
    const token = joined.player.sessionToken;
    await first.stop();
    worlds.pop();

    const second = new WorldInstance(testConfig(dir));
    worlds.push(second);
    await second.initialize();
    const resumed = second.join({ sink: new MemorySink(), name: 'Keeper', sessionToken: token });
    if ('error' in resumed) throw new Error('resume failed');
    expect(resumed.player.inventory.getSlot(0)?.itemId).toBe(ItemId.GodSword);
    expect(resumed.player.inventory.getSlot(0)?.durability).toBeUndefined();
  });
});
