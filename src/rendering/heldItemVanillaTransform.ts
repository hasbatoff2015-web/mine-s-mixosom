import * as THREE from 'three';
import { FIRST_PERSON_SPRITE_POSE, type RenderVector } from '../items';
import { VANILLA_GENERATED_DEPTH } from './GeneratedItemGeometry';
import {
  projectLocalPoint,
  type LandmarkComparisonRow,
  type ProjectedLandmark,
} from './heldItemLandmarks';

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

/** Vertical FOV of the vanilla *hand* pass (`getFOVModifier(..., false)` in 1.9, `getFov(..., false)` in 1.21.8). */
export const VANILLA_HAND_FOV_DEGREES = 70;

/** Vanilla hand-pass near plane (`gluPerspective` in 1.9; `GameRenderer.CAMERA_DEPTH` = 0.05 in 1.21.8). */
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

/**
 * JOML `Quaternionf.rotationXYZ` used by Minecraft 1.21 `ItemTransform.apply`.
 * Formula copied from JOML 1.10. The sequential PoseStack path is still
 * translate → rotate → scale with right-multiply, matching 1.9 GL.
 */
export function jomlRotationXYZQuaternion(
  rotationDeg: RenderVector,
  target = new THREE.Quaternion(),
): THREE.Quaternion {
  const hx = degToRad(rotationDeg[0]) * 0.5;
  const hy = degToRad(rotationDeg[1]) * 0.5;
  const hz = degToRad(rotationDeg[2]) * 0.5;
  const sx = Math.sin(hx);
  const cx = Math.cos(hx);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sz = Math.sin(hz);
  const cz = Math.cos(hz);
  const cycz = cy * cz;
  const sysz = sy * sz;
  const sycz = sy * cz;
  const cysz = cy * sz;
  return target.set(
    sx * cycz + cx * sysz,
    cx * sycz - sx * cysz,
    cx * cysz + sx * sycz,
    cx * cycz - sx * sysz,
  );
}

