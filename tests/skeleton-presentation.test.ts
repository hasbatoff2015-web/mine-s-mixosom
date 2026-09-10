import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MobVisualState } from '../src/entities/EntityHost';
import {
  SKELETON_BOW_HAND_Y,
  SKELETON_BOW_SCALE,
  SKELETON_RANGED_ARM_POSE,
  createThreeEntityHost,
} from '../src/entities/ThreeEntityHost';

function visualState(
  created: ReturnType<ReturnType<typeof createThreeEntityHost>['createMob']>,
  state: 'idle' | 'attack',
): MobVisualState {
  return {
    kind: 'skeleton', model: created!.model, visual: created!.visual,
    x: 2, y: 40, z: 3, yaw: 0.4, walkPhase: 0.7, visualAge: 1,
    locomotionSpeed: 1, state, stateSeconds: 0.1, deathSeconds: 0,
    fuseSeconds: 0, onFire: false, width: 0.6, height: 1.99, hurtFlashSeconds: 0,
  };
}

describe('skeleton ranged presentation', () => {
  it('creates one ItemVisualFactory bow on a right-arm hand anchor for the visual lifetime', () => {
    const scene = new THREE.Scene();
    const host = createThreeEntityHost(scene);
    const created = host.createMob('skeleton');
    const arm = created.model.arms[0] as THREE.Object3D;
    const anchor = created.model.heldItemAnchor as THREE.Object3D;
    const bow = created.model.heldItem as THREE.Object3D;
    expect(anchor.name).toBe('mob:skeleton:bow-anchor');
    expect(anchor.parent).toBe(arm);
    expect(anchor.position.y).toBe(SKELETON_BOW_HAND_Y);
    expect(bow.name).toBe('mob:skeleton:held-bow');
    expect(bow.userData.itemId).toBe('bow');
    expect(bow.parent).toBe(anchor);
    expect(bow.scale.x).toBe(SKELETON_BOW_SCALE);
    host.syncMob(visualState(created, 'idle'));
    host.syncMob(visualState(created, 'attack'));
    expect(created.visual.getObjectByName('mob:skeleton:held-bow')).toBe(bow);
    expect((created.visual.getObjectByName('mob:skeleton:bow-anchor') as THREE.Object3D).children).toHaveLength(1);
    host.disposeVisual(created.visual, { materials: true });
    host.dispose();
  });

  it('uses distinct bow and draw arm rotations during ranged attack', () => {
    const host = createThreeEntityHost(new THREE.Scene());
    const created = host.createMob('skeleton');
    host.syncMob(visualState(created, 'attack'));
    const bowArm = created.model.arms[0] as THREE.Object3D;
    const drawArm = created.model.arms[1] as THREE.Object3D;
    expect(bowArm.rotation.toArray().slice(0, 3)).toEqual([
      SKELETON_RANGED_ARM_POSE.bow.x,
      SKELETON_RANGED_ARM_POSE.bow.y,
      SKELETON_RANGED_ARM_POSE.bow.z,
    ]);
    expect(drawArm.rotation.toArray().slice(0, 3)).toEqual([
      SKELETON_RANGED_ARM_POSE.draw.x,
      SKELETON_RANGED_ARM_POSE.draw.y,
      SKELETON_RANGED_ARM_POSE.draw.z,
    ]);
    expect(bowArm.rotation.x).not.toBe(drawArm.rotation.x);
    expect(bowArm.rotation.y).not.toBe(drawArm.rotation.y);
    const anchor = created.model.heldItemAnchor as THREE.Object3D;
    expect(anchor.rotation.x + bowArm.rotation.x).toBeCloseTo(0, 6);
    host.disposeVisual(created.visual, { materials: true });
    host.dispose();
  });
});
