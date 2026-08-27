import * as THREE from 'three';
import gameSource from '../src/core/Game.ts?raw';
import combatSource from '../src/combat/CombatSystem.ts?raw';
import firstPersonSource from '../src/rendering/FirstPersonRenderer.ts?raw';
import itemTypesSource from '../src/items/types.ts?raw';
import registrySource from '../src/items/registry.ts?raw';
import profilesSource from '../src/items/itemRenderProfiles.ts?raw';
import { describe, expect, it } from 'vitest';
import { Inventory, createItemStack } from '../src/inventory';
import { restoreBucketInventory } from '../src/items/bucketInteraction';
import { VoxelWorld } from '../src/world/World';
import { DroppedItemManager } from '../src/entities/DroppedItemManager';
import { Game } from '../src/core/Game';
import { SurvivalSystem } from '../src/survival';

const obsolete = { itemId: 'shield', count: 1, durability: 123 };

describe('removed shield migration and damage', () => {
  it('clears only obsolete player/offhand/armor stacks and keeps metadata and bucket migration', () => {
    const base = new Inventory().serialize();
    const tool = { ...createItemStack('iron_pickaxe'), durability: 120, metadata: { name: 'keep me' } };
    const slots = [...base.slots];
    slots[0] = obsolete; slots[1] = tool; slots[2] = { itemId: 'bucket', count: 32 };
    const saved = { ...base, slots, offhand: obsolete, armor: { ...base.armor, head: obsolete } };
    const restored = restoreBucketInventory(saved);
    expect(restored.inventory.getSlot(1)).toEqual(tool);
    expect(restored.inventory.offhand).toBeNull();
    expect(restored.inventory.armor.head).toBeNull();
    expect(restored.inventory.serialize().slots.some((stack) => stack?.itemId === 'shield')).toBe(false);
    expect(restored.inventory.slots.filter((stack) => stack?.itemId === 'bucket').reduce((sum, stack) => sum + stack!.count, 0)).toBe(32);
    expect(restored.overflow).toEqual([]);
    expect(saved.slots[0]).toEqual(obsolete);
    expect(saved.slots[2]?.count).toBe(32);
    const bad = [...base.slots]; bad[0] = { itemId: 'not-a-real-item', count: 1 };
    expect(() => Inventory.deserialize({ ...base, slots: bad })).toThrow();
  });

  it('clears only removed stacks from chests/furnaces without altering timers or the input save', () => {
    const world = new VoxelWorld('migration');
    const saved = { timeOfDay: 1200, modifications: {},
      chests: { '1,40,1': { slots: [obsolete, createItemStack('diamond', 12), null] } },
      furnaces: { '2,40,1': { slots: [obsolete, createItemStack('coal', 4), createItemStack('iron_ingot', 3)],
        burnTime: 55, burnTotal: 80, cookTime: 20 } } };
    world.restore(saved);
    expect(world.chests.get('1,40,1')?.slots).toEqual([null, createItemStack('diamond', 12), null]);
    expect(world.furnaces.get('2,40,1')).toEqual({ ...saved.furnaces['2,40,1'],
      slots: [null, createItemStack('coal', 4), createItemStack('iron_ingot', 3)] });
    expect(saved.chests['1,40,1'].slots[0]).toEqual(obsolete);
  });

  it('skips obsolete drops, retaining other stacks and environment health', () => {
    const manager = new DroppedItemManager(new THREE.Scene(), new VoxelWorld('drop-migration'));
    const shared = { position: [5, 40, 5] as const, velocity: [0, 0, 0] as const, ageSeconds: 2, pickupDelaySeconds: 0 };
    expect(manager.restore([{ ...shared, id: 'removed', stack: obsolete },
      { ...shared, id: 'keep', stack: createItemStack('coal', 3), environmentHealth: 2 }])).toBe(1);
    expect(manager.serialize()).toMatchObject([{ id: 'keep', stack: { itemId: 'coal', count: 3 }, environmentHealth: 2 }]);
    manager.dispose();
  });

  it.each(['melee', 'arrow'])('sends %s damage and full knockback through Game regardless of use/held item', (source) => {
    for (const item of [undefined, 'iron_sword', 'iron_axe', 'bow']) {
      const inventory = new Inventory();
      if (item) inventory.setSlot(0, createItemStack(item));
      inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack('iron_chestplate'));
      const survival = new SurvivalSystem(), reference = new SurvivalSystem();
      const knockback = new THREE.Vector3(3, 2, -1), velocity = new THREE.Vector3();
      const game = Object.create(Game.prototype) as any;
      Object.assign(game, { input: { using: true }, session: { summary: { mode: 'survival' },
        inventory, survival, player: { velocity }, selectedSlot: 0 } });
      const expected = reference.damage(6, source === 'arrow' ? 'projectile' : 'melee', { armor: inventory.clone() });
      game.damagePlayerFromMob({ source, amount: 6, position: new THREE.Vector3(), knockback });
      expect(survival.health).toBe(20 - expected.dealt);
      expect(velocity).toEqual(knockback);
    }
  });

  it('has no runtime shield branch, pose, movement modifier or combat export', () => {
    for (const source of [gameSource, combatSource, firstPersonSource, itemTypesSource, registrySource, profilesSource]) {
      expect(source).not.toMatch(/shield/i);
    }
    expect(gameSource).toContain('const movementMultiplier = drawingBow ? 0.2 : 1');
    expect(gameSource).toContain('this.input.using');
  });
});
