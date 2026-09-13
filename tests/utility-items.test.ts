import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { getCraftingResult } from '../src/crafting';
import { placeBlockAt, performUseHeld, type UseSimulationContext } from '../src/gameplay';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemId, getItemDefinition } from '../src/items';
import { readBookContent, sanitizeBookDraft, writeBookInSlot } from '../src/items/book';
import { fillBucketWithMilk } from '../src/items/bucketInteraction';
import { FireworkManager, fireworkFlight } from '../src/entities/FireworkManager';
import { FarmingSystem } from '../src/farming';
import { VhMarks } from '../src/combat/VhMarks';
import { SurvivalSystem } from '../src/survival/SurvivalSystem';
import { clearBedBlocks, bedHeadCell } from '../src/world/bed';
import { canSugarCaneStandAt } from '../src/world/placement';
import { sanitizeSignLines } from '../src/world/sign';
import { VoxelWorld } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';

function placement(block: BlockId, yaw = 0) {
  const world = new VoxelWorld('utility-placement');
  const inventory = new Inventory();
  inventory.setSlot(0, createItemStack(block === BlockId.WhiteBed ? 'white_bed' : 'oak_sign', 8));
  const ctx = {
    world, inventory, selectedSlot: 0, gamemode: 'survival', yaw,
    reach: 5,
    viewDirection: () => new THREE.Vector3(0, 0, -1),
    eyePosition: () => new THREE.Vector3(5.5, 92, 5.5),
    intersectsBlock: () => false,
    intersectsCollisionBoxes: () => false,
    minecarts: { raycast: () => undefined },
    redstone: { notifyBlockChanged: () => undefined },
  } as unknown as UseSimulationContext;
  return { world, inventory, ctx };
}

describe('utility recipes and metadata', () => {
  it('crafts paper, books and signs from the intended ingredients', () => {
    expect(getCraftingResult(['sugar_cane', 'sugar_cane', 'sugar_cane', null, null, null, null, null, null]))
      .toEqual({ itemId: ItemId.Paper, count: 3 });
    expect(getCraftingResult([ItemId.Paper, ItemId.Paper, ItemId.Paper, ItemId.Leather, null, null, null, null, null]))
      .toEqual({ itemId: ItemId.Book, count: 1 });
    expect(getCraftingResult(['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks',
      null, ItemId.Stick, null])).toEqual({ itemId: 'oak_sign', count: 3 });
  });

  it.each([1, 2, 3] as const)('crafts three flight-%i rockets and preserves the flight in metadata', (flight) => {
    const grid = [ItemId.Paper, ...Array.from({ length: flight }, () => ItemId.Gunpowder),
      ...Array.from({ length: 9 - flight - 1 }, () => null)];
    const result = getCraftingResult(grid);
    expect(result).toMatchObject({ itemId: ItemId.FireworkRocket, count: 3,
      metadata: { firework: { flight } } });
  });

  it('crafts four VH arrows with the expensive recipe', () => {
    const grid = [ItemId.Arrow, ItemId.Arrow, ItemId.Arrow, ItemId.Arrow,
      'glowstone', ItemId.Diamond, ItemId.RedstoneDust, ItemId.RedstoneDust, null];
    expect(getCraftingResult(grid)).toEqual({ itemId: ItemId.VHArrow, count: 4 });
  });

  it('keeps different rocket flights in different inventory stacks', () => {
    const inventory = new Inventory();
    inventory.add(createItemStack(ItemId.FireworkRocket, 3, { metadata: { firework: { flight: 1 } } }));
    inventory.add(createItemStack(ItemId.FireworkRocket, 3, { metadata: { firework: { flight: 3 } } }));
    expect(inventory.slots.filter((slot) => slot?.itemId === ItemId.FireworkRocket)).toHaveLength(2);
  });
});

