import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createItemStack } from '../../src/inventory';
import { ItemId, readBookContent } from '../../src/items';
import { BlockId } from '../../src/blocks';
import { ANARCHY_WORLD_SEED } from '../../src/world/import/anarchy';
import { loadServerConfig } from '../../server/config';
import { WorldInstance } from '../../server/WorldInstance';

class MemorySink {
  readonly payloads: Array<{ type?: string; [key: string]: unknown }> = [];
  send(payload: unknown): void { this.payloads.push(payload as typeof this.payloads[number]); }
  last(type: string) { return [...this.payloads].reverse().find((message) => message.type === type); }
}

describe('utility items server authority', { timeout: 30_000 }, () => {
  const worlds: WorldInstance[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.stop();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function boot() {
    const dir = await mkdtemp(join(tmpdir(), 'fc-utility-'));
    dirs.push(dir);
    const config = {
      ...loadServerConfig({ HOST: '127.0.0.1', PORT: '0', WORLD: 'anarchy', WORLD_SEED: ANARCHY_WORLD_SEED,
        MAX_PLAYERS: '8', CHUNK_VIEW_RADIUS: '1', TICK_RATE: '20', PERSIST_INTERVAL_MS: '60000' }, process.cwd()),
      dataDir: dir, port: 0, chunkViewRadius: 1, persistIntervalMs: 60_000,
    };
    const world = new WorldInstance(config);
    worlds.push(world);
    await world.initialize();
    function add(name: string) {
      const sink = new MemorySink();
      const result = world.join({ sink, name });
      if ('error' in result) throw new Error(result.error);
      world.setGameMode(result.player, 'survival');
      result.player.controller.teleport([8.5, 90, 8.5]);
      return { player: result.player, sink };
    }
    return { world, add };
  }

  it('sends WH marks only to the shooter, even when the target is invisible', async () => {
    const { world, add } = await boot();
    const a = add('Shooter');
    const b = add('Target');
    const c = add('Observer');
    b.player.survival.applyEffect({ id: 'invisibility', amplifier: 0, durationTicks: 200 });
    world.gameplay.whMarks.mark(a.player.id, b.player.id, world.tickNumber);
    world.tick();
    expect(a.sink.last('wh_marks')?.targetIds).toEqual([b.player.id]);
    expect(b.sink.last('wh_marks')?.targetIds).toEqual([]);
    expect(c.sink.last('wh_marks')?.targetIds).toEqual([]);
    const state = c.sink.last('player_state') as { players?: Array<{ id: string; invisible?: boolean }> } | undefined;
    expect(state?.players?.find((player) => player.id === b.player.id)?.invisible).toBe(true);
    world.gameplay.whMarks.mark(c.player.id, b.player.id, world.tickNumber);
    world.gameplay.whMarks.clearTarget(b.player.id); // Milk and Totem use this exact clearing path.
    world.tick();
    expect(a.sink.last('wh_marks')?.targetIds).toEqual([]);
    expect(c.sink.last('wh_marks')?.targetIds).toEqual([]);
    world.gameplay.whMarks.mark(a.player.id, b.player.id, world.tickNumber);
    world.disconnect(a.player.id);
    expect(world.gameplay.whMarks.forViewer(a.player.id, world.tickNumber)).toEqual([]);
  });

  it('accepts only bounded book edits for the selected book and keeps its metadata in the player save', async () => {
    const { world, add } = await boot();
    const a = add('Author');
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.Book, 3));
    a.player.selectedSlot = 0;
    world.updateBook(a.player, { type: 'book_update', slot: 0, pages: ['First page', 'Second page'], title: 'Guide' });
    expect(a.player.inventory.count(ItemId.Book)).toBe(3);
    expect(readBookContent(a.player.inventory.getSlot(0)!)?.pages).toEqual(['First page', 'Second page']);
    expect(a.player.inventory.serialize().slots[0]?.metadata?.book).toMatchObject({ title: 'Guide' });
    world.updateBook(a.player, { type: 'book_update', slot: 0, pages: ['x'.repeat(1025)] });
    expect(a.sink.last('error')?.code).toBe('book_invalid');
    expect(readBookContent(a.player.inventory.getSlot(0)!)?.pages).toEqual(['First page', 'Second page']);
    a.player.selectedSlot = 1;
    world.updateBook(a.player, { type: 'book_update', slot: 0, pages: ['forged'] });
    expect(readBookContent(a.player.inventory.getSlot(0)!)?.pages).toEqual(['First page', 'Second page']);
  });

  it('applies sign text only after the playerInteract permission check', async () => {
    const { world, add } = await boot();
    const a = add('Writer');
    world.world.setBlock(8, 89, 9, BlockId.Stone);
    world.world.setBlock(8, 90, 9, BlockId.OakSign);
    const cancel = world.events.on('playerInteract', (event) => event.cancel());
    world.updateSign(a.player, { type: 'sign_update', x: 8, y: 90, z: 9,
      lines: ['Denied', '', '', ''] });
    expect(world.world.signText(8, 90, 9)).toBeUndefined();
    cancel();
    world.updateSign(a.player, { type: 'sign_update', x: 8, y: 90, z: 9,
      lines: ['One', 'Two', 'Three', 'Four'] });
    expect(world.world.signText(8, 90, 9)).toEqual(['One', 'Two', 'Three', 'Four']);
    world.updateSign(a.player, { type: 'sign_update', x: 8, y: 90, z: 9,
      lines: ['x'.repeat(33), '', '', ''] });
    expect(a.sink.last('error')?.code).toBe('sign_invalid');
    expect(world.world.signText(8, 90, 9)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('launches metadata-flight rockets on the server and sends them to another player', async () => {
    const { world, add } = await boot();
    const a = add('Launcher');
    const b = add('Watcher');
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.FireworkRocket, 2,
      { metadata: { firework: { flight: 3 } } }));
    a.player.selectedSlot = 0;
    expect(world.interact(a.player, undefined, undefined, undefined, 0)).toEqual({ ok: true });
    expect(a.player.inventory.getSlot(0)?.count).toBe(1);
    expect(world.gameplay.fireworks.entities[0]?.flight).toBe(3);
    world.tick();
    const snapshot = b.sink.last('entity_snapshot') as { entities?: Array<{ kind: string; variant?: string }> } | undefined;
    expect(snapshot?.entities?.some((entity) => entity.kind === 'firework' && entity.variant === '3')).toBe(true);
    for (let i = 0; i < 70; i += 1) world.tick();
    expect(world.gameplay.fireworks.entities).toHaveLength(0);
    expect(world.gameplay.persistEntities()).not.toHaveProperty('fireworks');
  });

  it('fires WH ammo through the ordinary bow and preserves its projectile variant', async () => {
    const { world, add } = await boot();
    const a = add('Archer');
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.Bow));
    a.player.inventory.setSlot(1, createItemStack(ItemId.WHArrow, 2));
    a.player.selectedSlot = 0;
    a.player.bowUseTicks = 20;
    expect(world.gameplay.releaseBowWithAim(a.player, Math.PI, 0)).toMatchObject({ ok: true });
    expect(world.gameplay.arrows.entities.at(-1)?.kind).toBe('wh');
    expect(a.player.inventory.count(ItemId.WHArrow)).toBe(1);
  });

  it('marks only after an accepted WH projectile hit, not a cancelled PvP hit', async () => {
    const { world, add } = await boot();
    const a = add('Attacker');
    const b = add('Victim');
    a.player.controller.teleport([70.5, 100, 70.5]);
    b.player.controller.teleport([70.5, 100, 72.5]);
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.Bow));
    a.player.inventory.setSlot(1, createItemStack(ItemId.WHArrow, 2));
    a.player.selectedSlot = 0;
    const pitch = Math.atan2(-0.72, 2);
    const cancel = world.events.on('playerDamage', (event) => event.cancel());
    a.player.bowUseTicks = 20;
    expect(world.gameplay.releaseBowWithAim(a.player, Math.PI, pitch)).toMatchObject({ ok: true });
    world.tick();
    expect(world.gameplay.whMarks.forViewer(a.player.id, world.tickNumber)).toEqual([]);
    cancel();
    a.player.bowUseTicks = 20;
    expect(world.gameplay.releaseBowWithAim(a.player, Math.PI, pitch)).toMatchObject({ ok: true });
    world.tick();
    expect(b.player.survival.health).toBeLessThan(20);
    expect(world.gameplay.whMarks.forViewer(a.player.id, world.tickNumber)).toEqual([b.player.id]);
  });

  it('drinks milk through the 32-tick server use and clears every viewer mark', async () => {
    const { world, add } = await boot();
    const a = add('Drinker');
    const b = add('ViewerB');
    const c = add('ViewerC');
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.MilkBucket));
    a.player.selectedSlot = 0;
    a.player.survival.applyEffect({ id: 'invisibility', amplifier: 0, durationTicks: 200 });
    a.player.survival.applyEffect({ id: 'absorption', amplifier: 0, durationTicks: 200 });
    world.gameplay.whMarks.mark(b.player.id, a.player.id, world.tickNumber);
    world.gameplay.whMarks.mark(c.player.id, a.player.id, world.tickNumber);
    world.applyInput(a.player, {
      type: 'input', seq: 1, forward: 0, right: 0, jump: false, sneak: false, sprint: false,
      descend: false, flySprint: false, yaw: 0, pitch: 0, selectedSlot: 0, use: true, mining: false,
    });
    expect(world.interact(a.player, undefined, undefined, 1, 0)).toEqual({ ok: true });
    for (let i = 0; i < 34; i += 1) world.tick();
    expect(a.player.inventory.count(ItemId.MilkBucket)).toBe(0);
    expect(a.player.inventory.count(ItemId.Bucket)).toBe(1);
    expect(a.player.survival.activeEffects()).toEqual([]);
    expect(a.player.survival.absorption).toBe(0);
    expect(world.gameplay.whMarks.forViewer(b.player.id, world.tickNumber)).toEqual([]);
    expect(world.gameplay.whMarks.forViewer(c.player.id, world.tickNumber)).toEqual([]);
  });

  it('consumes selected mainhand Totem before offhand and clears WH without a death', async () => {
    const { world, add } = await boot();
    const a = add('Protected');
    const b = add('Viewer');
    a.player.inventory.clear();
    a.player.inventory.setSlot(0, createItemStack(ItemId.TotemOfUndying));
    a.player.inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.TotemOfUndying));
    a.player.selectedSlot = 0;
    world.gameplay.whMarks.mark(b.player.id, a.player.id, world.tickNumber);
    const deaths: string[] = [];
    world.events.on('entityDeath', (event) => deaths.push(event.entityId));
    expect(a.player.survival.damage(40, 'fall', { ignoreInvulnerability: true }).deathProtected).toBe(true);
    expect(a.player.inventory.getSlot(0)).toBeNull();
    expect(a.player.inventory.offhand?.itemId).toBe(ItemId.TotemOfUndying);
    expect(a.player.survival.health).toBe(1);
    expect(a.player.survival.dead).toBe(false);
    world.tick();
    expect(a.sink.last('totem_activate')).toEqual({ type: 'totem_activate' });
    expect(world.gameplay.whMarks.forViewer(b.player.id, world.tickNumber)).toEqual([]);
    expect(deaths).toEqual([]);
  });

  it('replicates offhand Totem and delivers one positional activation cue to nearby players', async () => {
    const { world, add } = await boot();
    const protectedPlayer = add('Protected');
    const observer = add('Nearby');
    const distant = add('Distant');
    distant.player.controller.teleport([70.5, 100, 70.5]);
    protectedPlayer.player.inventory.clear();
    protectedPlayer.player.inventory.setSlot(0, createItemStack(ItemId.DiamondSword));
    protectedPlayer.player.inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.TotemOfUndying));
    protectedPlayer.player.selectedSlot = 0;
    world.tick();
    const playerState = observer.sink.last('player_state') as {
      players?: Array<{ id: string; presentation?: { heldItemId: string | null; offhandItemId?: string | null } }>;
    };
    expect(playerState.players?.find((player) => player.id === protectedPlayer.player.id)?.presentation)
      .toMatchObject({ heldItemId: ItemId.DiamondSword, offhandItemId: ItemId.TotemOfUndying });

    expect(protectedPlayer.player.survival.damage(40, 'fall', { ignoreInvulnerability: true }).deathProtected).toBe(true);
    world.tick();
    const totemCues = (sink: MemorySink) => sink.payloads.flatMap((payload) =>
      payload.type === 'world_sound' && Array.isArray(payload.sounds)
        ? payload.sounds.filter((sound) => (sound as { event?: string }).event === 'totem.activate')
        : []);
    expect(totemCues(protectedPlayer.sink)).toHaveLength(1);
    expect(totemCues(observer.sink)).toHaveLength(1);
    expect(totemCues(distant.sink)).toHaveLength(0);
    expect(protectedPlayer.sink.payloads.filter((payload) => payload.type === 'totem_activate')).toHaveLength(1);
    expect(protectedPlayer.player.presentation().offhandItemId).toBeNull();
  });

  it('uses an offhand Totem but never one in an unselected inventory slot', async () => {
    const { add } = await boot();
    const a = add('Offhand');
    a.player.inventory.clear();
    a.player.inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.TotemOfUndying));
    a.player.selectedSlot = 0;
    expect(a.player.survival.damage(40, 'fall', { ignoreInvulnerability: true }).deathProtected).toBe(true);
    expect(a.player.inventory.offhand).toBeNull();
    const b = add('Unselected');
    b.player.inventory.clear();
    b.player.inventory.setSlot(1, createItemStack(ItemId.TotemOfUndying));
    b.player.selectedSlot = 0;
    expect(b.player.survival.damage(40, 'fall', { ignoreInvulnerability: true }).killed).toBe(true);
    expect(b.player.inventory.getSlot(1)?.itemId).toBe(ItemId.TotemOfUndying);
  });
});
