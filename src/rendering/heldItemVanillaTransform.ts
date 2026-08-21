import * as THREE from 'three';
import { FIRST_PERSON_SPRITE_POSE, type RenderVector } from '../items';
import { VANILLA_GENERATED_DEPTH } from './GeneratedItemGeometry';

/**
 * Canonical Minecraft Java 1.9 item/generated and item/handheld
 * `display.firstperson_righthand` JSON. Translation is in model pixels;
 * the vanilla deserializer multiplies it by 1/16 to get blocks.
 *
 * `item/handheld` inherits the same first-person right-hand display as
 * `item/generated`. Do not copy these Euler degrees into Three.js
 * `rotation.set` — compose them through {@link minecraftItemTransformToMatrix4}.
 */
export const VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND = Object.freeze({
  rotationDeg: [0, -90, 25] as RenderVector,
  translationPx: [1.13, 3.2, 1.13] as RenderVector,
  scale: [0.68, 0.68, 0.68] as RenderVector,
});

/** Model-pixel → block units used by `ItemTransform` JSON deserialization. */
export const VANILLA_ITEM_TRANSLATION_PIXEL = 1 / 16;

/**
 * `ItemRenderer.transformSideFirstPerson` for the right hand at idle
 * (`equipProgress = 0`): `translate(0.56, -0.52, -0.72)`.
 */
export const VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET = Object.freeze({
  x: 0.56,
  y: -0.52,
  z: -0.72,
});

/**
 * Baked item/block models occupy [0, 1]. Vanilla `ItemRenderer.renderItem`
 * then applies `translate(-0.5, -0.5, -0.5)`.
 *
 * `GeneratedItemGeometry` and cube block items are already centered on the
 * origin (`[-0.5, 0.5]` on X/Y, Z `±depth/2`), so production must not apply
 * this translation a second time.
 */
export const VANILLA_BAKED_MODEL_CENTERING: RenderVector = [-0.5, -0.5, -0.5];

/** Vertical FOV of the vanilla *hand* pass (`getFOVModifier(..., false)`). */
export const VANILLA_HAND_FOV_DEGREES = 70;

/** Vanilla hand-pass near plane (`gluPerspective` in `EntityRenderer`). */
export const VANILLA_HAND_NEAR = 0.05;

export const VIEWMODEL_FOV_DEGREES = 70;
export const VIEWMODEL_NEAR = 0.01;
export const VIEWMODEL_FAR = 12;

export interface MinecraftItemDisplayTransform {
  readonly rotationDeg: RenderVector;
  readonly translationPx: RenderVector;
  readonly scale: RenderVector;
}

export interface GeneratedHeldReferencePoint {
  readonly name: 'origin' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  readonly local: RenderVector;
}

const HALF_DEPTH = VANILLA_GENERATED_DEPTH / 2;

/**
 * Front-face bounds of generated geometry in item-local space.
 * Top-left is (−X, +Y) looking along +Z.
 */
export const GENERATED_HELD_REFERENCE_POINTS: readonly GeneratedHeldReferencePoint[] = Object.freeze([
  { name: 'origin', local: [0, 0, 0] },
  { name: 'topLeft', local: [-0.5, 0.5, HALF_DEPTH] },
  { name: 'topRight', local: [0.5, 0.5, HALF_DEPTH] },
  { name: 'bottomLeft', local: [-0.5, -0.5, HALF_DEPTH] },
  { name: 'bottomRight', local: [0.5, -0.5, HALF_DEPTH] },
]);

function degToRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

/**
 * Minecraft 1.9 `ItemTransform.apply` / `ItemCameraTransforms.applyTransformSide`
 * for the right hand: `T * Rx * Ry * Rz * S` with JSON Euler in degrees and
 * translation already converted to blocks.
 *
 * This matches sequential `GlStateManager.translate/rotateX/rotateY/rotateZ/scale`
 * (each call right-multiplies the current GL matrix). It is *not* a Three.js
 * Euler copied into `Object3D.rotation`.
 */