describe('book and sign text', () => {
  it('splits one edited book from a blank stack and survives inventory serialization', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Book, 4));
    expect(writeBookInSlot(inventory, 0, { pages: ['Привет', 'Page 2'], title: 'Notes' })).toBeNull();
    expect(inventory.getSlot(0)?.count).toBe(1);
    expect(inventory.count(ItemId.Book)).toBe(4);
    const restored = Inventory.deserialize(inventory.serialize());
    expect(readBookContent(restored.getSlot(0)!)).toMatchObject({ pages: ['Привет', 'Page 2'], title: 'Notes' });
  });

  it('rejects oversized drafts and strips controls without interpreting markup', () => {
    expect(sanitizeBookDraft({ pages: Array.from({ length: 33 }, () => '') })).toBeUndefined();
    expect(sanitizeBookDraft({ pages: ['x'.repeat(1025)] })).toBeUndefined();
    expect(sanitizeBookDraft({ pages: ['<b>hi</b>\u0000'] })?.pages).toEqual(['<b>hi</b>']);
    expect(sanitizeSignLines(['A\u0000', 'B', 'C', 'D'])).toEqual(['A', 'B', 'C', 'D']);
    expect(sanitizeSignLines(['x'.repeat(33), '', '', ''])).toBeUndefined();
  });

  it('never edits a locked book', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Book, 1, { metadata: { book: { pages: ['locked'], locked: true } } }));
    expect(writeBookInSlot(inventory, 0, { pages: ['changed'] })).toBeUndefined();
    expect(readBookContent(inventory.getSlot(0)!)?.pages).toEqual(['locked']);
  });

  it('persists sign text and deletes it when the sign block breaks', () => {
    const world = new VoxelWorld('sign-save');
    world.setBlock(5, 90, 5, BlockId.OakSign);
    expect(world.setSignText(5, 90, 5, ['one', 'two', 'three', 'four'])).toBe(true);
    const restored = new VoxelWorld('sign-save');
    restored.restore({ timeOfDay: world.timeOfDay,
      modifications: Object.fromEntries([...world.modifications].map(([key, values]) => [key, Object.fromEntries(values)])),
      chests: {}, furnaces: {}, blockStates: {}, signs: world.serializeSigns() });
    expect(restored.signText(5, 90, 5)).toEqual(['one', 'two', 'three', 'four']);
    restored.setBlock(5, 90, 5, BlockId.Air);
    expect(restored.signText(5, 90, 5)).toBeUndefined();
  });
});

