import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import { HeadlessEntityHost, MobManager } from '../src/entities';
import {
  MEGA_ZOMBIE_ATTACK_DAMAGE,
  MEGA_ZOMBIE_HITS_TO_KILL,
  MEGA_ZOMBIE_MAX_HEALTH,
  MEGA_ZOMBIE_REVENGE_SECONDS,
  TITANIUM_SWORD_NORMAL_HIT,
  arenaFromCorners,
  clampBossToArena,
  megaZombieLootOffset,
  pointInArena,
  selectMegaZombieTarget,
  type ArenaAabb,
  type BossFocus,
} from '../src/entities/megaZombie';
import { MEGA_ZOMBIE_LOOT, rollMegaZombieLoot } from '../src/entities/megaZombieLoot';
import { applyMegaZombiePose } from '../src/entities/megaZombiePose';
import { MOB_DEFINITIONS } from '../src/entities/mobDefinitions';
import { Vec3 } from '../src/math/vec3';
import { MAX_HEALTH, reduceDamageByArmor } from '../src/survival/SurvivalSystem';
import { VoxelWorld } from '../src/world/World';
import { EVENT_CHEST_LOOT_TABLE } from '../server/services/eventLoot';

function flatWorld(seed: string): VoxelWorld {
  const world = new VoxelWorld(seed);
  for (let x = 4; x <= 16; x += 1) {
    for (let z = 4; z <= 16; z += 1) {
      world.setBlock(x, 71, z, BlockId.Stone);
      for (let y = 72; y <= 78; y += 1) world.setBlock(x, y, z, BlockId.Air);
    }
  }
  return world;
}

function manager(seed: string): MobManager {
  return new MobManager(new HeadlessEntityHost(), flatWorld(seed), { automaticSpawning: false });
}

const ARENA: ArenaAabb = {
  minX: 2, minY: 72, minZ: 2,
  maxX: 20, maxY: 80, maxZ: 20,
};

function focus(
  id: string,
  x: number,
  y: number,
  z: number,
  extras: Partial<BossFocus> = {},
): BossFocus {
  return { id, x, y, z, eyeY: y + 1.62, alive: true, targetable: true, ...extras };
}

describe('mega zombie config and arena', () => {
  it('normalizes an AABB on all three axes', () => {
    const arena = arenaFromCorners({ x: 8, y: 4, z: 1 }, { x: 2, y: 9, z: -3 });
    expect(arena).toEqual({ minX: 2, maxX: 8, minY: 4, maxY: 9, minZ: -3, maxZ: 1 });
  });

  it('rejects a player outside X, Y, or Z', () => {
    const arena = arenaFromCorners({ x: 0, y: 10, z: 0 }, { x: 6, y: 14, z: 6 })!;
    expect(pointInArena(arena, 3, 12, 3)).toBe(true);
    expect(pointInArena(arena, -0.1, 12, 3)).toBe(false);
    expect(pointInArena(arena, 3, 9.9, 3)).toBe(false);
    expect(pointInArena(arena, 3, 14.1, 3)).toBe(false);
    expect(pointInArena(arena, 3, 12, 6.1)).toBe(false);
  });

  it('keeps the boss body inside the box', () => {
    const position = { x: 30, y: 1, z: -4 };
    const velocity = { x: 3, y: -2, z: -1 };
    clampBossToArena(position, velocity, ARENA, 2.3, 3.7);
    expect(position.x).toBeLessThanOrEqual(ARENA.maxX - 1.15);
    expect(position.x).toBeGreaterThanOrEqual(ARENA.minX + 1.15);
    expect(position.y).toBeGreaterThanOrEqual(ARENA.minY);
    expect(position.y).toBeLessThanOrEqual(ARENA.maxY - 3.7);
    expect(position.z).toBeGreaterThanOrEqual(ARENA.minZ + 1.15);
    expect(position.z).toBeLessThanOrEqual(ARENA.maxZ - 1.15);
    expect(velocity.x).toBe(0);
    expect(velocity.y).toBe(0);
    expect(velocity.z).toBe(0);
  });
});

