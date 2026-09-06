import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_APPEARANCE } from '../src/player/appearance/PlayerAppearance';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import { MinecraftSkinRegistry } from '../src/rendering/player/MinecraftSkin';
import { PlayerSkinGeometryCache } from '../src/rendering/player/PlayerSkinGeometry';
import { PlayerVisual } from '../src/rendering/player/PlayerVisual';
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

const visualFrame = {
  ...idle,
  invisible: false,
  hurtFlash: 0,
};

describe('player visual rig hierarchy', () => {
  it('parents head, arms and held item to upper body so crouch keeps the torso connected', () => {
    const skins = new MinecraftSkinRegistry();
    const geometries = new PlayerSkinGeometryCache();
    const items = new ItemVisualFactory();
    const visual = new PlayerVisual(skins, geometries, items, DEFAULT_PLAYER_APPEARANCE);
    expect(visual.rig.head.parent).toBe(visual.rig.upperBody);
    expect(visual.rig.body.parent).toBe(visual.rig.upperBody);
    expect(visual.rig.rightArm.parent).toBe(visual.rig.upperBody);
    expect(visual.rig.leftArm.parent).toBe(visual.rig.upperBody);
    expect(visual.rig.heldItem.parent).toBe(visual.rig.rightArm);
    expect(visual.rig.rightLeg.parent).toBe(visual.rig.upperBody.parent);
    expect(visual.rig.leftLeg.parent).toBe(visual.rig.upperBody.parent);

    visual.update(1 / 60, visualFrame);
    visual.root.updateMatrixWorld(true);
    const standHead = new THREE.Vector3();
    const standArm = new THREE.Vector3();
    visual.rig.head.getWorldPosition(standHead);
    visual.rig.rightArm.getWorldPosition(standArm);

    visual.update(1 / 60, { ...visualFrame, sneaking: true });
    visual.root.updateMatrixWorld(true);
    expect(visual.rig.upperBody.rotation.x).toBeLessThan(0);
    const sneakHead = new THREE.Vector3();
    const sneakArm = new THREE.Vector3();
    visual.rig.head.getWorldPosition(sneakHead);
    visual.rig.rightArm.getWorldPosition(sneakArm);
    expect(sneakHead.y).toBeLessThan(standHead.y - 0.02);
    expect(sneakArm.y).toBeLessThan(standArm.y - 0.02);

    visual.setArmor({
      head: 'diamond_helmet',
      chest: 'diamond_chestplate',
      legs: 'diamond_leggings',
      feet: 'diamond_boots',
    });
    visual.update(1 / 60, { ...visualFrame, sneaking: true });
    visual.root.updateMatrixWorld(true);
    const helmet = visual.rig.head.getObjectByName('player-armor:head:head');
    expect(helmet?.parent).toBe(visual.rig.head);
    expect(visual.rig.body.getObjectByName('player-armor:chest:body')).toBeTruthy();
    expect(visual.rig.rightArm.getObjectByName('player-armor:chest:rightArm')).toBeTruthy();
    expect(visual.rig.rightLeg.getObjectByName('player-armor:legs:rightLeg')).toBeTruthy();
    expect(visual.rig.rightLeg.getObjectByName('player-armor:feet:rightLeg')).toBeTruthy();

    visual.swing();
    visual.update(0.12, { ...visualFrame, sneaking: true });
    expect(visual.rig.rightArm.rotation.x).toBeGreaterThan(0.5);
    expect(visual.rig.heldItem.parent).toBe(visual.rig.rightArm);
    expect(visual.rig.head.getObjectByName('player-armor:head:head')).toBeTruthy();

    visual.setArmor({ head: null, chest: null, legs: null, feet: null });
    expect(visual.rig.head.getObjectByName('player-armor:head:head')).toBeFalsy();

    visual.dispose();
    geometries.dispose();
    items.dispose();
    skins.dispose();
  });
});
