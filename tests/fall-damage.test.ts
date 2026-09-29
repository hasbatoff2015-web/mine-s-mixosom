import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { Chunk } from '../src/world/Chunk';
import { VoxelWorld } from '../src/world/World';
import { PlayerController } from '../src/player';
import { fallDamageFromDistance, scaledFallDamage, vanillaFallDamage } from '../src/player/fallDamage';
import { SurvivalSystem } from '../src/survival';
import type { MoveInput } from '../src/input/MoveInput';

function flatWorld(): VoxelWorld {
  const world = new VoxelWorld('fall-damage');
  world.chunks.set('0,0', new Chunk(0, 0));
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 16; z += 1) world.setBlock(x, 0, z, BlockId.Stone);
  }
  return world;
}

function input(partial: Partial<MoveInput> = {}): { yaw: number; pitch: number; movement: () => MoveInput } {
  return {
    yaw: 0,
    pitch: 0,
    movement: () => ({
      forward: 0, right: 0, jump: false, sneak: false, sprint: false, descend: false, flySprint: false,
      ...partial,
    }),
  };
}

describe('fall damage', () => {
  it('halves the previous fall formula', () => {
    expect(vanillaFallDamage(13)).toBe(10);
    expect(scaledFallDamage(10)).toBe(5);
    expect(fallDamageFromDistance(13)).toBe(5);
    expect(fallDamageFromDistance(3)).toBe(0);
    expect(fallDamageFromDistance(4)).toBe(0);
    expect(fallDamageFromDistance(6)).toBe(1);
  });

  it('applies the halved amount on an ordinary landing', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [8.5, 7, 8.5] });
    const survival = new SurvivalSystem({ health: 20 });
    const applied: number[] = [];
    for (let tick = 0; tick < 80 && !player.onGround; tick += 1) {
      player.tick(world, input(), 0.05, (amount, cause) => {
        applied.push(amount);
        survival.damage(amount, cause);
      });
    }
    expect(player.onGround).toBe(true);
    expect(applied).toEqual([fallDamageFromDistance(player.lastFallDistance)]);
    expect(applied[0]).toBeGreaterThan(0);
    expect(applied[0]).toBe(Math.floor(vanillaFallDamage(player.lastFallDistance) / 2));
    expect(survival.health).toBe(20 - applied[0]!);
    expect(survival.dead).toBe(false);
  });

  it('leaves exactly 1 HP after a lethal fall and does not spend death protection', () => {
    const world = flatWorld();
    const player = new PlayerController({ position: [8.5, 80, 8.5] });
    const survival = new SurvivalSystem({ health: 20 });
    let protectionCalls = 0;
    survival.setDeathProtection(() => {
      protectionCalls += 1;
      return true;
    });
    for (let tick = 0; tick < 400 && survival.health === 20; tick += 1) {
      player.tick(world, input(), 0.05, (amount, cause) => {
        survival.damage(amount, cause);
      });
    }
    expect(vanillaFallDamage(player.lastFallDistance)).toBeGreaterThan(20);
    expect(fallDamageFromDistance(player.lastFallDistance)).toBeGreaterThanOrEqual(20);
    expect(survival.health).toBe(1);
    expect(survival.dead).toBe(false);
    expect(protectionCalls).toBe(0);
  });

  it('still lets melee and void damage kill the player', () => {
    const melee = new SurvivalSystem({ health: 8 });
    const meleeResult = melee.damage(8, 'melee');
    expect(meleeResult.killed).toBe(true);
    expect(melee.health).toBe(0);
    expect(melee.dead).toBe(true);

    const lava = new SurvivalSystem({ health: 4 });
    expect(lava.damage(20, 'lava').killed).toBe(true);
    expect(lava.dead).toBe(true);

    const voidDamage = new SurvivalSystem({ health: 20 });
    expect(voidDamage.damage(1000, 'void').killed).toBe(true);
    expect(voidDamage.health).toBe(0);
    expect(voidDamage.dead).toBe(true);
  });
});