describe('mega zombie targeting and revenge', () => {
  it('picks the nearest player in 3D and ignores anyone outside the arena', () => {
    const near = focus('near', 5, 72, 5);
    const far = focus('far', 8, 72, 8);
    const above = focus('above', 4, 90, 4);
    const chosen = selectMegaZombieTarget(4, 72, 4, ARENA, [far, above, near], null, false);
    expect(chosen?.id).toBe('near');
    expect(selectMegaZombieTarget(4, 72, 4, ARENA, [above], null, false)).toBeUndefined();
    expect(selectMegaZombieTarget(4, 72, 4, ARENA, [], null, false)).toBeUndefined();
  });

  it('drops a target that leaves and keeps a closer one inside', () => {
    const inside = focus('inside', 6, 72, 6);
    const left = focus('left', 6, 72, 40);
    const chosen = selectMegaZombieTarget(5, 72, 5, ARENA, [left, inside], 'left', true);
    expect(chosen?.id).toBe('inside');
  });

  it('prefers an in-arena revenge target over a nearer player', () => {
    const near = focus('near', 5, 72, 5);
    const revenge = focus('revenge', 12, 74, 12);
    const chosen = selectMegaZombieTarget(4, 72, 4, ARENA, [near, revenge], 'revenge', true);
    expect(chosen?.id).toBe('revenge');
  });
});

describe('mega zombie combat numbers', () => {
  it('sets boss health from three hundred ordinary titanium sword hits', () => {
    expect(TITANIUM_SWORD_NORMAL_HIT).toBe(10);
    expect(MEGA_ZOMBIE_MAX_HEALTH).toBe(TITANIUM_SWORD_NORMAL_HIT * MEGA_ZOMBIE_HITS_TO_KILL);
    expect(MOB_DEFINITIONS.mega_zombie.maxHealth).toBe(3000);
    expect(MOB_DEFINITIONS.mega_zombie.attackDamage).toBe(MEGA_ZOMBIE_ATTACK_DAMAGE);
    expect(MOB_DEFINITIONS.mega_zombie.loot).toEqual([]);
  });

  it('does not one-shot full titanium and kills an unarmored player in two hits', () => {
    const mitigated = reduceDamageByArmor(MEGA_ZOMBIE_ATTACK_DAMAGE, { points: 20, toughness: 0 });
    expect(mitigated).toBeCloseTo(3);
    expect(mitigated).toBeLessThan(MAX_HEALTH);
    expect(mitigated * 6).toBeLessThan(MAX_HEALTH);
    expect(mitigated * 7).toBeGreaterThanOrEqual(MAX_HEALTH);
    expect(MEGA_ZOMBIE_ATTACK_DAMAGE * 2).toBeGreaterThan(MAX_HEALTH);
    expect(reduceDamageByArmor(MEGA_ZOMBIE_ATTACK_DAMAGE, { points: 7, toughness: 0 }) * 2).toBeGreaterThan(MAX_HEALTH);
  });
});

