import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ARROW_AIR_DRAG_PER_TICK,
  ARROW_GRAVITY_PER_TICK,
  applyArrowDragAndGravity,
  inaccurateArrowDirection,
} from '../src/combat/ArrowPhysics';
import { bowCharge } from '../src/combat/CombatSystem';

describe('Java-like arrow units', () => {
  it('keeps full bow charge at 3 blocks per game tick', () => {
    expect(bowCharge(20).launchSpeed).toBe(3);
    const velocity = inaccurateArrowDirection(new THREE.Vector3(0, 0, -1), () => 0.5)
      .multiplyScalar(bowCharge(20).launchSpeed);
    expect(velocity.length()).toBeCloseTo(3);
  });

  it('applies 0.99 air drag and 0.05 gravity once per tick', () => {
    expect(ARROW_AIR_DRAG_PER_TICK).toBe(0.99);
    expect(ARROW_GRAVITY_PER_TICK).toBe(0.05);
    const velocity = applyArrowDragAndGravity(new THREE.Vector3(3, 0, 0));
    expect(velocity.x).toBeCloseTo(2.97);
    expect(velocity.y).toBeCloseTo(-0.05);
  });
});
