/**
 * Bedrock bee geometry adapted to LegacyModel.
 *
 * Source numbers are the public `geometry.bee` bones (texture 64×64). They are
 * not copied as a Mojang JSON file. Bedrock is Y-up and states pivots in
 * absolute model pixels. This rig is Y-down, 16 pixels = 1 block, and a child
 * pivot is the parent's pivot subtracted, then Y-flipped.
 *
 * Entity root is bedrock model Y=0. The body cube center is therefore at
 * local Y = 5.5/16 before `PET_BEE_MODEL_SCALE`.
 */

const DEG = Math.PI / 180;
/** Visual thickness for a bedrock zero-size axis. UV still uses the source size. */
const PLANE = 0.12;

export const BEE_BODY_PIVOT: readonly [number, number, number] = [0.5, 5, 0];

export interface BeeBedrockCube {
  readonly origin: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly uv: readonly [number, number];
}

export interface BeeBedrockBone {
  readonly name: string;
  readonly parent?: 'body';
  readonly pivot: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly cubes: readonly BeeBedrockCube[];
}

/** Official bedrock layout, pixels, Y-up. */
export const BEE_BEDROCK_BONES: readonly BeeBedrockBone[] = [
  {
    name: 'body',
    pivot: BEE_BODY_PIVOT,
    cubes: [
      { origin: [-3, 2, -5], size: [7, 7, 10], uv: [0, 0] },
      { origin: [2, 7, -8], size: [1, 2, 3], uv: [2, 0] },
      { origin: [-2, 7, -8], size: [1, 2, 3], uv: [2, 3] },
    ],
  },
  {
    name: 'stinger',
    parent: 'body',
    pivot: [0.5, 6, 1],
    cubes: [{ origin: [0.5, 5, 5], size: [0, 1, 2], uv: [26, 7] }],
  },
  {
    name: 'rightwing_bone',
    parent: 'body',
    pivot: [-1, 9, -3],
    rotation: [15, -15, 0],
    cubes: [{ origin: [-10, 9, -3], size: [9, 0, 6], uv: [0, 18] }],
  },
  {
    name: 'leftwing_bone',
    parent: 'body',
    pivot: [2, 9, -3],
    rotation: [15, 15, 0],
    cubes: [{ origin: [2, 9, -3], size: [9, 0, 6], uv: [9, 24] }],
  },
  {
    name: 'leg_front',
    parent: 'body',
    pivot: [2, 2, -2],
    cubes: [{ origin: [-3, 0, -2], size: [7, 2, 0], uv: [26, 1] }],
  },
  {
    name: 'leg_mid',
    parent: 'body',
    pivot: [2, 2, 0],
    cubes: [{ origin: [-3, 0, 0], size: [7, 2, 0], uv: [26, 3] }],
  },
  {
    name: 'leg_back',
    parent: 'body',
    pivot: [2, 2, 2],
    cubes: [{ origin: [-3, 0, 2], size: [7, 2, 0], uv: [26, 5] }],
  },
];

/** Cube corner relative to its bone, legacy Y-down. */
export function beeLegacyBoxOrigin(
  origin: readonly [number, number, number],
  size: readonly [number, number, number],
  pivot: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    origin[0] - pivot[0],
    -(origin[1] - pivot[1]) - size[1],
    origin[2] - pivot[2],
  ];
}

/** Child pivot relative to its parent, legacy Y-down. */
export function beeLegacyChildPivot(
  child: readonly [number, number, number],
  parent: readonly [number, number, number],
): readonly [number, number, number] {
  return [child[0] - parent[0], -(child[1] - parent[1]), child[2] - parent[2]];
}

/**
 * Bedrock wing bind pose, as legacy radians.
 * Yaw is kept. Pitch is stored with the opposite legacy sign from a direct
 * axis copy: Three.js +X drops the trailing edge of a wing pivoted on its
 * leading edge, which left the membranes beside the body. The negated pitch
 * lifts that deck above the thorax. The flap itself is added later on Z.
 */
export function beeLegacyRotation(
  degrees: readonly [number, number, number],
): readonly [number, number, number] {
  return [degrees[0] * DEG, degrees[1] * DEG, -degrees[2] * DEG];
}

function physicalSize(size: readonly [number, number, number]): readonly [number, number, number] {
  return [
    size[0] === 0 ? PLANE : size[0],
    size[1] === 0 ? PLANE : size[1],
    size[2] === 0 ? PLANE : size[2],
  ];
}

function needsPlane(size: readonly [number, number, number]): boolean {
  return size[0] === 0 || size[1] === 0 || size[2] === 0;
}

const bodyPivotLegacy: readonly [number, number, number] = [BEE_BODY_PIVOT[0], 24 - BEE_BODY_PIVOT[1], BEE_BODY_PIVOT[2]];

function bonePart(bone: BeeBedrockBone) {
  const pivot = bone.parent ? beeLegacyChildPivot(bone.pivot, BEE_BODY_PIVOT) : bodyPivotLegacy;
  const boxes = bone.cubes.map((cube) => {
    const plane = needsPlane(cube.size);
    return {
      origin: beeLegacyBoxOrigin(cube.origin, cube.size, bone.pivot),
      size: cube.size,
      textureOffset: cube.uv,
      ...(plane ? {
        doubleSided: true,
        alphaTest: cube.size[1] === 0 ? 0.15 : 0.1,
        physicalSize: physicalSize(cube.size),
      } : {}),
    };
  });
  return {
    name: bone.name,
    ...(bone.parent ? { parent: bone.parent } : {}),
    rotationPoint: pivot,
    ...(bone.rotation ? { rotation: beeLegacyRotation(bone.rotation) } : {}),
    boxes,
  };
}

export const BEE_MODEL = {
  texturePath: 'entity/bee',
  logicalTextureSize: [64, 64] as const,
  parts: BEE_BEDROCK_BONES.map(bonePart),
};