describe('mega zombie simulation', () => {
  it('stands still with an empty arena and does not follow a player outside Y', () => {
    const mobs = manager('boss-idle');
    const boss = mobs.spawn('mega_zombie', new Vec3(8, 72, 8), { force: true, bossArena: ARENA })!;
    mobs.update(0.2, { players: [] });
    expect(boss.state).toBe('idle');
    const x = boss.position.x;
    mobs.update(0.5, {
      players: [{ id: 'high', position: new Vec3(8, 90, 8), alive: true, targetable: true }],
    });
    expect(boss.position.x).toBeCloseTo(x, 2);
    expect(boss.state).toBe('idle');
    mobs.dispose();
  });

  it('chases the nearest player inside the arena and stops at the boundary', () => {
    const mobs = manager('boss-chase');
    const tight: ArenaAabb = { minX: 4, minY: 72, minZ: 4, maxX: 14, maxY: 80, maxZ: 16 };
    const boss = mobs.spawn('mega_zombie', new Vec3(6, 72, 8), { force: true, bossArena: tight })!;
    const player = { id: 'ada', position: new Vec3(13.2, 72, 8), alive: true, targetable: true };
    for (let step = 0; step < 80; step += 1) mobs.update(0.05, { players: [player] });
    expect(boss.position.x).toBeGreaterThan(6.2);
    expect(boss.position.x).toBeLessThanOrEqual(tight.maxX - MOB_DEFINITIONS.mega_zombie.width * 0.5 + 1e-6);
    expect(boss.position.y).toBeGreaterThanOrEqual(tight.minY - 1e-6);
    expect(boss.position.y).toBeLessThanOrEqual(tight.maxY - MOB_DEFINITIONS.mega_zombie.height + 1e-6);
    expect(boss.position.z).toBeGreaterThanOrEqual(tight.minZ);
    expect(boss.position.z).toBeLessThanOrEqual(tight.maxZ);
    mobs.dispose();
  });

  it('switches to the attacker, expires revenge, and drops it when they leave or die', () => {
    const mobs = manager('boss-revenge');
    const boss = mobs.spawn('mega_zombie', new Vec3(10, 72, 10), { force: true, bossArena: ARENA })!;
    const near = { id: 'near', position: new Vec3(12, 72, 10), alive: true, targetable: true, name: 'Near' };
    const far = { id: 'far', position: new Vec3(4, 72, 10), alive: true, targetable: true, name: 'Far' };
    mobs.update(0.05, { players: [near, far] });
    expect(boss.state === 'chase' || boss.state === 'attack').toBe(true);
    const towardNear = boss.position.x;
    mobs.damage(boss, 10, { source: 'player', attackerId: 'far' });
    expect(boss.boss?.lastPlayerAttackerId).toBe('far');
    expect(boss.boss?.lastPlayerAttackerName).toBe('Far');
    expect(boss.boss?.revengePlayerId).toBe('far');
    expect(boss.boss?.revengeSeconds).toBe(MEGA_ZOMBIE_REVENGE_SECONDS);
    for (let step = 0; step < 20; step += 1) mobs.update(0.05, { players: [near, far] });
    expect(boss.position.x).toBeLessThan(towardNear);

    boss.hurtResistance.reset();
    mobs.damage(boss, 1, { source: 'fire' });
    expect(boss.boss?.lastPlayerAttackerId).toBe('far');

    boss.hurtResistance.reset();
    mobs.update(0.05, { players: [near, far] });
    boss.hurtResistance.reset();
    mobs.damage(boss, 10, { source: 'projectile', attackerId: 'near' });
    expect(boss.boss?.lastPlayerAttackerId).toBe('near');
    expect(boss.boss?.revengePlayerId).toBe('near');

    mobs.update(0.05, {
      players: [
        near,
        { ...far, position: new Vec3(4, 72, 40) },
      ],
    });
    boss.boss!.revengePlayerId = 'far';
    boss.boss!.revengeSeconds = 4;
    boss.hurtSeconds = 0;
    boss.meleeKnockback = false;
    for (let step = 0; step < 6; step += 1) {
      mobs.update(0.05, {
        players: [near, { id: 'far', position: new Vec3(4, 90, 10), alive: true, targetable: true, name: 'Far' }],
      });
    }
    expect(boss.boss?.revengePlayerId).toBeNull();

    mobs.update(0.05, { players: [near, far] });
    boss.hurtResistance.reset();
    mobs.damage(boss, 10, { source: 'player', attackerId: 'far' });
    boss.hurtSeconds = 0;
    boss.meleeKnockback = false;
    for (let step = 0; step < 6; step += 1) {
      mobs.update(0.05, {
        players: [near, { id: 'far', position: far.position, alive: false, targetable: true, name: 'Far' }],
      });
    }
    expect(boss.boss?.revengePlayerId).toBeNull();

    boss.boss!.revengePlayerId = 'far';
    boss.boss!.revengeSeconds = 0.1;
    for (let step = 0; step < 4; step += 1) {
      mobs.update(0.05, { players: [near, far] });
    }
    expect(boss.boss?.revengeSeconds).toBe(0);
    expect(boss.boss?.revengePlayerId === 'far').toBe(false);
    mobs.dispose();
  });

  it('dies after 300 accepted titanium hits and keeps the player through later fire damage', () => {
    const mobs = manager('boss-hp');
    const boss = mobs.spawn('mega_zombie', new Vec3(8, 72, 8), { force: true, bossArena: ARENA })!;
    mobs.update(0.05, {
      players: [{ id: 'ada', position: new Vec3(10, 72, 8), alive: true, targetable: true, name: 'Ada' }],
    });
    for (let hit = 0; hit < 299; hit += 1) {
      boss.hurtResistance.reset();
      expect(mobs.damage(boss, TITANIUM_SWORD_NORMAL_HIT, { source: 'player', attackerId: 'ada' })).toBe(true);
      expect(boss.alive).toBe(true);
    }
    boss.hurtResistance.reset();
    mobs.damage(boss, 1, { source: 'fire' });
    expect(boss.boss?.lastPlayerAttackerId).toBe('ada');
    boss.hurtResistance.reset();
    expect(mobs.damage(boss, TITANIUM_SWORD_NORMAL_HIT, { source: 'player', attackerId: 'ada' })).toBe(true);
    expect(boss.state).toBe('die');
    expect(boss.health).toBe(0);
    expect(boss.boss?.lastPlayerAttackerName).toBe('Ada');
    mobs.dispose();
  });

  it('is not saved and is not distance-despawned', () => {
    const mobs = manager('boss-persist');
    const boss = mobs.spawn('mega_zombie', new Vec3(8, 72, 8), { force: true, id: 'mega-1', bossArena: ARENA })!;
    mobs.spawn('zombie', new Vec3(12, 72, 8), { force: true, id: 'z-1' });
    expect(mobs.serialize().some((entry) => entry.kind === 'mega_zombie')).toBe(false);
    const restored = manager('boss-restore');
    expect(restored.restore([{
      id: 'mega-1',
      kind: 'mega_zombie',
      position: [8, 72, 8],
      velocity: [0, 0, 0],
      health: 3000,
      state: 'idle',
      ageSeconds: 3,
      fuseSeconds: 0,
    }])).toBe(0);
    expect(restored.get('mega-1')).toBeUndefined();
    for (let step = 0; step < 20; step += 1) {
      mobs.update(0.5, { players: [{ id: 'far', position: new Vec3(80, 72, 80), alive: true, targetable: true }] });
    }
    expect(mobs.get(boss.id)?.alive).toBe(true);
    mobs.dispose();
    restored.dispose();
  });

  it('melees a player standing in range', () => {
    const mobs = manager('boss-hit');
    mobs.spawn('mega_zombie', new Vec3(8, 72, 8), { force: true, bossArena: ARENA });
    mobs.update(0.05, {
      players: [{ id: 'ada', position: new Vec3(8, 72, 10), alive: true, targetable: true }],
    });
    const hits = mobs.consumePlayerDamage();
    expect(hits.some((hit) => hit.mobKind === 'mega_zombie' && hit.amount === MEGA_ZOMBIE_ATTACK_DAMAGE)).toBe(true);
    mobs.dispose();
  });
});

