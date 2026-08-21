import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIRST_PERSON_SPRITE_POSE } from '../src/items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../src/rendering/FirstPersonRenderer';
import generatedItemGeometrySource from '../src/rendering/GeneratedItemGeometry.ts?raw';
import {
  VANILLA_GENERATED_DEPTH,
  createGeneratedItemGeometry,
  generatedItemInfo,
} from '../src/rendering/GeneratedItemGeometry';
import { ItemVisualFactory } from '../src/rendering/ItemVisualFactory';
import {
  VANILLA_BAKED_MODEL_CENTERING,
  VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET,
  VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND,
  VANILLA_HAND_FOV_DEGREES,
  VANILLA_ITEM_TRANSLATION_PIXEL,
  VIEWMODEL_FAR,
  VIEWMODEL_FOV_DEGREES,
  VIEWMODEL_NEAR,
  composeCurrentProductionIdleSpriteMatrix,
  composeVanillaIdleFirstPersonRightHand,
  minecraftItemTransformToMatrix4,
  minecraftRotationDegToQuaternion,
  projectGeneratedReferencePoints,
} from '../src/rendering/heldItemVanillaTransform';

/** djb2 of `GeneratedItemGeometry.ts` at the closed topology baseline. */
const GENERATED_ITEM_GEOMETRY_SOURCE_DJB2 = 'be428190';

const PLUS8_TOPOLOGY = Object.freeze({
  vertexCount: 56,
  triangleCount: 28,
  sideSpans: 12,
  pos: '8ec70b95',
  nrm: '5f4a4265',
  uv: '7b4c2a85',
  idx: '1e726665',
});

function plusMask(size: number): { width: number; height: number; alpha: Uint8Array } {
  const alpha = new Uint8Array(size * size);
  const mid = Math.floor(size / 2);
  for (let i = 0; i < size; i += 1) {
    alpha[mid * size + i] = 255;
    alpha[i * size + mid] = 255;
  }
  return { width: size, height: size, alpha };
}

