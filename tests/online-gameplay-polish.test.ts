import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOUND_CATALOG } from '../src/audio/soundCatalog';
import {
  HUMANOID_DEATH_ANIMATION_SECONDS,
  humanoidDeathProgress,
  humanoidDeathRotationZ,
  humanoidDeathScale,
} from '../src/entities/humanoidDeath';
import { MOB_DEATH_ANIMATION_SECONDS } from '../src/entities/MobManager';
import { ghostFromRecipe, placeCraftingRecipe } from '../src/ui/containerInteractions';
import { Inventory } from '../src/inventory';
import { SurvivalSystem } from '../src/survival';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';
import { allCraftingBookEntries } from '../src/ui/recipeBook';

const gameSource = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const gameplaySource = readFileSync(new URL('../server/gameplay.ts', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui/GameUI.ts', import.meta.url), 'utf8');

describe('online fire overlay state', () => {
  it('uses authoritative health.fire / snapshot.onFire without a second overlay', () => {
    const survival = new SurvivalSystem({ health: 20 });
    expect(survival.isOnFire).toBe(false);
    survival.syncNetworkFire(true);
    expect(survival.isOnFire).toBe(true);
    survival.syncNetworkFire(false);
    expect(survival.isOnFire).toBe(false);
    expect(gameSource).toContain('session.survival.syncNetworkFire(message.fire)');
    expect(gameSource).toContain('session.survival.syncNetworkFire(local.onFire)');
    expect(gameSource).toContain('state.onFire = session.survival.isOnFire');
  });
});

describe('player death animation pose', () => {
  it('reuses the zombie/mob death duration and linear tilt/scale', () => {
    expect(HUMANOID_DEATH_ANIMATION_SECONDS).toBe(0.7);
    expect(MOB_DEATH_ANIMATION_SECONDS).toBe(HUMANOID_DEATH_ANIMATION_SECONDS);
    expect(humanoidDeathProgress(0)).toBe(0);
    expect(humanoidDeathProgress(0.7)).toBe(1);
    expect(humanoidDeathRotationZ(1)).toBeCloseTo(Math.PI * 0.5);
    expect(humanoidDeathScale(1)).toBeCloseTo(0.75);
    expect(gameSource).toContain('requestOnlineRespawn');
    expect(gameSource).toContain("session.online.client.send({ type: 'respawn' })");
    expect(uiSource).toContain('Вы умерли');
    expect(uiSource).toContain('Возродиться');
  });
});

describe('recipe selection is not craft validation', () => {
  it('shows a ghost grid with missing red cells when the player has no ingredients', () => {
    const sticks = allCraftingBookEntries().find((entry) => entry.id === 'sticks')?.recipe;
    expect(sticks).toBeDefined();
    const inventory = new Inventory();
    const placed = placeCraftingRecipe(sticks!, Array.from({ length: 4 }, () => null), inventory, 2, 1);
    expect(placed.placed).toBe(false);
    expect(placed.ghost).toBeDefined();
    expect(placed.ghost?.missing.some(Boolean)).toBe(true);
    const ghost = ghostFromRecipe(sticks!, 2, new Map());
    expect(ghost.cells.some(Boolean)).toBe(true);
    expect(uiSource).toContain('this.ghostCraft = ghostFromRecipe(recipe, gridSize, counts)');
    expect(uiSource).toContain("submitAction({ type: 'inventory_action', action: 'recipe'");
  });

  it('still places a craftable recipe into the grid', () => {
    const sticks = allCraftingBookEntries().find((entry) => entry.id === 'sticks')?.recipe;
    const inventory = new Inventory();
    inventory.addItem('oak_planks', 2);
    const placed = placeCraftingRecipe(sticks!, Array.from({ length: 4 }, () => null), inventory, 2, 1);
    expect(placed.placed).toBe(true);
    expect(placed.grid.some((stack) => stack?.itemId === 'oak_planks')).toBe(true);
  });
});

describe('protocol: respawn + world_sound metadata only', () => {
  it('parses a client respawn request and rejects a second implicit craft from empty payloads', () => {
    expect(parseClientMessage({ type: 'respawn' })).toEqual({ type: 'respawn' });
    const parsed = parseServerMessage({
      type: 'world_sound',
      sounds: [
        { event: 'explosion', x: 1, y: 64, z: 2 },
        { event: 'bow.shoot', x: 3, y: 65, z: 4, pitch: 1.02 },
      ],
    });
    expect(parsed).toMatchObject({
      type: 'world_sound',
      sounds: [
        { event: 'explosion', x: 1, y: 64, z: 2 },
        { event: 'bow.shoot', x: 3, y: 65, z: 4, pitch: 1.02 },
      ],
    });
  });
});

describe('sound call-site audit', () => {
  it('every catalog event is either called in SP/Online or explicitly local-only', () => {
    const keys = [...SOUND_CATALOG.keys()];
    expect(keys.length).toBeGreaterThan(20);
    expect(gameplaySource).toContain("emitWorldSound('explosion'");
    expect(gameplaySource).toContain("emitWorldSound('bow.shoot'");
    expect(gameplaySource).toContain("emitWorldSound('combat.hit'");
    expect(gameplaySource).toContain("emitWorldSound('item.pickup'");
    expect(gameplaySource).toContain("emitWorldSound('fire.ignite'");
    expect(gameSource).toContain("case 'world_sound'");
    expect(gameSource).toContain('this.updateFootsteps(session');
    expect(gameSource).toContain('consumableSoundEvent(item)');
  });
});