export function minecraftItemTransformToMatrix4(
  transform: MinecraftItemDisplayTransform,
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  const tx = transform.translationPx[0] * VANILLA_ITEM_TRANSLATION_PIXEL;
  const ty = transform.translationPx[1] * VANILLA_ITEM_TRANSLATION_PIXEL;
  const tz = transform.translationPx[2] * VANILLA_ITEM_TRANSLATION_PIXEL;
  const rx = new THREE.Matrix4().makeRotationX(degToRad(transform.rotationDeg[0]));
  const ry = new THREE.Matrix4().makeRotationY(degToRad(transform.rotationDeg[1]));
  const rz = new THREE.Matrix4().makeRotationZ(degToRad(transform.rotationDeg[2]));
  const scale = new THREE.Matrix4().makeScale(transform.scale[0], transform.scale[1], transform.scale[2]);
  return target
    .makeTranslation(tx, ty, tz)
    .multiply(rx)
    .multiply(ry)
    .multiply(rz)
    .multiply(scale);
}

/**
 * Rotation-only quaternion of a Minecraft item-display Euler triple, using the
 * 1.9 GL multiply order `Rx * Ry * Rz`. Identity basis: Minecraft item space
 * and Three.js are both Y-up, right-handed, camera looks −Z. No axis swap.
 *
 * Three.js `Euler(..., 'XYZ')` happens to match this order, but that is not
 * the conversion contract. Later vanilla (`qz * qy * qx`) does not match, and
 * the idle first-person path still needs hand offset, 1/16 translation, and
 * JSON scale — not a pasted Euler on the item root.
 */
export function minecraftRotationDegToQuaternion(
  rotationDeg: RenderVector,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  const rotation = new THREE.Matrix4()
    .makeRotationX(degToRad(rotationDeg[0]))
    .multiply(new THREE.Matrix4().makeRotationY(degToRad(rotationDeg[1])))
    .multiply(new THREE.Matrix4().makeRotationZ(degToRad(rotationDeg[2])));
  return target.setFromRotationMatrix(rotation);
}

export interface VanillaIdleFirstPersonOptions {
  /**
   * When true, appends vanilla `T(-0.5)` for uncentered baked [0,1] models.
   * Leave false for `GeneratedItemGeometry` and centered cube items.
   */
  readonly includeBakedModelCentering?: boolean;
}

/**
 * Idle first-person right-hand model matrix in camera space.
 *
 * Vanilla 1.9 path with swing = 0 and equip = 0:
 *   `T_hand * T_display * Rx * Ry * Rz * S * [T_center]`
 *
 * `transformFirstPerson` at swing 0 is `Ry(+45°) * Ry(-45°) = I`, so it is
 * omitted. Do not apply this matrix in production until projected reference
 * points are compared against a same-FOV Minecraft screenshot.
 */
export function composeVanillaIdleFirstPersonRightHand(
  options: VanillaIdleFirstPersonOptions = {},
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  const display = minecraftItemTransformToMatrix4(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND);
  target
    .makeTranslation(
      VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET.x,
      VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET.y,
      VANILLA_FIRSTPERSON_RIGHT_HAND_OFFSET.z,
    )
    .multiply(display);
  if (options.includeBakedModelCentering) {
    target.multiply(new THREE.Matrix4().makeTranslation(
      VANILLA_BAKED_MODEL_CENTERING[0],
      VANILLA_BAKED_MODEL_CENTERING[1],
      VANILLA_BAKED_MODEL_CENTERING[2],
    ));
  }
  return target;
}

/**
 * Rebuild the *current* production idle sprite matrix (`T * Rxyz * S`) the
 * same way `applyItemViewTransform` writes Three.js TRS. Not a vanilla path.
 */
export function composeCurrentProductionIdleSpriteMatrix(target = new THREE.Matrix4()): THREE.Matrix4 {
  const pose = FIRST_PERSON_SPRITE_POSE;
  const position = new THREE.Vector3(pose.position[0], pose.position[1], pose.position[2]);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    degToRad(pose.rotationDeg[0]),
    degToRad(pose.rotationDeg[1]),
    degToRad(pose.rotationDeg[2]),
    'XYZ',
  ));
  const scale = new THREE.Vector3(pose.scale, pose.scale, pose.scale);
  return target.compose(position, quaternion, scale);
}

export interface ProjectedReferencePoint {
  readonly name: GeneratedHeldReferencePoint['name'];
  readonly local: RenderVector;
  readonly camera: RenderVector;
  readonly ndc: RenderVector;
  readonly screen01: readonly [number, number];
}