function fnv1a(values: ArrayLike<number>, scale = 1e6): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < values.length; i += 1) {
    hash ^= Math.round(values[i]! * scale);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function idleFrame(overrides: Partial<FirstPersonFrameState> = {}): FirstPersonFrameState {
  return {
    visible: true,
    movementSpeed: 0,
    onGround: true,
    sprinting: false,
    mining: false,
    foodUseProgress: 0,
    bowCharge: 0,
    shieldRaised: false,
    ...overrides,
  };
}

function columnLength(matrix: THREE.Matrix4, column: number): number {
  const e = matrix.elements;
  const x = e[column * 4]!;
  const y = e[column * 4 + 1]!;
  const z = e[column * 4 + 2]!;
  return Math.hypot(x, y, z);
}

describe('GeneratedItemGeometry closed baseline', () => {
  it('does not modify the production geometry source file', () => {
    let hash = 5381;
    for (let i = 0; i < generatedItemGeometrySource.length; i += 1) {
      hash = (hash << 5) + hash ^ generatedItemGeometrySource.charCodeAt(i);
    }
    expect((hash >>> 0).toString(16)).toBe(GENERATED_ITEM_GEOMETRY_SOURCE_DJB2);
  });

  it('keeps plus-mask(8) topology, UV and winding buffers unchanged', () => {
    const geometry = createGeneratedItemGeometry(plusMask(8));
    const info = generatedItemInfo(geometry);
    expect(info.vertexCount).toBe(PLUS8_TOPOLOGY.vertexCount);
    expect(info.triangleCount).toBe(PLUS8_TOPOLOGY.triangleCount);
    expect(info.sideSpans).toBe(PLUS8_TOPOLOGY.sideSpans);
    expect(info.frontQuads).toBe(1);
    expect(info.backQuads).toBe(1);
    expect(info.depth).toBeCloseTo(VANILLA_GENERATED_DEPTH);
    expect(fnv1a(geometry.getAttribute('position').array)).toBe(PLUS8_TOPOLOGY.pos);
    expect(fnv1a(geometry.getAttribute('normal').array)).toBe(PLUS8_TOPOLOGY.nrm);
    expect(fnv1a(geometry.getAttribute('uv').array)).toBe(PLUS8_TOPOLOGY.uv);
    expect(fnv1a(geometry.getIndex()!.array, 1)).toBe(PLUS8_TOPOLOGY.idx);
    geometry.dispose();
  });
});

describe('vanilla first-person matrix adapter', () => {
  it('converts JSON pixels by 1/16 and composes T * Rx * Ry * Rz * S', () => {
    expect(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND.rotationDeg).toEqual([0, -90, 25]);
    expect(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND.translationPx).toEqual([1.13, 3.2, 1.13]);
    expect(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND.scale).toEqual([0.68, 0.68, 0.68]);
    const translationX = 1.13 * VANILLA_ITEM_TRANSLATION_PIXEL;
    const translationY = 3.2 * VANILLA_ITEM_TRANSLATION_PIXEL;
    const translationZ = 1.13 * VANILLA_ITEM_TRANSLATION_PIXEL;
    expect(translationX).toBeCloseTo(0.070625, 10);
    expect(translationY).toBeCloseTo(0.2, 10);

    const display = minecraftItemTransformToMatrix4(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND);
    const origin = new THREE.Vector3().applyMatrix4(display);
    expect(origin.x).toBeCloseTo(translationX, 8);
    expect(origin.y).toBeCloseTo(translationY, 8);
    expect(origin.z).toBeCloseTo(translationZ, 8);

    const front = new THREE.Vector3(0, 0, 1).transformDirection(display);
    expect(front.x).toBeCloseTo(-1, 8);
    expect(front.y).toBeCloseTo(0, 8);
    expect(front.z).toBeCloseTo(0, 8);
    expect(columnLength(display, 0)).toBeCloseTo(0.68, 8);
    expect(columnLength(display, 1)).toBeCloseTo(0.68, 8);
    expect(columnLength(display, 2)).toBeCloseTo(0.68, 8);
  });

  it('uses explicit Rx*Ry*Rz rather than relying on Three.js Euler order', () => {
    const vanilla = minecraftRotationDegToQuaternion([0, -90, 25]);
    const threeXyz = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      0,
      -90 * Math.PI / 180,
      25 * Math.PI / 180,
      'XYZ',
    ));
    // Three.js Euler XYZ happens to equal 1.9 GlStateManager X-then-Y-then-Z
    // for this triple. That coincidence is not the conversion API: 1.16
    // ItemTransform uses qz*qy*qx = Rz*Ry*Rx, which maps +X differently.
    expect(vanilla.angleTo(threeXyz)).toBeLessThan(1e-6);

    const laterMinecraft = new THREE.Matrix4()
      .makeRotationZ(25 * Math.PI / 180)
      .multiply(new THREE.Matrix4().makeRotationY(-90 * Math.PI / 180));
    const vanillaX = new THREE.Vector3(1, 0, 0).applyQuaternion(vanilla);
    const laterX = new THREE.Vector3(1, 0, 0).transformDirection(laterMinecraft);
    expect(vanillaX.y).toBeCloseTo(Math.sin(25 * Math.PI / 180), 8);
    expect(vanillaX.z).toBeCloseTo(Math.cos(25 * Math.PI / 180), 8);
    expect(laterX.distanceTo(vanillaX)).toBeGreaterThan(0.3);

    const displayOrigin = new THREE.Vector3().applyMatrix4(
      minecraftItemTransformToMatrix4(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND),
    );
    expect(displayOrigin.length()).toBeGreaterThan(0.2);
  });

  it('omits baked-model centering for already-centered generated geometry', () => {
    const idle = composeVanillaIdleFirstPersonRightHand();
    const withCenter = composeVanillaIdleFirstPersonRightHand({ includeBakedModelCentering: true });
    const origin = new THREE.Vector3().applyMatrix4(idle);
    expect(origin.x).toBeCloseTo(
      VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET.x + 1.13 * VANILLA_ITEM_TRANSLATION_PIXEL,
      8,
    );
    expect(origin.y).toBeCloseTo(
      VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET.y + 3.2 * VANILLA_ITEM_TRANSLATION_PIXEL,
      8,
    );
    expect(origin.z).toBeCloseTo(
      VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET.z + 1.13 * VANILLA_ITEM_TRANSLATION_PIXEL,
      8,
    );
    expect(origin.x).toBeCloseTo(0.630625, 8);
    expect(origin.y).toBeCloseTo(-0.32, 8);
    expect(origin.z).toBeCloseTo(-0.649375, 8);

    const centeredOrigin = new THREE.Vector3().applyMatrix4(withCenter);
    expect(centeredOrigin.distanceTo(origin)).toBeGreaterThan(0.2);
    expect(VANILLA_BAKED_MODEL_CENTERING).toEqual([-0.5, -0.5, -0.5]);
  });

  it('keeps production idle sprite pose as the unapplied calibration baseline', () => {
    expect(FIRST_PERSON_SPRITE_POSE.position).toEqual([0.50, -0.56, -0.82]);
    expect(FIRST_PERSON_SPRITE_POSE.rotationDeg).toEqual([0, 0, 14]);
    expect(FIRST_PERSON_SPRITE_POSE.scale).toBe(0.85);
    const production = composeCurrentProductionIdleSpriteMatrix();
    const origin = new THREE.Vector3().applyMatrix4(production);
    expect(origin.x).toBeCloseTo(0.50, 8);
    expect(origin.y).toBeCloseTo(-0.56, 8);
    expect(origin.z).toBeCloseTo(-0.82, 8);
    const front = new THREE.Vector3(0, 0, 1).transformDirection(production);
    expect(front.x).toBeCloseTo(0, 8);
    expect(front.y).toBeCloseTo(0, 8);
    expect(front.z).toBeCloseTo(1, 8);
  });

  it('projects reference points at viewmodel FOV 70 and 16:9 without applying vanilla to the mesh', () => {
    expect(VIEWMODEL_FOV_DEGREES).toBe(VANILLA_HAND_FOV_DEGREES);
    expect(VIEWMODEL_NEAR).toBe(0.01);
    expect(VIEWMODEL_FAR).toBe(12);
    const camera = new THREE.PerspectiveCamera(VIEWMODEL_FOV_DEGREES, 2048 / 1152, VIEWMODEL_NEAR, VIEWMODEL_FAR);
    camera.updateProjectionMatrix();
    const vanilla = projectGeneratedReferencePoints(composeVanillaIdleFirstPersonRightHand(), camera);
    const production = projectGeneratedReferencePoints(composeCurrentProductionIdleSpriteMatrix(), camera);
    const vanillaOrigin = vanilla.find((point) => point.name === 'origin')!;
    const productionOrigin = production.find((point) => point.name === 'origin')!;
    expect(vanillaOrigin.screen01[0]).toBeGreaterThan(productionOrigin.screen01[0]);
    expect(vanillaOrigin.screen01[1]).toBeLessThan(productionOrigin.screen01[1]);
    expect(vanillaOrigin.screen01[0]).toBeCloseTo(0.8902, 3);
    expect(vanillaOrigin.screen01[1]).toBeCloseTo(0.8518, 3);
    expect(productionOrigin.screen01[0]).toBeCloseTo(0.7449, 3);
    expect(productionOrigin.screen01[1]).toBeCloseTo(0.9876, 3);
    const vanillaTopLeft = vanilla.find((point) => point.name === 'topLeft')!;
    const vanillaTopRight = vanilla.find((point) => point.name === 'topRight')!;
    // After Ry(−90) the sprite plane is YZ in camera space, so front corners
    // share camera X; remaining screen-X spread is perspective, not yaw.
    expect(vanillaTopLeft.camera[0]).toBeCloseTo(vanillaTopRight.camera[0], 6);
    expect(Math.abs(vanillaTopLeft.screen01[0] - vanillaTopRight.screen01[0])).toBeGreaterThan(0.15);
  });
});