describe('decorative blocks', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('places and removes both bed halves at yaw %f', (yaw) => {
    const { world, inventory, ctx } = placement(BlockId.WhiteBed, yaw);
    const x = 5, y = 90, z = 5;
    const facing = ['north', 'east', 'south', 'west'] as const;
    for (const dir of facing) {
      const head = bedHeadCell(x, y, z, dir);
      world.setBlock(head.x, y - 1, head.z, BlockId.Stone);
    }
    world.setBlock(x, y - 1, z, BlockId.Stone);
    expect(placeBlockAt(ctx, x, y, z, BlockId.WhiteBed).ok).toBe(true);
    const footState = world.getBlockState(x, y, z)!;
    const head = bedHeadCell(x, y, z, footState.facing!);
    expect(world.getBlock(head.x, y, head.z, false)).toBe(BlockId.WhiteBed);
    expect(world.getBlockState(head.x, y, head.z)?.bedPart).toBe('head');
    expect(inventory.getSlot(0)?.count).toBe(7);
    expect(clearBedBlocks(world, head.x, y, head.z)).toBe(2);
    expect(world.getBlock(x, y, z, false)).toBe(BlockId.Air);
  });

  it('rejects an occupied bed head without consuming anything', () => {
    const { world, inventory, ctx } = placement(BlockId.WhiteBed);
    world.setBlock(5, 89, 5, BlockId.Stone);
    for (const dir of ['north', 'south', 'east', 'west'] as const) {
      const head = bedHeadCell(5, 90, 5, dir);
      world.setBlock(head.x, 89, head.z, BlockId.Stone);
      world.setBlock(head.x, 90, head.z, BlockId.Stone);
    }
    expect(placeBlockAt(ctx, 5, 90, 5, BlockId.WhiteBed).ok).toBe(false);
    expect(world.getBlock(5, 90, 5, false)).toBe(BlockId.Air);
    expect(inventory.getSlot(0)?.count).toBe(8);
  });

  it('detaches both bed halves with one drop event when support disappears', () => {
    const { world, ctx } = placement(BlockId.WhiteBed);
    world.setBlock(5, 89, 5, BlockId.Stone);
    for (const dir of ['north', 'south', 'east', 'west'] as const) {
      const head = bedHeadCell(5, 90, 5, dir);
      world.setBlock(head.x, 89, head.z, BlockId.Stone);
    }
    expect(placeBlockAt(ctx, 5, 90, 5, BlockId.WhiteBed).ok).toBe(true);
    const facing = world.getBlockState(5, 90, 5)!.facing!;
    const head = bedHeadCell(5, 90, 5, facing);
    world.setBlock(5, 89, 5, BlockId.Air);
    world.processSupportIntegrity();
    expect(world.getBlock(5, 90, 5, false)).toBe(BlockId.Air);
    expect(world.getBlock(head.x, 90, head.z, false)).toBe(BlockId.Air);
    expect(world.consumeDetachedBlocks().filter((event) => event.block === BlockId.WhiteBed)).toHaveLength(1);
  });

  it('orients floor and wall signs using the clicked face', () => {
    const floor = placement(BlockId.OakSign, Math.PI / 2);
    floor.world.setBlock(5, 89, 5, BlockId.Stone);
    const floorHit = { x: 5, y: 89, z: 5, block: BlockId.Stone,
      normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(5.5, 90, 5.5), distance: 2 };
    expect(placeBlockAt(floor.ctx, 5, 90, 5, BlockId.OakSign, floorHit).ok).toBe(true);
    expect(floor.world.getBlockState(5, 90, 5)).toMatchObject({ attachment: 'floor', signRotation: 4 });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const wall = placement(BlockId.OakSign);
      wall.world.setBlock(5 - dx!, 90, 5 - dz!, BlockId.Stone);
      const hit = { x: 5 - dx!, y: 90, z: 5 - dz!, block: BlockId.Stone,
        normal: new THREE.Vector3(dx!, 0, dz!), point: new THREE.Vector3(5.5, 90.5, 5.5), distance: 2 };
      expect(placeBlockAt(wall.ctx, 5, 90, 5, BlockId.OakSign, hit).ok).toBe(true);
      expect(wall.world.getBlockState(5, 90, 5)).toMatchObject({ attachment: 'wall' });
    }
  });

  it('bed use leaves the spawn point and world time unchanged', () => {
    const { world, ctx } = placement(BlockId.WhiteBed);
    world.setBlock(5, 90, 5, BlockId.WhiteBed);
    const beforeTime = world.timeOfDay;
    const survival = new SurvivalSystem();
    const beforeSpawn = [...survival.spawnPoint];
    performUseHeld({ ...ctx, hit: { x: 5, y: 90, z: 5, block: BlockId.WhiteBed,
      normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(5.5, 90.5, 5.5), distance: 2 } });
    expect(survival.spawnPoint).toEqual(beforeSpawn);
    expect(world.timeOfDay).toBe(beforeTime);
  });

  it('requires wet soil for base cane', () => {
    const world = new VoxelWorld('cane');
    world.setBlock(5, 89, 5, BlockId.Sand);
    expect(canSugarCaneStandAt(world, 5, 90, 5)).toBe(false);
    world.setBlock(6, 89, 5, BlockId.Water);
    expect(canSugarCaneStandAt(world, 5, 90, 5)).toBe(true);
  });

  it('grows wet sugar cane only to three blocks on fixed farming pulses', () => {
    const world = new VoxelWorld('cane-growth');
    world.chunks.set('0,0', new Chunk(0, 0));
    world.setViewCenter(0, 0, 0);
    world.setBlock(5, 89, 5, BlockId.Sand);
    world.setBlock(6, 89, 5, BlockId.Water);
    world.setBlock(5, 90, 5, BlockId.SugarCane);
    const farming = new FarmingSystem(world, { random: () => 0 });
    for (const tick of [1_200, 2_400, 3_600]) {
      world.tickNumber = tick;
      farming.tick();
    }
    expect(world.getBlock(5, 90, 5, false)).toBe(BlockId.SugarCane);
    expect(world.getBlock(5, 91, 5, false)).toBe(BlockId.SugarCane);
    expect(world.getBlock(5, 92, 5, false)).toBe(BlockId.SugarCane);
    expect(world.getBlock(5, 93, 5, false)).toBe(BlockId.Air);
    farming.dispose();
  });
});