export function projectLocalPoint(
  local: RenderVector,
  modelView: THREE.Matrix4,
  camera: THREE.Camera,
): Omit<ProjectedReferencePoint, 'name' | 'local'> {
  const world = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(modelView);
  const ndc = world.clone().project(camera);
  return {
    camera: [world.x, world.y, world.z],
    ndc: [ndc.x, ndc.y, ndc.z],
    screen01: [(ndc.x + 1) / 2, (1 - ndc.y) / 2],
  };
}

export function projectGeneratedReferencePoints(
  modelView: THREE.Matrix4,
  camera: THREE.Camera,
): ProjectedReferencePoint[] {
  return GENERATED_HELD_REFERENCE_POINTS.map((point) => ({
    name: point.name,
    local: point.local,
    ...projectLocalPoint(point.local, modelView, camera),
  }));
}

export function formatMatrix4(matrix: THREE.Matrix4, digits = 5): string {
  const e = matrix.elements;
  const cell = (index: number): string => {
    const value = e[index]!;
    const text = value.toFixed(digits);
    return (value < 0 ? text : ` ${text}`).padStart(digits + 3);
  };
  return [
    `[${cell(0)} ${cell(4)} ${cell(8)} ${cell(12)}]`,
    `[${cell(1)} ${cell(5)} ${cell(9)} ${cell(13)}]`,
    `[${cell(2)} ${cell(6)} ${cell(10)} ${cell(14)}]`,
    `[${cell(3)} ${cell(7)} ${cell(11)} ${cell(15)}]`,
  ].join('\n');
}

function formatVec3(values: RenderVector, digits = 4): string {
  return values.map((value) => value.toFixed(digits)).join(', ');
}

function formatPoint(point: ProjectedReferencePoint): string {
  const [sx, sy] = point.screen01;
  return `${point.name.padEnd(11)} local(${formatVec3(point.local, 3)})  cam(${formatVec3(point.camera)})  ndc(${formatVec3(point.ndc)})  screen01(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

export interface HeldItemMatrixDebugSnapshot {
  readonly itemId?: string;
  readonly freezeIdleMotion: boolean;
  readonly camera: {
    readonly type: string;
    readonly fov: number;
    readonly aspect: number;
    readonly near: number;
    readonly far: number;
  };
  readonly itemLocal: THREE.Matrix4;
  readonly itemWorld: THREE.Matrix4;
  readonly modelView: THREE.Matrix4;
  readonly productionPoints: readonly ProjectedReferencePoint[];
  readonly vanillaModelView: THREE.Matrix4;
  readonly vanillaPoints: readonly ProjectedReferencePoint[];
}

export function formatHeldItemMatrixOverlay(snapshot: HeldItemMatrixDebugSnapshot): string {
  const { camera } = snapshot;
  const fovNote = camera.type === 'PerspectiveCamera'
    ? `fovV ${camera.fov.toFixed(2)}°  (vanilla hand ${VANILLA_HAND_FOV_DEGREES}°  world settings are a different pass)`
    : camera.type;
  return [
    `matrix QA · ${snapshot.itemId ?? 'item'}  freezeIdle=${snapshot.freezeIdleMotion ? '1' : '0'}`,
    `camera ${camera.type}  ${fovNote}`,
    `aspect ${camera.aspect.toFixed(5)}  (${camera.aspect.toFixed(3)}  ref 2048×1152 = ${(2048 / 1152).toFixed(5)})`,
    `near ${camera.near}  far ${camera.far}  (vanilla hand near ${VANILLA_HAND_NEAR}; near/far do not change on-screen size)`,
    '',
    'APPLIED production (temporary calibration, not vanilla):',
    'item local =',
    formatMatrix4(snapshot.itemLocal),
    'item world =',
    formatMatrix4(snapshot.itemWorld),
    'modelView =',
    formatMatrix4(snapshot.modelView),
    ...snapshot.productionPoints.map(formatPoint),
    '',
    'PROPOSED vanilla idle RH (NOT applied to the mesh):',
    'T_hand(0.56,-0.52,-0.72) * T_disp(1.13,3.2,1.13)/16 * Ry(-90°) * Rz(25°) * S(0.68)',
    'centering T(-0.5) omitted — geometry is already centered',
    formatMatrix4(snapshot.vanillaModelView),
    ...snapshot.vanillaPoints.map(formatPoint),
    '',
    'screen01 = [(ndcX+1)/2, (1-ndcY)/2]  origin top-left, like a screenshot',
  ].join('\n');
}
