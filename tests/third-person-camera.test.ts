import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_CAMERA_TOGGLE_CODE, shouldCyclePerspectiveOnKey } from '../src/input/InputManager';
import { Game } from '../src/core/Game';
import { Inventory } from '../src/inventory';
import {
  THIRD_PERSON_CAMERA_DISTANCE,
  availableThirdPersonDistance,
  effectiveCameraPerspective,
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

  it('shows third-person back only while resting and restores the stored preference', () => {
    expect(effectiveCameraPerspective('firstPerson', false)).toBe('firstPerson');
    expect(effectiveCameraPerspective('firstPerson', true)).toBe('thirdPersonBack');
    expect(effectiveCameraPerspective('firstPerson', false)).toBe('firstPerson');
    expect(effectiveCameraPerspective('thirdPersonFront', true)).toBe('thirdPersonBack');
    expect(effectiveCameraPerspective('thirdPersonFront', false)).toBe('thirdPersonFront');
  });

  it('does not cycle the stored camera preference during bed rest', () => {
    const game = Object.create(Game.prototype) as Game;
    Object.assign(game, { cameraPerspective: 'firstPerson', session: { restingBed: { x: 0, y: 0, z: 0, facing: 'north' } } });
    const cycle = (game as unknown as { cycleCameraPerspective: () => void }).cycleCameraPerspective.bind(game);
    cycle();
    expect(game.currentCameraPerspective).toBe('firstPerson');
    Object.assign(game, { session: { restingBed: undefined } });
    cycle();
    expect(game.currentCameraPerspective).toBe('thirdPersonBack');
  });

  it('switches world model, hands and camera together on the first resting frame', () => {
    const game = Object.create(Game.prototype) as any;
    const visible: boolean[] = [];
    const hands: boolean[] = [];
    const session = {
      restingBed: undefined as undefined | { x: number; y: number; z: number; facing: 'north' },
      inventory: new Inventory(),
      playerVisual: {
        root: { position: new THREE.Vector3() },
        setArmor: vi.fn(), setOffhandItem: vi.fn(),
        setVisible: (value: boolean) => visible.push(value),
        update: vi.fn(), applyWorldLight: vi.fn(),
      },
      player: { velocity: { x: 0, y: 0, z: 0 }, eyeHeight: 1.62,
        onGround: true, sneaking: false, sprinting: false },
      combat: { swordBlocking: false }, bowUseTicks: 0, foodUseTicks: 0,
      survival: { invisible: false, isOnFire: false, hasEffect: () => false },
      world: { timeOfDay: 0 }, cameraCollision: source(),
    };
    Object.assign(game, {
      cameraPerspective: 'firstPerson', session, lifecycle: { state: 'PLAYING' },
      ui: { isInventoryOpen: () => false }, input: { yaw: 0, pitch: 0, mining: false },
      firstPersonFrameState: {}, firstPerson: { update: (_delta: number, state: { visible: boolean }) => hands.push(state.visible) },
      camera: new THREE.PerspectiveCamera(), cameraPivot: new THREE.Vector3(),
      cameraTravelDirection: new THREE.Vector3(), thirdPersonCameraDistance: THIRD_PERSON_CAMERA_DISTANCE,
      frontCameraLook: { yaw: 0, pitch: 0 }, renderDeltaSeconds: 1 / 60,
      hurt: { cameraRoll: () => 0, modelIntensity: () => 0 },
    });
    const frame = () => {
      game.updateFirstPerson(1 / 60);
      game.updatePlayerPresentation(session, new THREE.Vector3(0, 70, 0), 0);
    };
    frame();
    expect(hands.at(-1)).toBe(true);
    expect(visible.at(-1)).toBe(false);
    session.restingBed = { x: 0, y: 70, z: 0, facing: 'north' };
    frame();
    expect(hands.at(-1)).toBe(false);
    expect(visible.at(-1)).toBe(true);
    expect(game.camera.position.z).toBeGreaterThan(game.cameraPivot.z);
    expect(game.currentCameraPerspective).toBe('firstPerson');
    session.restingBed = undefined;
    frame();
    expect(hands.at(-1)).toBe(true);
    expect(visible.at(-1)).toBe(false);
    expect(game.currentCameraPerspective).toBe('firstPerson');

    game.setCameraPerspective('thirdPersonFront');
    session.restingBed = { x: 0, y: 70, z: 0, facing: 'north' };
    frame();
    expect(hands.at(-1)).toBe(false);
    expect(visible.at(-1)).toBe(true);
    expect(game.camera.position.z).toBeGreaterThan(game.cameraPivot.z);
    session.restingBed = undefined;
    frame();
    expect(game.currentCameraPerspective).toBe('thirdPersonFront');
    expect(game.camera.position.z).toBeLessThan(game.cameraPivot.z);
  });

  it('captures one KeyC edge only in active gameplay and leaves F5 / menu typing alone', () => {
    expect(DESKTOP_CAMERA_TOGGLE_CODE).toBe('KeyC');
    const active = { code: DESKTOP_CAMERA_TOGGLE_CODE, repeat: false, typing: false, canCapture: () => true, hasCallback: true };
    expect(shouldCyclePerspectiveOnKey(active)).toBe(true);
    expect(shouldCyclePerspectiveOnKey({ ...active, code: 'F5' })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, code: 'KeyW' })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, code: 'KeyF' })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, repeat: true })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, typing: true })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, canCapture: () => false })).toBe(false);
    expect(shouldCyclePerspectiveOnKey({ ...active, hasCallback: false })).toBe(false);
    let captureReads = 0;
    expect(shouldCyclePerspectiveOnKey({
      ...active,
      code: 'F5',
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