export function minecraftItemTransformToMatrix4JomlXyz(
  transform: MinecraftItemDisplayTransform,
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  const translation = new THREE.Vector3(
    transform.translationPx[0] * VANILLA_ITEM_TRANSLATION_PIXEL,
    transform.translationPx[1] * VANILLA_ITEM_TRANSLATION_PIXEL,
    transform.translationPx[2] * VANILLA_ITEM_TRANSLATION_PIXEL,
  );
  const quaternion = jomlRotationXYZQuaternion(transform.rotationDeg);
  const scale = new THREE.Vector3(transform.scale[0], transform.scale[1], transform.scale[2]);
  return target.compose(translation, quaternion, scale);
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
 * Java 1.21.8 uses the same JSON, the same `EQUIP_OFFSET_TRANSLATE_{X,Y,Z}`
 * (0.56, -0.52, -0.72), and `ItemTransform.apply` via JOML `rotationXYZ`,
 * which matches 1.9 `Rx*Ry*Rz` for `[0,-90,25]`. `transformFirstPerson` /
 * `applySwingOffset` at swing 0 is `Ry(+45°) * Ry(-45°) = I`.
 *
 * Diagnostic only — do not write this onto the production item root.
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

/** Java 1.9 idle right-hand path. Alias of the shared GL T*Rx*Ry*Rz*S compose. */
export const composeVanilla19IdleFirstPersonRightHand = composeVanillaIdleFirstPersonRightHand;

/**
 * Java 1.21.8 idle right-hand path: same JSON, same hand offset, same
 * centering omit, ItemTransform via JOML rotationXYZ. Proven identical to 1.9
 * for this triple in tests.
 */
export function composeVanilla1218IdleFirstPersonRightHand(
  options: VanillaIdleFirstPersonOptions = {},
  target = new THREE.Matrix4(),
): THREE.Matrix4 {
  const display = minecraftItemTransformToMatrix4JomlXyz(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND);
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

export interface AxisTriple {
  readonly x: RenderVector;
  readonly y: RenderVector;
  readonly z: RenderVector;
}

export const IDENTITY_BASIS: AxisTriple = Object.freeze({
  x: [1, 0, 0] as RenderVector,
  y: [0, 1, 0] as RenderVector,
  z: [0, 0, 1] as RenderVector,
});

export type VanillaIdleStageName =
  | 'localGenerated'
  | 'afterBakeCentered'
  | 'afterDisplay'
  | 'afterHand'
  | 'cameraSpace';

export interface VanillaIdleStage {
  readonly name: VanillaIdleStageName;
  readonly matrix: THREE.Matrix4;
  readonly basis: AxisTriple;
  readonly origin: RenderVector;
}

/**
 * Local +X/+Y/+Z through the idle right-hand chain. Camera is identity
 * (viewmodel at origin, look −Z), so `afterHand` == camera space.
 */
export function vanillaIdleRightHandStages(
  options: VanillaIdleFirstPersonOptions = {},
): VanillaIdleStage[] {
  const identity = new THREE.Matrix4().identity();
  const display = minecraftItemTransformToMatrix4(VANILLA_GENERATED_FIRSTPERSON_RIGHTHAND);
  const hand = composeVanillaIdleFirstPersonRightHand(options);
  const originOf = (matrix: THREE.Matrix4): RenderVector => {
    const point = new THREE.Vector3().applyMatrix4(matrix);
    return [point.x, point.y, point.z];
  };
  return [
    { name: 'localGenerated', matrix: identity, basis: IDENTITY_BASIS, origin: [0, 0, 0] },
    { name: 'afterBakeCentered', matrix: identity.clone(), basis: IDENTITY_BASIS, origin: [0, 0, 0] },
    { name: 'afterDisplay', matrix: display, basis: transformUnitAxes(display), origin: originOf(display) },
    { name: 'afterHand', matrix: hand, basis: transformUnitAxes(hand), origin: originOf(hand) },
    { name: 'cameraSpace', matrix: hand.clone(), basis: transformUnitAxes(hand), origin: originOf(hand) },
  ];
}

export function transformUnitAxes(matrix: THREE.Matrix4): AxisTriple {
  const axis = (local: THREE.Vector3): RenderVector => {
    const world = local.transformDirection(matrix).normalize();
    return [world.x, world.y, world.z];
  };
  return {
    x: axis(new THREE.Vector3(1, 0, 0)),
    y: axis(new THREE.Vector3(0, 1, 0)),
    z: axis(new THREE.Vector3(0, 0, 1)),
  };
}

export interface FrontFacingMetrics {
  readonly originCamera: RenderVector;
  readonly frontCamera: RenderVector;
  /** front · cameraLook(-Z). ~1 = face-on to look axis; ~0 = perpendicular to look axis. */
  readonly frontDotLook: number;
  /**
   * front · normalize(-origin). >0 means the generated front is visible from the
   * camera even if it is perpendicular to the look axis (item sits to the right).
   */
  readonly frontDotToCamera: number;
  readonly grazingDegrees: number;
}

export function frontFacingMetrics(matrix: THREE.Matrix4): FrontFacingMetrics {
  const origin = new THREE.Vector3().applyMatrix4(matrix);
  const front = new THREE.Vector3(0, 0, 1).transformDirection(matrix).normalize();
  const toCamera = origin.clone().negate();
  if (toCamera.lengthSq() < 1e-10) toCamera.set(0, 0, 1);
  else toCamera.normalize();
  const frontDotToCamera = front.dot(toCamera);
  return {
    originCamera: [origin.x, origin.y, origin.z],
    frontCamera: [front.x, front.y, front.z],
    frontDotLook: front.dot(new THREE.Vector3(0, 0, -1)),
    frontDotToCamera,
    grazingDegrees: Math.acos(THREE.MathUtils.clamp(frontDotToCamera, -1, 1)) * 180 / Math.PI,
  };
}

export { projectLocalPoint } from './heldItemLandmarks';

export interface ProjectedReferencePoint {
  readonly name: GeneratedHeldReferencePoint['name'];
  readonly local: RenderVector;
  readonly camera: RenderVector;
  readonly ndc: RenderVector;
  readonly screen01: readonly [number, number];
}

export function projectGeneratedReferencePoints(
  modelView: THREE.Matrix4,
  camera: THREE.Camera,
): ProjectedReferencePoint[] {
  return GENERATED_HELD_REFERENCE_POINTS.map((point) => ({
    name: point.name,
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

function formatAxis(triple: AxisTriple): string {
  return `X(${formatVec3(triple.x)})  Y(${formatVec3(triple.y)})  Z/front(${formatVec3(triple.z)})`;
}

function formatFacing(label: string, facing: FrontFacingMetrics): string {
  return [
    `${label} origin cam(${formatVec3(facing.originCamera)})  front(${formatVec3(facing.frontCamera)})`,
    `  front·look(-Z)=${facing.frontDotLook.toFixed(3)}  front·toCamera=${facing.frontDotToCamera.toFixed(3)}  grazing=${facing.grazingDegrees.toFixed(1)}°`,
  ].join('\n');
}

function formatStage(stage: VanillaIdleStage): string {
  return `${stage.name.padEnd(18)} origin(${formatVec3(stage.origin)})  ${formatAxis(stage.basis)}`;
}

function formatLandmarkRow(row: LandmarkComparisonRow): string {
  const fmt = (pair: readonly [number, number]): string => `${pair[0].toFixed(4)},${pair[1].toFixed(4)}`;
  return `${row.name.padEnd(18)} texel ${row.texel[0]},${row.texel[1]}  F2 ${fmt(row.screenshot01)}  prod ${fmt(row.production01)} Δ${fmt(row.productionDelta)}  van ${fmt(row.vanilla01)} Δ${fmt(row.vanillaDelta)}`;
}

function formatSilhouettePoint(point: ProjectedLandmark): string {
  const [sx, sy] = point.screen01;
  return `${point.name.padEnd(18)} texel ${point.texel[0]},${point.texel[1]}  local(${formatVec3(point.local, 3)})  cam(${formatVec3(point.camera)})  screen01(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
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
  readonly productionBasis: AxisTriple;
  readonly productionFacing: FrontFacingMetrics;
  readonly vanillaModelView: THREE.Matrix4;
  readonly vanilla1218ModelView: THREE.Matrix4;
  readonly vanillaPoints: readonly ProjectedReferencePoint[];
  readonly vanillaBasis: AxisTriple;
  readonly vanillaFacing: FrontFacingMetrics;
  readonly silhouetteProduction?: readonly ProjectedLandmark[];
  readonly silhouetteVanilla?: readonly ProjectedLandmark[];
  readonly screenshotComparison?: readonly LandmarkComparisonRow[];
}

export function formatHeldItemMatrixOverlay(snapshot: HeldItemMatrixDebugSnapshot): string {
  const { camera } = snapshot;
  const fovNote = camera.type === 'PerspectiveCamera'
    ? `fovV ${camera.fov.toFixed(2)}°  (hand/viewmodel ${VANILLA_HAND_FOV_DEGREES}°; world settings FOV is a different pass)`
    : camera.type;
  const vanillaSame = matricesClose(snapshot.vanillaModelView, snapshot.vanilla1218ModelView);
  const lines = [
    `matrix QA · ${snapshot.itemId ?? 'item'}  freezeIdle=${snapshot.freezeIdleMotion ? '1' : '0'}`,
    `camera ${camera.type}  ${fovNote}`,
    `aspect ${camera.aspect.toFixed(5)}  (F2 2048×1152 = ${(2048 / 1152).toFixed(5)})`,
    `near ${camera.near}  far ${camera.far}`,
    `ref F2 Java 1.21.8  2048×1152  fovSetting 70  idle iron_pickaxe`,
    '',
    'APPLIED production (temporary face-on calibration, not vanilla):',
    formatMatrix4(snapshot.modelView),
    formatAxis(snapshot.productionBasis),
    formatFacing('production', snapshot.productionFacing),
    ...snapshot.productionPoints.map(formatPoint),
    '',
    `PROPOSED vanilla idle RH  1.9 GL == 1.21.8 JOML XYZ: ${vanillaSame ? 'YES' : 'NO'}  (NOT applied)`,
    'T_hand(0.56,-0.52,-0.72) * T_disp(1.13,3.2,1.13)/16 * R[0,-90,25] * S(0.68)',
    formatMatrix4(snapshot.vanillaModelView),
    formatAxis(snapshot.vanillaBasis),
    formatFacing('vanilla', snapshot.vanillaFacing),
    'front·look~0 is perpendicular to look axis, NOT hidden: item is to the right, front·toCamera>0 shows the face',
    ...snapshot.vanillaPoints.map(formatPoint),
    '',
    'VANILLA axis stages (local X/Y/Z, camera I so afterHand == camera):',
    ...vanillaIdleRightHandStages().map(formatStage),
    'THREE production camera basis (idle freeze, camera I):',
    `production         origin(${formatVec3(snapshot.productionFacing.originCamera)})  ${formatAxis(snapshot.productionBasis)}`,
  ];
  if (snapshot.silhouetteVanilla && snapshot.silhouetteVanilla.length > 0) {
    lines.push('', 'SILHOUETTE landmarks (opaque alpha, front Z):');
    for (const point of snapshot.silhouetteVanilla) lines.push(`van  ${formatSilhouettePoint(point)}`);
    if (snapshot.silhouetteProduction) {
      for (const point of snapshot.silhouetteProduction) lines.push(`prod ${formatSilhouettePoint(point)}`);
    }
  }
  if (snapshot.screenshotComparison && snapshot.screenshotComparison.length > 0) {
    lines.push('', 'F2 2048×1152 comparison  screen01  (visual-read pixels ±12; comparison camera is F2 16:9 FOV70, not live canvas aspect):');
    lines.push('name               texel     F2              prod            Δprod           van             Δvan');
    for (const row of snapshot.screenshotComparison) lines.push(formatLandmarkRow(row));
  }
  lines.push('', 'screen01 = [(ndcX+1)/2, (1-ndcY)/2]  origin top-left');
  return lines.join('\n');
}

function matricesClose(a: THREE.Matrix4, b: THREE.Matrix4, epsilon = 1e-5): boolean {
  for (let i = 0; i < 16; i += 1) {
    if (Math.abs(a.elements[i]! - b.elements[i]!) > epsilon) return false;
  }
  return true;
}
