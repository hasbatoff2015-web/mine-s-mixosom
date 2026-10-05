import { describe, expect, it } from 'vitest';
import { CRAFTING_RECIPES, SMELTING_RECIPES } from '../src/crafting';
import { getAttackProfile } from '../src/combat';
import { resolveItemId } from '../src/chat/commands';
import { consumeOffhandTotem } from '../src/gameplay/totemDeathProtection';
import { displayNameFor } from '../src/i18n';
import { createItemStack, damageItem, Inventory, parseSerializedItemStack } from '../src/inventory';
import {
  ItemId,
  classifyItemForRendering,
  classifyThirdPersonItemPose,
  getItemDefinition,
  isSwordItem,
  itemHeldMeshKind,
  itemRenderProfile,
  itemUsesSpecialHeldModel,
  losesDurabilityWhenBreakingBlocks,
  obtainableItems,
  thirdPersonItemPose,
  tryGetItemDefinition,
} from '../src/items';
import { MOB_DEFINITIONS } from '../src/entities/mobDefinitions';
import { SurvivalSystem } from '../src/survival/SurvivalSystem';

describe('God Sword registry', () => {
  it('registers a hidden one-use sword outside the material tiers', () => {
    expect(ItemId.GodSword).toBe('god_sword');
    const item = getItemDefinition(ItemId.GodSword);
    expect(item).toMatchObject({
      id: 'god_sword',
      kind: 'weapon',
      weapon: 'sword',
      maxStack: 1,
      durability: 1,
      attackDamage: 10,
      texture: 'item/god_sword',
      hiddenFromGameplay: true,
      name: 'Меч бога',
      description: 'Смертельный удар. Спасает только тотем бессмертия. Одноразовый.',
    });
    expect(item.kind === 'weapon' && item.tier).toBeUndefined();
    expect(item.tags).toEqual(['weapon', 'sword', 'special', 'god_sword']);
    expect(isSwordItem(ItemId.GodSword)).toBe(true);
    expect(displayNameFor(ItemId.GodSword, 'en')).toBe('God Sword');
    expect(obtainableItems().some((entry) => entry.id === ItemId.GodSword)).toBe(false);
    expect(resolveItemId('god_sword')).toBe(ItemId.GodSword);
    expect(resolveItemId('minecraft:god_sword')).toBe(ItemId.GodSword);
    expect(getAttackProfile(ItemId.GodSword)).toMatchObject({
      baseDamage: 10,
      weapon: 'sword',
      durabilityCost: 1,
    });
    expect(getAttackProfile(ItemId.TitaniumSword).baseDamage).toBe(10);
    expect(getAttackProfile(ItemId.RubySword).baseDamage).toBe(9);
    expect(getAttackProfile(ItemId.DiamondSword).baseDamage).toBe(8);
  });

  it('is absent from crafting, smelting, and mob loot', () => {
    expect(CRAFTING_RECIPES.some((recipe) => recipe.output.item === ItemId.GodSword)).toBe(false);
    expect(SMELTING_RECIPES.some((recipe) => recipe.output.item === ItemId.GodSword)).toBe(false);
    for (const definition of Object.values(MOB_DEFINITIONS)) {
      expect(definition.loot.some((entry) => entry.itemId === ItemId.GodSword)).toBe(false);
    }
  });

  it('uses the same sword presentation as a titanium sword', () => {
    expect(classifyItemForRendering(ItemId.GodSword)).toBe(classifyItemForRendering(ItemId.TitaniumSword));
    expect(classifyItemForRendering(ItemId.GodSword)).toBe('handheld');
    expect(classifyThirdPersonItemPose(ItemId.GodSword)).toBe('sword');
    expect(thirdPersonItemPose(ItemId.GodSword)).toEqual(thirdPersonItemPose(ItemId.TitaniumSword));
    expect(itemRenderProfile(ItemId.GodSword)).toEqual(itemRenderProfile(ItemId.TitaniumSword));
    expect(itemHeldMeshKind(ItemId.GodSword)).toBe('generated');
    expect(itemUsesSpecialHeldModel(ItemId.GodSword)).toBe(false);
    expect(itemRenderProfile(ItemId.GodSword).transforms.firstPersonRightHand.scale).toEqual(
      itemRenderProfile(ItemId.TitaniumSword).transforms.firstPersonRightHand.scale,
    );
  });

  it('breaks after one combat point of durability, including a stack that omitted the field', () => {
    const fresh = createItemStack(ItemId.GodSword);
    expect(fresh.durability).toBeUndefined();
    expect(damageItem(fresh, 1)).toBeNull();
    const restored = parseSerializedItemStack({ itemId: ItemId.GodSword, count: 1 });
    expect(restored?.durability).toBeUndefined();
    expect(damageItem(restored!, 1)).toBeNull();
    expect(losesDurabilityWhenBreakingBlocks(tryGetItemDefinition(ItemId.GodSword))).toBe(false);
    expect(losesDurabilityWhenBreakingBlocks(tryGetItemDefinition(ItemId.TitaniumSword))).toBe(true);
    expect(losesDurabilityWhenBreakingBlocks(tryGetItemDefinition(ItemId.DiamondPickaxe))).toBe(true);
  });
});

