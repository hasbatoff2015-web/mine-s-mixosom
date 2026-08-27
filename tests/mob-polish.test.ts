import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockId } from '../src/blocks';
import { MobManager } from '../src/entities/MobManager';
import * as physics from '../src/entities/voxelPhysics';
import { VoxelWorld } from '../src/world/World';
import type { MobKind } from '../src/entities/mobDefinitions';
import { MELEE_EXTRA_VERTICAL, MELEE_KB_VERTICAL } from '../src/combat';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach((f) => f()); vi.restoreAllMocks(); });
function arena(kind: MobKind = 'zombie') {
  const world = new VoxelWorld('mob-polish');
  vi.spyOn(world, 'getBlock').mockImplementation((_x, y) => y <= 0 ? BlockId.Stone : BlockId.Air);
  const manager = new MobManager(new THREE.Scene(), world, { automaticSpawning: false, random: () => 0.1 });
  cleanup.push(() => manager.dispose());
  const mob = manager.spawn(kind, new THREE.Vector3(0, 1, 0), { force: true })!;
  mob.onGround = true;
  return { world, manager, mob };
}
describe('mob intent owns facing and gait', () => {
  it('keeps a chasing zombie facing the attacker through normal and sprint recoil', () => {
    for (const extra of [0, 1]) {
      const { manager, mob } = arena();
      const player = new THREE.Vector3(-4, 1, 0);
      manager.update(0.05, { daylight: 0.2, playerPosition: player });
      const yaw = mob.facingYaw, walk = mob.walkPhase;
      manager.damage(mob, 1, { source: 'player', attackerPosition: player,
        attackerYaw: -Math.PI / 2, extraKnockbackLevel: extra });
      for (let tick = 0; tick < 8; tick++) {
        manager.update(0.05, { daylight: 0.2, playerPosition: player });
        expect(mob.facingYaw).toBe(yaw);
        expect(mob.walkPhase).toBe(walk);
        expect(mob.locomotionSpeed).toBe(0);
      }
      for (let tick = 0; tick < 20; tick++) manager.update(0.05, { daylight: 0.2, playerPosition: player });
      expect(mob.velocity.x).toBeLessThan(0);
      expect(mob.locomotionSpeed).toBeGreaterThan(0);
      expect(mob.facingYaw).toBeCloseTo(yaw);
    }
  });
  it('allows intentional passive flee, not velocity-driven hurt rotation', () => {
    const { manager, mob } = arena('pig');
    const yaw = mob.facingYaw;
    manager.damage(mob, 1, { source: 'player', attackerPosition: new THREE.Vector3(-2, 1, 0) });
    manager.update(0.05, { daylight: 0.2 });
    expect(mob.facingYaw).toBe(yaw);
    for (let tick = 0; tick < 25; tick++) manager.update(0.05, { daylight: 0.2 });
    expect(mob.velocity.x).toBeGreaterThan(0);
    expect(mob.locomotionSpeed).toBeGreaterThan(0);
  });
  it('a retreating skeleton still looks at its firing target', () => {
    const { manager, mob } = arena('skeleton');
    manager.update(0.05, { daylight: 0.2, playerPosition: new THREE.Vector3(-3, 1, 0) });
    expect(mob.velocity.x).toBeGreaterThan(0);
    expect(mob.facingYaw).toBeCloseTo(Math.PI / 2);
  });
});

describe('fixed tick vertical audit: actual mob physics vs discrete 1.8 travel', () => {
  it.each([false, true])('20-tick trace sprint=%s; no flat-ground step/pop', (sprint) => {
    const { manager, mob } = arena();
    const move = vi.spyOn(physics, 'moveVoxelBody');
    manager.damage(mob, 1, { source: 'player', attackerPosition: new THREE.Vector3(-1, 1, 0),
      attackerYaw: -Math.PI / 2, extraKnockbackLevel: Number(sprint) });
    const rows = [];
    let refY = 1, refV = sprint ? MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL : MELEE_KB_VERTICAL, landed = 0;
    for (let tick = 1; tick <= 20; tick++) {
      // Independent per-tick reference: position += motionY; gravity .08; drag .98.
      refY += refV / 20;
      if (refY <= 1) { refY = 1; refV = 0; }
      else refV = (refV - 1.6) * 0.98;
      manager.update(0.05, { daylight: 0.2 });
      const collision = move.mock.results.at(-1)!.value as physics.VoxelMoveResult;
      rows.push({ tick, y: +mob.position.y.toFixed(6), vy: +mob.velocity.y.toFixed(6),
        onGround: mob.onGround, meleeKnockback: mob.meleeKnockback, hitY: collision.hitY, stepped: collision.stepped });
      if (mob.onGround && landed === 0) landed = tick;
      expect(mob.position.y).toBeCloseTo(refY, 4);
      expect(collision.stepped).toBe(false);
    }
    const apex = Math.max(...rows.map((row) => row.y));
    const apexRise = apex - 1;
    console.log('VERTICAL TRACE', { sprint, firstDy: rows[0]!.y - 1, apexAboveFeet: apexRise,
      apexTick: rows.find((row) => row.y === apex)!.tick, landingTick: landed, rows });
    expect(rows[0]!.y - 1).toBeCloseTo((sprint ? MELEE_KB_VERTICAL + MELEE_EXTRA_VERTICAL : MELEE_KB_VERTICAL) / 20, 4);
    expect(apexRise).toBeCloseTo(sprint ? 0.8544 : 0.5765, 1);
    expect(landed).toBeGreaterThan(0);
  });
});