describe('mega zombie loot', () => {
  it('copies the current event chest contents without calling the generator', () => {
    const source = readFileSync(new URL('../src/entities/megaZombieLoot.ts', import.meta.url), 'utf8');
    expect(source.includes('generateEventChestLoot')).toBe(false);
    expect(source.includes("from '../server")).toBe(false);
    expect(source.includes('from "../../server')).toBe(false);
    expect(source.includes('eventLoot')).toBe(false);
    expect(MEGA_ZOMBIE_LOOT).not.toBe(EVENT_CHEST_LOOT_TABLE);
    expect(MEGA_ZOMBIE_LOOT.map((entry) => ({ ...entry }))).toEqual(
      EVENT_CHEST_LOOT_TABLE.map((entry) => ({ ...entry })),
    );
    const stacks = rollMegaZombieLoot(() => 0);
    expect(stacks.map((stack) => stack.itemId).sort()).toEqual(
      MEGA_ZOMBIE_LOOT.map((entry) => entry.itemId).sort(),
    );
  });

  it('spreads each stack inside about four blocks', () => {
    for (let index = 0; index < 40; index += 1) {
      const offset = megaZombieLootOffset(() => index / 39);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(offset.z)).toBeLessThanOrEqual(4);
    }
    const edge = megaZombieLootOffset(() => 0);
    expect(edge.x).toBeCloseTo(-4);
    expect(edge.z).toBeCloseTo(-4);
  });
});

describe('mega zombie pose', () => {
  it('shakes before the sideways fall and swings the arms while attacking', () => {
    const parts = new Map<string, { rotation: { x: number; y: number; z: number } }>();
    for (const name of ['waist', 'chest', 'head', 'arm1', 'arm2', 'forearm1', 'forearm2', 'leg1', 'leg2', 'foreleg1', 'foreleg2']) {
      parts.set(name, { rotation: { x: 0, y: 0, z: 0 } });
    }
    const idle = applyMegaZombiePose(parts, {
      walkPhase: 0, locomotionSpeed: 0, visualAge: 0, state: 'idle', stateSeconds: 0, deathSeconds: 0,
    });
    expect(idle.shake).toBe(0);
    expect(idle.fall).toBe(0);
    const attackArm = parts.get('arm1')!.rotation.x;
    applyMegaZombiePose(parts, {
      walkPhase: 0, locomotionSpeed: 0, visualAge: 0, state: 'attack', stateSeconds: 0.5, deathSeconds: 0,
    });
    expect(parts.get('arm1')!.rotation.x).not.toBeCloseTo(attackArm);
    const early = applyMegaZombiePose(parts, {
      walkPhase: 0, locomotionSpeed: 0, visualAge: 0, state: 'die', stateSeconds: 0, deathSeconds: 0.1,
    });
    expect(Math.abs(early.shake)).toBeGreaterThan(0);
    expect(early.fall).toBe(0);
    expect(early.tint).toBe(0);
    const late = applyMegaZombiePose(parts, {
      walkPhase: 0, locomotionSpeed: 0, visualAge: 0, state: 'die', stateSeconds: 0, deathSeconds: 1.25,
    });
    expect(late.shake).toBe(0);
    expect(late.fall).toBeCloseTo(1, 1);
    expect(late.tint).toBe(1);
  });
});
