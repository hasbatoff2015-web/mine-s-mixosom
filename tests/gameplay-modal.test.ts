import { describe, expect, it } from 'vitest';
import { createItemStack } from '../src/inventory';
import { VoxelWorld } from '../src/world/World';
import {
  openingContainerPausesSimulation,
  openingPauseMenuPausesSimulation,
  playerGameplayAllowed,
  recipeBookAffectsSimulation,
  resolvePlayerMoveInput,
  worldSimulationActive,
  type GameplayModalKind,
} from '../src/core/gameplayModal';
import { shouldOpenPauseOnUnlock } from '../src/input/pointerLock';
import type { MoveInput } from '../src/input/InputManager';
import type { LifecycleState } from '../src/core/Lifecycle';

const live: MoveInput = {
  forward: 1,
  right: -1,
  jump: true,
  sprint: true,
  sneak: true,
  descend: true,
  flySprint: true,
};

const containers: readonly GameplayModalKind[] = ['inventory', 'crafting-table', 'chest', 'furnace'];

describe('container modal vs real pause', () => {
  it('Esc Pause stops world simulation', () => {
    expect(openingPauseMenuPausesSimulation()).toBe(true);
    expect(worldSimulationActive('PAUSED')).toBe(false);
    expect(playerGameplayAllowed('PAUSED', false)).toBe(false);
  });

  it('Survival inventory keeps simulation running', () => {
    expect(openingContainerPausesSimulation('inventory')).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
  });

  it('Creative inventory keeps simulation running', () => {
    expect(openingContainerPausesSimulation('inventory')).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
  });

  it('chest, furnace, and crafting table keep simulation running', () => {
    for (const kind of containers) {
      expect(openingContainerPausesSimulation(kind), kind).toBe(false);
      expect(worldSimulationActive('PLAYING')).toBe(true);
      expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    }
  });

  it('blocks player gameplay input while a container GUI is open', () => {
    const blocked = resolvePlayerMoveInput(true, live);
    expect(blocked.forward).toBe(0);
    expect(blocked.right).toBe(0);
    expect(blocked.jump).toBe(false);
    expect(blocked.sprint).toBe(false);
    expect(blocked.sneak).toBe(false);
    expect(blocked.descend).toBe(false);
    expect(blocked.flySprint).toBe(false);
    expect(playerGameplayAllowed('PLAYING', true)).toBe(false);
    expect(resolvePlayerMoveInput(false, live)).toEqual(live);
    expect(playerGameplayAllowed('PLAYING', false)).toBe(true);
  });

  it('furnace cook/burn progress while the furnace GUI would be open', () => {
    const world = new VoxelWorld('furnace-gui-open');
    const furnace = world.getFurnace(4, 9, 2);
    furnace.slots[0] = createItemStack('iron_ore');
    furnace.slots[1] = createItemStack('coal');
    const guiOpen = true;
    expect(openingContainerPausesSimulation('furnace')).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(guiOpen).toBe(true);
    for (let tick = 0; tick < 50; tick += 1) world.tick();
    expect(furnace.cookTime).toBe(50);
    expect(furnace.burnTime).toBeGreaterThan(0);
    expect(furnace.slots[2]).toBeNull();
    for (let tick = 0; tick < 150; tick += 1) world.tick();
    expect(furnace.slots[2]?.itemId).toBe('iron_ingot');
    expect(furnace.cookTime).toBe(0);
  });

  it('Recipe Book open does not change simulation pause', () => {
    expect(recipeBookAffectsSimulation()).toBe(false);
    const bookOpen = true;
    expect(worldSimulationActive('PLAYING')).toBe(true);
    expect(openingContainerPausesSimulation('crafting-table')).toBe(false);
    expect(openingContainerPausesSimulation('furnace')).toBe(false);
    expect(playerGameplayAllowed('PLAYING', bookOpen)).toBe(false);
  });

  it('only non-PLAYING lifecycle states stop the world', () => {
    const paused: LifecycleState[] = ['LOADING', 'MENU', 'PAUSED', 'AD', 'BACKGROUND', 'DEAD'];
    for (const state of paused) expect(worldSimulationActive(state), state).toBe(false);
    expect(worldSimulationActive('PLAYING')).toBe(true);
  });

  it('Esc Pause still uses pointer-lock overlay rules; containers do not pause', () => {
    expect(openingPauseMenuPausesSimulation()).toBe(true);
    expect(shouldOpenPauseOnUnlock('escape', true, false)).toBe(true);
    expect(shouldOpenPauseOnUnlock('escape', true, true)).toBe(false);
    expect(shouldOpenPauseOnUnlock('programmatic', true, false)).toBe(false);
    for (const kind of containers) expect(openingContainerPausesSimulation(kind)).toBe(false);
    expect(recipeBookAffectsSimulation()).toBe(false);
  });
});
