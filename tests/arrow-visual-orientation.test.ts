import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks';
import {
  ARROW_AIR_DRAG_PER_TICK,
  ARROW_GRAVITY_PER_TICK,
} from '../src/combat/ArrowPhysics';
import { PlayerArrowManager, type PlayerArrow } from '../src/combat/PlayerArrowManager';
import { MobManager } from '../src/entities/MobManager';
import { Vec3 } from '../src/math/vec3';
import { ARROW_FORWARD } from '../src/rendering/ArrowVisualFactory';
import { VoxelWorld } from '../src/world/World';

const cleanup: Array<() => void> = [];

afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
});

function createFixture(seed: string) {
  const world = new VoxelWorld(seed);
  world.getChunk(0, 0);
  const scene = new THREE.Scene();
  // Box-Muller: v=0.25 makes cos(2πv)=0, so production spread remains enabled but resolves to zero.
  const mobs = new MobManager(scene, world, { automaticSpawning: false, random: () => 0.25 });
  const arrows = new PlayerArrowManager(scene, world, mobs, { random: () => 0.25 });
  cleanup.push(() => {
    arrows.dispose();
    mobs.dispose();
  });
  return { world, scene, mobs, arrows };
}

function visualForward(arrow: { readonly visual?: unknown }): THREE.Vector3 {
  const visual = arrow.visual as THREE.Object3D;
  return ARROW_FORWARD.clone().applyQuaternion(visual.quaternion).normalize();
}

function angularError(actual: THREE.Vector3, expected: { x: number; y: number; z: number }): number {
  const expectedDirection = new THREE.Vector3(expected.x, expected.y, expected.z).normalize();
  return Math.acos(THREE.MathUtils.clamp(actual.dot(expectedDirection), -1, 1));
}

function buildWall(world: VoxelWorld): void {
  for (let x = 3; x <= 12; x += 1) {
    for (let y = 68; y <= 72; y += 1) world.setBlock(x, y, 8, BlockId.Stone);
  }
}

describe('arrow visual movement-segment orientation', () => {
  it('A/B/H aligns flight to the current movement while gravity changes only the next velocity', () => {
    const { arrows } = createFixture('arrow-flight-orientation');
    const origin = new Vec3(5.5, 70, 5.5);
    arrows.spawn(origin, new Vec3(0.8, 0.55, 0.25), 1.6, 6, true);
    const arrow = arrows.entities[0]!;
    const movement = arrow.velocity.clone();

    arrows.tick(0.05);

    expect(arrow.position.x).toBeCloseTo(origin.x + movement.x, 12);
    expect(arrow.position.y).toBeCloseTo(origin.y + movement.y, 12);
    expect(arrow.position.z).toBeCloseTo(origin.z + movement.z, 12);
    expect(arrow.velocity.x).toBeCloseTo(movement.x * ARROW_AIR_DRAG_PER_TICK, 12);
    expect(arrow.velocity.y).toBeCloseTo(
      movement.y * ARROW_AIR_DRAG_PER_TICK - ARROW_GRAVITY_PER_TICK,
      12,
    );
    expect(arrow.velocity.z).toBeCloseTo(movement.z * ARROW_AIR_DRAG_PER_TICK, 12);
    expect(angularError(visualForward(arrow), movement)).toBeLessThan(1e-7);
    expect(angularError(visualForward(arrow), arrow.velocity)).toBeGreaterThan(1e-3);
  });

  it('C/D embeds with zero simulation velocity and exact pre-zero impact orientation', () => {
    const { world, arrows } = createFixture('arrow-embedded-orientation');
    buildWall(world);
    arrows.spawn(new Vec3(6.5, 70.5, 13.5), new Vec3(0, 0, -1), 3, 6, false);
    const arrow = arrows.entities[0]!;

    // Two fixed steps make gravity alter the second segment before it reaches the wall.
    arrows.tick(0.1);

    expect(arrow.inGround).toBe(true);
    expect(arrow.velocity.lengthSq()).toBe(0);
    expect(arrow.embedded).toBeDefined();
    expect(arrow.visualVelocity.toArray()).toEqual(arrow.embedded!.impactVelocity.toArray());
    expect(angularError(visualForward(arrow), arrow.embedded!.impactVelocity)).toBeLessThan(1e-7);
  });

  it('E produces the same quaternion for repeated impacts with the same direction', () => {
    const { world, arrows } = createFixture('arrow-repeat-impact-orientation');
    buildWall(world);
    for (const x of [5.5, 9.5]) {
      arrows.spawn(new Vec3(x, 70.5, 13.5), new Vec3(0, 0, -1), 3, 6, false);
    }

    arrows.tick(0.1);

    const [first, second] = arrows.entities;
    expect(first?.inGround).toBe(true);
    expect(second?.inGround).toBe(true);
    expect((first!.visual as THREE.Object3D).quaternion.toArray()).toEqual(
      (second!.visual as THREE.Object3D).quaternion.toArray(),
    );
  });

  it('F keeps final orientation independent of interpolation/render timing', () => {
    const { arrows } = createFixture('arrow-render-timing-orientation');
    const impact = new Vec3(-0.35, 0.2, -2.8);
    arrows.applyNetwork('remote-a', 5, 70, 8, 0, 0, 0, false, {
      inGround: true,
      visualVelocity: impact,
    });
    arrows.applyNetwork('remote-b', 7, 70, 8, 0, 0, 0, false, {
      inGround: true,
      visualVelocity: impact,
    });
    const first = arrows.entities.find((arrow) => arrow.id === 'remote-a')!;
    const second = arrows.entities.find((arrow) => arrow.id === 'remote-b')!;

    arrows.applyRenderPose(first.id, 5, 70, 8, impact.x, impact.y, impact.z);
    for (const alpha of [0, 0.1, 0.5, 0.9, 1]) arrows.interpolateVisuals(alpha);
    arrows.applyRenderPose(second.id, 7, 70, 8, impact.x, impact.y, impact.z);

    expect((first.visual as THREE.Object3D).quaternion.toArray()).toEqual(
      (second.visual as THREE.Object3D).quaternion.toArray(),
    );
    expect(angularError(visualForward(first), impact)).toBeLessThan(1e-7);
  });

  it('G applies the same embedded invariant to skeleton projectiles', () => {
    const { world, mobs } = createFixture('skeleton-embedded-orientation');
    buildWall(world);
    const skeleton = mobs.spawn('skeleton', new Vec3(6.5, 69, 12), { force: true })!;
    (mobs as unknown as { spawnArrow: Function }).spawnArrow(skeleton, new Vec3(6.5, 70.5, 0), {});
    const projectile = [...(mobs as unknown as {
      projectiles: Map<string, PlayerArrow>;
    }).projectiles.values()][0]!;
    projectile.position.set(6.5, 70.5, 10.5);
    projectile.velocity.set(0.3, -0.15, -3);
    const impactVelocity = projectile.velocity.clone();

    (mobs as unknown as { updateProjectiles: Function }).updateProjectiles(0.05, undefined, {});

    expect(projectile.inGround).toBe(true);
    expect(projectile.velocity.lengthSq()).toBe(0);
    expect(projectile.visualVelocity.toArray()).toEqual(projectile.embedded!.impactVelocity.toArray());
    expect(projectile.embedded!.impactVelocity.toArray()).toEqual(impactVelocity.toArray());
    expect(angularError(visualForward(projectile), impactVelocity)).toBeLessThan(1e-7);
  });
});
