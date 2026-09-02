import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { shouldCyclePerspectiveOnKey } from '../src/input/InputManager';
import {
  THIRD_PERSON_CAMERA_DISTANCE,
  availableThirdPersonDistance,
  nextCameraPerspective,
  segmentAabbDistance,
  smoothThirdPersonDistance,
  type CameraCollisionSource,
} from '../src/rendering/player/ThirdPersonCamera';

const source = (...boxes: Array<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }>): CameraCollisionSource => ({
  collisionBoxes: () => boxes,
});
describe('third-person camera', () => {
  it('cycles first -> back -> front -> first', () => {
    expect(nextCameraPerspective('firstPerson')).toBe('thirdPersonBack');
    expect(nextCameraPerspective('thirdPersonBack')).toBe('thirdPersonFront');
    expect(nextCameraPerspective('thirdPersonFront')).toBe('firstPerson');
  });

  it('captures one F5 edge only in active gameplay and leaves browser/menu F5 alone', () => {
    const active = { code: 'F5', repeat: false, typing: false, canCapture: () => true, hasCallback: true };
    expect(shouldCyclePerspectiveOnKey(active)).toBe(true);
    expect(shouldCyclePerspectiveOnKey({ ...active, repeat: true })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, typing: true })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, canCapture: () => false })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, hasCallback: false })).toBe(false);
    let captureReads = 0;
    expect(shouldCyclePerspectiveOnKey({
      ...active,
      code: 'KeyW',
      canCapture: () => { captureReads += 1; return true; },
    })).toBe(false);
    expect(captureReads).toBe(0);
  });

  it('uses the Minecraft-like four block default when unobstructed', () => {
    const distance = availableThirdPersonDistance(
      new THREE.Vector3(0, 1.6, 0),
      new THREE.Vector3(0, 0, 1),
      THIRD_PERSON_CAMERA_DISTANCE,
      source(),
    );
    expect(distance).toBe(4);
  });

  it('pulls in before a solid collision using the corner-probed camera volume', () => {
    const distance = availableThirdPersonDistance(
      new THREE.Vector3(0.5, 1.6, 0),
      new THREE.Vector3(0, 0, 1),
      4,
      source({ minX: 0, minY: 0, minZ: 2, maxX: 1, maxY: 3, maxZ: 3 }),
    );
    expect(distance).toBeCloseTo(1.86, 5);
  });

  it('detects partial authored boxes such as a slab without treating empty decoration as solid', () => {
    const pivot = new THREE.Vector3(0.5, 0.35, 0);
    const direction = new THREE.Vector3(0, 0, 1);
    const slab = { minX: 0, minY: 0, minZ: 1.5, maxX: 1, maxY: 0.5, maxZ: 2.5 };
    expect(availableThirdPersonDistance(pivot, direction, 4, source(slab))).toBeLessThan(1.5);
    expect(availableThirdPersonDistance(pivot, direction, 4, source())).toBe(4);
  });

  it('restores distance smoothly after a wall disappears but retracts immediately', () => {
    expect(smoothThirdPersonDistance(4, 1.2, 1 / 60)).toBe(1.2);
    const restored = smoothThirdPersonDistance(1.2, 4, 1 / 60);
    expect(restored).toBeGreaterThan(1.2);
    expect(restored).toBeLessThan(4);
    expect(smoothThirdPersonDistance(restored, 4, 1)).toBeCloseTo(4, 4);
  });

  it('clips finite segments and ignores boxes behind the pivot', () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const direction = new THREE.Vector3(0, 0, 1);
    expect(segmentAabbDistance(origin, direction, 4, {
      minX: -1, minY: -1, minZ: 2, maxX: 1, maxY: 1, maxZ: 3,
    })).toBe(2);
    expect(segmentAabbDistance(origin, direction, 4, {
      minX: -1, minY: -1, minZ: -3, maxX: 1, maxY: 1, maxZ: -2,
    })).toBeUndefined();
  });
});