describe('forceLethal damage contract', () => {
  function armored(): Inventory {
    const inventory = new Inventory();
    inventory.setSlot({ section: 'armor', slot: 'head' }, createItemStack(ItemId.TitaniumHelmet, 1, { durability: 100 }));
    inventory.setSlot({ section: 'armor', slot: 'chest' }, createItemStack(ItemId.TitaniumChestplate, 1, { durability: 100 }));
    inventory.setSlot({ section: 'armor', slot: 'legs' }, createItemStack(ItemId.TitaniumLeggings, 1, { durability: 100 }));
    inventory.setSlot({ section: 'armor', slot: 'feet' }, createItemStack(ItemId.TitaniumBoots, 1, { durability: 100 }));
    return inventory;
  }

  it('removes current health without inflating the requested amount or wearing armor', () => {
    const inventory = armored();
    const survival = new SurvivalSystem();
    survival.applyEffect({ id: 'absorption', amplifier: 1, durationTicks: 200 });
    survival.hurtResistance.receive(6);
    expect(survival.hurtResistance.remainingTicks).toBeGreaterThan(10);
    expect(survival.health).toBe(20);
    expect(survival.absorption).toBe(8);
    const heard: string[] = [];
    survival.addDamageListener((result) => heard.push(`${result.source}:${result.dealt}`));
    let died = false;
    const result = survival.damage(10, 'melee', {
      armor: inventory,
      swordBlocking: true,
      forceLethal: true,
      onDeath: () => { died = true; },
    });
    expect(result).toMatchObject({
      source: 'melee',
      requested: 10,
      dealt: 20,
      absorbed: 0,
      killed: true,
      accepted: true,
    });
    expect(result.deathProtected).toBeUndefined();
    expect(result.armorWorn).toBeUndefined();
    expect(result.dealt).toBeLessThan(100);
    expect(survival.dead).toBe(true);
    expect(survival.health).toBe(0);
    expect(died).toBe(true);
    expect(heard).toEqual(['melee:20']);
    expect(inventory.getSlot({ section: 'armor', slot: 'chest' })?.durability).toBe(100);
  });

  it('still reaches the existing offhand Totem protection', () => {
    const inventory = armored();
    inventory.setSlot({ section: 'offhand' }, createItemStack(ItemId.TotemOfUndying));
    inventory.setSlot(3, createItemStack(ItemId.TotemOfUndying));
    const survival = new SurvivalSystem();
    survival.setDeathProtection((source) => source !== 'void' && consumeOffhandTotem(inventory));
    const result = survival.damage(1, 'melee', { armor: inventory, swordBlocking: true, forceLethal: true });
    expect(result.deathProtected).toBe(true);
    expect(result.killed).toBe(false);
    expect(result.dealt).toBe(20);
    expect(result.requested).toBe(1);
    expect(survival.dead).toBe(false);
    expect(survival.health).toBe(1);
    expect(survival.hasEffect('regeneration')).toBe(true);
    expect(survival.hasEffect('fire_resistance')).toBe(true);
    expect(survival.hasEffect('absorption')).toBe(true);
    expect(survival.absorption).toBe(8);
    expect(inventory.offhand).toBeNull();
    expect(inventory.getSlot(3)?.itemId).toBe(ItemId.TotemOfUndying);
    expect(inventory.getSlot({ section: 'armor', slot: 'head' })?.durability).toBe(100);
  });

  it('does not change an ordinary titanium hit', () => {
    const inventory = armored();
    const survival = new SurvivalSystem();
    const first = survival.damage(10, 'melee', { armor: inventory, swordBlocking: true });
    expect(first.killed).toBe(false);
    expect(survival.health).toBeGreaterThan(1);
    expect(first.armorWorn).toBe(true);
    expect(inventory.getSlot({ section: 'armor', slot: 'chest' })?.durability).toBeLessThan(100);
    const afterBlock = survival.health;
    const second = survival.damage(10, 'melee', { armor: inventory });
    expect(second.accepted).toBe(false);
    expect(survival.health).toBe(afterBlock);
    expect(survival.dead).toBe(false);
  });
});