describe('milk, rockets, VH marks and totem', () => {
  it('fills a bucket and clears every active status effect on drinking', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.Bucket));
    expect(fillBucketWithMilk({ inventory, selectedSlot: 0, mode: 'survival', onDrop: () => undefined })).toBe(true);
    expect(inventory.getSlot(0)?.itemId).toBe(ItemId.MilkBucket);
    const survival = new SurvivalSystem();
    for (const id of ['invisibility', 'regeneration', 'absorption', 'fire_resistance'] as const) {
      survival.applyEffect({ id, amplifier: 0, durationTicks: 100 });
    }
    survival.restore({ fireTicks: 50 });
    expect(survival.consumeFood(getItemDefinition(ItemId.MilkBucket) as never, inventory)).toBe(true);
    expect(inventory.count(ItemId.Bucket)).toBe(1);
    expect(survival.activeEffects()).toEqual([]);
    expect(survival.absorption).toBe(0);
    expect(survival.fireTicks).toBe(50);
  });

  it('runs longer for flight 3, bursts once, and never mutates the world', () => {
    const manager = new FireworkManager();
    const one = manager.spawn({ x: 0, y: 70, z: 0 }, 1);
    const three = manager.spawn({ x: 1, y: 70, z: 0 }, 3);
    expect(three.fuseTicks).toBeGreaterThan(one.fuseTicks);
    expect(fireworkFlight({ firework: { flight: 3 } })).toBe(3);
    for (let i = 0; i < one.fuseTicks; i += 1) manager.tick();
    expect(one.exploded).toBe(true);
    expect(three.exploded).toBe(false);
    for (let i = 0; i < 10; i += 1) manager.tick();
    expect(three.position.y).toBeGreaterThan(one.position.y);
    expect(manager.entities).not.toContain(one);
    for (let i = 0; i < 80; i += 1) manager.spawn({ x: i, y: 70, z: 0 }, 1);
    expect(manager.entities.length).toBeLessThanOrEqual(manager.cap);
  });

  it('isolates marks per shooter, refreshes and expires at exactly 200 ticks', () => {
    const marks = new VhMarks();
    marks.mark('A', 'B', 10);
    expect(marks.forViewer('C', 10)).toEqual([]);
    expect(marks.forViewer('A', 209)).toEqual(['B']);
    marks.mark('A', 'B', 209);
    expect(marks.forViewer('A', 210)).toEqual(['B']);
    expect(marks.forViewer('A', 409)).toEqual([]);
    marks.mark('A', 'B', 410);
    marks.mark('C', 'B', 410);
    marks.clearTarget('B');
    expect(marks.forViewer('A', 410)).toEqual([]);
    expect(marks.forViewer('C', 410)).toEqual([]);
  });

  it('intercepts ordinary lethal damage before death and grants exact Totem effects', () => {
    const inventory = new Inventory();
    inventory.setSlot(0, createItemStack(ItemId.TotemOfUndying));
    const survival = new SurvivalSystem();
    survival.applyEffect({ id: 'invisibility', amplifier: 0, durationTicks: 100 });
    survival.setDeathProtection(() => inventory.remove(ItemId.TotemOfUndying, 1) === 1);
    const damage = survival.damage(40, 'explosion', { ignoreInvulnerability: true });
    expect(damage.deathProtected).toBe(true);
    expect(damage.killed).toBe(false);
    expect(survival.health).toBe(1);
    expect(inventory.count(ItemId.TotemOfUndying)).toBe(0);
    expect(survival.hasEffect('invisibility')).toBe(false);
    expect(survival.activeEffects()).toEqual(expect.arrayContaining([
      { id: 'regeneration', amplifier: 1, ticks: 900 },
      { id: 'fire_resistance', amplifier: 0, ticks: 800 },
      { id: 'absorption', amplifier: 1, ticks: 100 },
    ]));
    expect(survival.damage(4, 'lava').accepted).toBe(false);
    const restored = new SurvivalSystem();
    restored.restore(survival.serialize());
    expect(restored.hasEffect('fire_resistance')).toBe(true);
  });

  it('keeps fire resistance through serialization and resumes fire damage after expiry', () => {
    const original = new SurvivalSystem();
    original.applyEffect({ id: 'fire_resistance', amplifier: 0, durationTicks: 2 });
    const restored = new SurvivalSystem();
    restored.restore(original.serialize());
    expect(restored.damage(3, 'fire', { ignoreInvulnerability: true }).ignored).toBe(true);
    expect(restored.damage(3, 'lava', { ignoreInvulnerability: true }).ignored).toBe(true);
    restored.tick(0.05, { difficulty: 'peaceful' });
    restored.tick(0.05, { difficulty: 'peaceful' });
    expect(restored.hasEffect('fire_resistance')).toBe(false);
    expect(restored.damage(3, 'fire', { ignoreInvulnerability: true }).dealt).toBeGreaterThan(0);
  });

  it('never uses a Totem for void damage', () => {
    const survival = new SurvivalSystem();
    let calls = 0;
    survival.setDeathProtection(() => { calls += 1; return true; });
    expect(survival.damage(40, 'void', { ignoreInvulnerability: true }).killed).toBe(true);
    expect(calls).toBe(0);
  });
});
