import { describe, expect, it } from 'vitest';
import { PlayerVisualAnimator } from '../src/rendering/player/PlayerVisualAnimator';

const idle = {
  viewYaw: 0,
  viewPitch: 0,
  movementSpeed: 0,
  onGround: true,
  sneaking: false,
  sprinting: false,
  verticalVelocity: 0,
  mining: false,
  bowCharge: 0,
  swordBlocking: false,
  foodUseProgress: 0,
};

describe('player visual animator', () => {
  it('keeps head turn bounded and lets the body follow large look changes', () => {
    const animator = new PlayerVisualAnimator();
    animator.advance(0, idle);
    let pose = animator.advance(1 / 60, { ...idle, viewYaw: Math.PI });
    expect(Math.abs(pose.headYaw)).toBeLessThanOrEqual(72 * Math.PI / 180 + 1e-8);
    for (let frame = 0; frame < 90; frame += 1) pose = animator.advance(1 / 60, { ...idle, viewYaw: Math.PI });
    expect(Math.abs(pose.bodyYaw)).toBeGreaterThan(1);
  });

  it('swings opposite arms and legs while walking and leans on sneak', () => {
    const animator = new PlayerVisualAnimator();
    let pose = animator.advance(1 / 60, { ...idle, movementSpeed: 4 });
    for (let frame = 0; frame < 12; frame += 1) pose = animator.advance(1 / 60, { ...idle, movementSpeed: 4 });
    expect(Math.sign(pose.rightArmX)).toBe(-Math.sign(pose.rightLegX));
    expect(Math.sign(pose.leftArmX)).toBe(-Math.sign(pose.leftLegX));
    const sneak = animator.advance(1 / 60, { ...idle, sneaking: true });
    expect(sneak.bodyPitch).toBeLessThan(0);
    expect(sneak.bodyYOffset).toBeLessThan(0);
  });

  it('overlays attack, bow, sword block and food poses without touching simulation state', () => {
    const animator = new PlayerVisualAnimator();
    animator.advance(0, idle);
    animator.triggerSwing();
    const attack = animator.advance(0.12, idle);
    expect(attack.swingProgress).toBeLessThan(1);
    expect(attack.rightArmX).toBeGreaterThan(0.5);
    const block = animator.advance(1 / 60, { ...idle, swordBlocking: true });
    expect(block.rightArmY).toBeCloseTo(-0.62);
    const eat = animator.advance(1 / 60, { ...idle, foodUseProgress: 0.5 });
    expect(eat.rightArmX).toBeGreaterThan(1);
    const bow = animator.advance(1 / 60, { ...idle, bowCharge: 0.8, viewPitch: 0.2 });
    expect(bow.rightArmX).toBeCloseTo(Math.PI / 2 - 0.2);
    expect(bow.leftArmX).toBeCloseTo(bow.rightArmX);
  });
});
