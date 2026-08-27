import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  POTION_INVISIBILITY_DURATION_TICKS,
  POTION_REGENERATION_DURATION_TICKS,
  getItemDefinition,
  ItemId,
} from '../src/items';
import { Inventory, createItemStack } from '../src/inventory';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import { FP_FIRE_OVERLAY_OPACITY } from '../src/rendering/fireTexture';
import {
  POTION_PARTICLE_COUNT,
  POTION_PARTICLE_MAX_OPACITY,
  POTION_SWIRL_FRAMES,
  firstPersonPotionParticleLayout,
  potionSwirlUv,
} from '../src/rendering/potionParticles';
import { SurvivalSystem } from '../src/survival';
import { formatEffectCountdown, potionHudEntries } from '../src/ui/effectHud';

function frameState(overrides: Partial<FirstPersonFrameState> = {}): FirstPersonFrameState {
  return {
    visible: true,
    movementSpeed: 0,
    onGround: true,
    sprinting: false,
    mining: false,
    foodUseProgress: 0,
    bowCharge: 0,
    ...overrides,
  };
}

describe('potion durations and effect HUD', () => {
  it('keeps invisibility at 3 minutes and regeneration potion at 1 minute', () => {
    expect(POTION_INVISIBILITY_DURATION_TICKS).toBe(3600);
    expect(POTION_REGENERATION_DURATION_TICKS).toBe(1200);
    const invis = getItemDefinition(ItemId.PotionInvisibility);
    const regen = getItemDefinition(ItemId.PotionRegeneration);
    const apple = getItemDefinition(ItemId.GoldenApple);
    expect(invis.kind).toBe('food');
    expect(regen.kind).toBe('food');
    expect(apple.kind).toBe('food');
    if (invis.kind !== 'food' || regen.kind !== 'food' || apple.kind !== 'food') return;
    expect(invis.food.effects?.[0]).toMatchObject({
      id: 'invisibility',
      durationTicks: 3600,
    });
    expect(regen.food.effects?.[0]).toMatchObject({
      id: 'regeneration',
      durationTicks: 1200,
    });
    expect(apple.food.effects?.find((effect) => effect.id === 'regeneration')).toMatchObject({
      amplifier: 1,
      durationTicks: 100,
    });
  });

  it('formats remaining ticks as a real-time M:SS countdown', () => {
    expect(formatEffectCountdown(3600)).toBe('3:00');
    expect(formatEffectCountdown(3580)).toBe('2:59');
    expect(formatEffectCountdown(1200)).toBe('1:00');
    expect(formatEffectCountdown(1180)).toBe('0:59');
    expect(formatEffectCountdown(20)).toBe('0:01');
    expect(formatEffectCountdown(1)).toBe('0:01');
    expect(formatEffectCountdown(0)).toBe('0:00');
  });

  it('lists only active invisibility and regeneration chips, then hides them', () => {
    const survival = new SurvivalSystem({ health: 10, hunger: 10 });
    const inventory = new Inventory();
    expect(potionHudEntries((id) => survival.effectTicks(id))).toEqual([]);

    inventory.add(createItemStack(ItemId.PotionInvisibility));
    expect(survival.consumeFood(ItemId.PotionInvisibility, inventory)).toBe(true);
    const invisOnly = potionHudEntries((id) => survival.effectTicks(id));
    expect(invisOnly).toHaveLength(1);
    expect(invisOnly[0]).toMatchObject({
      id: 'invisibility',
      name: 'Невидимость',
      timer: '3:00',
      itemId: ItemId.PotionInvisibility,
    });

    inventory.add(createItemStack(ItemId.PotionRegeneration));
    expect(survival.consumeFood(ItemId.PotionRegeneration, inventory)).toBe(true);
    const both = potionHudEntries((id) => survival.effectTicks(id));
    expect(both.map((entry) => entry.id)).toEqual(['invisibility', 'regeneration']);
    expect(both[1]).toMatchObject({ name: 'Регенерация', timer: '1:00' });

    for (let tick = 0; tick < 1200; tick += 1) survival.tick(0.05);
    const afterRegen = potionHudEntries((id) => survival.effectTicks(id));
    expect(afterRegen).toHaveLength(1);
    expect(afterRegen[0]?.id).toBe('invisibility');
    expect(survival.invisible).toBe(true);

    for (let tick = 0; tick < 2400; tick += 1) survival.tick(0.05);
    expect(potionHudEntries((id) => survival.effectTicks(id))).toEqual([]);
    expect(survival.invisible).toBe(false);
  });
});

describe('first-person potion particles', () => {
  it('samples the swirl row of particles.png and stays below the crosshair', () => {
    const first = potionSwirlUv(0);
    const last = potionSwirlUv(POTION_SWIRL_FRAMES - 1);
    expect(first.repeat).toBeCloseTo(16 / 256, 8);
    expect(first.offsetY).toBeCloseTo(0.4375, 8);
    expect(first.offsetX).toBe(0);
    expect(last.offsetX).toBeCloseTo(7 / 16, 8);
    expect(last.offsetY).toBe(first.offsetY);

    const layout = firstPersonPotionParticleLayout();
    expect(layout.count).toBe(POTION_PARTICLE_COUNT);
    expect(layout.count).toBeLessThanOrEqual(10);
    expect(layout.maxY).toBeLessThanOrEqual(-0.10);
    expect(layout.maxOpacity).toBeLessThanOrEqual(0.35);
    expect(layout.maxOpacity).toBeLessThan(FP_FIRE_OVERLAY_OPACITY * 0.5);
  });

  it('shows a soft lower overlay only while a potion effect is active', () => {
    const factory = new ItemVisualFactory();
    const viewmodel = new FirstPersonRenderer(factory);
    const overlay = viewmodel.scene.getObjectByName('first-person:potion-overlay') as THREE.Group;
    expect(overlay).toBeDefined();
    expect(overlay.children).toHaveLength(POTION_PARTICLE_COUNT);

    viewmodel.update(0.016, frameState());
    expect(overlay.visible).toBe(false);

    viewmodel.update(0.05, frameState({ potionActive: true, potionKind: 'invisibility' }));
    expect(overlay.visible).toBe(true);
    for (let step = 0; step < 40; step += 1) {
      viewmodel.update(0.05, frameState({ potionActive: true, potionKind: 'regeneration' }));
    }
    overlay.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      expect(object.geometry).toBeInstanceOf(THREE.PlaneGeometry);
      const top = object.position.y + object.scale.y * 0.5;
      expect(top).toBeLessThanOrEqual(-0.10);
      expect(Math.abs(object.position.x)).toBeGreaterThanOrEqual(0.16);
      const material = object.material as THREE.MeshBasicMaterial;
      expect(material.opacity).toBeLessThanOrEqual(POTION_PARTICLE_MAX_OPACITY + 1e-6);
      expect(material.opacity).toBeLessThan(FP_FIRE_OVERLAY_OPACITY);
    });

    viewmodel.update(0.016, frameState({ potionActive: false }));
    expect(overlay.visible).toBe(false);
    viewmodel.dispose();
    factory.dispose();
  });
});