describe('FirstPersonRenderer idle matrix debug', () => {
  it('reports the live production matrix and a non-applied vanilla proposal', () => {
    const factory = new ItemVisualFactory();
    const viewmodel = new FirstPersonRenderer(factory, { freezeIdleMotion: true });
    viewmodel.resize(1600, 900);
    viewmodel.setHeldItems('iron_pickaxe');
    viewmodel.update(0.05, idleFrame());
    const snapshot = viewmodel.captureHeldItemMatrixDebug();
    expect(snapshot).toBeDefined();
    expect(snapshot?.camera.fov).toBe(VIEWMODEL_FOV_DEGREES);
    expect(snapshot?.camera.aspect).toBeCloseTo(1600 / 900, 8);
    expect(snapshot?.camera.near).toBe(VIEWMODEL_NEAR);
    expect(snapshot?.freezeIdleMotion).toBe(true);
    expect(snapshot?.itemId).toBe('iron_pickaxe');

    const expected = composeCurrentProductionIdleSpriteMatrix();
    for (let i = 0; i < 16; i += 1) {
      expect(snapshot!.itemWorld.elements[i], `world[${i}]`).toBeCloseTo(expected.elements[i]!, 6);
      expect(snapshot!.modelView.elements[i], `mv[${i}]`).toBeCloseTo(expected.elements[i]!, 6);
    }

    const vanilla = composeVanillaIdleFirstPersonRightHand();
    for (let i = 0; i < 16; i += 1) {
      expect(snapshot!.vanillaModelView.elements[i], `vanilla[${i}]`).toBeCloseTo(vanilla.elements[i]!, 8);
    }
    const liveFront = viewmodel.heldFrontWorldNormal()!;
    expect(liveFront.z).toBeCloseTo(1, 6);
    const overlay = viewmodel.formatHeldItemMatrixOverlay();
    expect(overlay).toContain('NOT applied');
    expect(overlay).toContain('screen01');
    expect(overlay).toContain('topLeft');
    viewmodel.dispose();
    factory.dispose();
  });
});
