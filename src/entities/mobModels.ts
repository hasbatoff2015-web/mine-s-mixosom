import * as THREE from 'three';
import type { MobKind } from './mobDefinitions';
import {
  buildLegacyModel,
  type LegacyModelBox,
  type LegacyModelDefinition,
  type LegacyModelPart,
  type LegacyVector,
} from './LegacyModel';
import { VoxelVisualFactory } from './voxelVisuals';

export interface MobModel {
  readonly root: THREE.Group;
  readonly parts: ReadonlyMap<string, THREE.Group>;
  readonly head?: THREE.Object3D;
  readonly legs: readonly THREE.Object3D[];
  readonly legSwingSigns: readonly number[];
  readonly arms: readonly THREE.Object3D[];
  readonly wings: readonly THREE.Object3D[];
}

export interface MobModelDescriptor {
  readonly kind: MobKind;
  readonly texturePath: string;
  readonly logicalTextureSize: readonly [number, number];
  readonly overlayTexturePaths?: readonly string[];
}

export const MOB_MODEL_DESCRIPTORS: Readonly<Record<MobKind, MobModelDescriptor>> = Object.freeze({
  cow: Object.freeze({ kind: 'cow', texturePath: 'entity/cow', logicalTextureSize: [64, 32] as const }),
  pig: Object.freeze({ kind: 'pig', texturePath: 'entity/pig', logicalTextureSize: [64, 32] as const }),
  chicken: Object.freeze({ kind: 'chicken', texturePath: 'entity/chicken', logicalTextureSize: [64, 32] as const }),
  sheep: Object.freeze({ kind: 'sheep', texturePath: 'entity/sheep', logicalTextureSize: [64, 32] as const, overlayTexturePaths: Object.freeze(['entity/sheep_fur']) }),
  zombie: Object.freeze({ kind: 'zombie', texturePath: 'entity/zombie', logicalTextureSize: [64, 64] as const }),
  skeleton: Object.freeze({ kind: 'skeleton', texturePath: 'entity/skeleton', logicalTextureSize: [64, 32] as const }),
  creeper: Object.freeze({ kind: 'creeper', texturePath: 'entity/creeper', logicalTextureSize: [64, 32] as const }),
  spider: Object.freeze({ kind: 'spider', texturePath: 'entity/spider', logicalTextureSize: [64, 32] as const, overlayTexturePaths: Object.freeze(['entity/spider_eyes']) }),
});

const box = (
  origin: LegacyVector,
  size: LegacyVector,
  textureOffset: readonly [number, number],
  options: Omit<LegacyModelBox, 'origin' | 'size' | 'textureOffset'> = {},
): LegacyModelBox => ({ origin, size, textureOffset, ...options });

const modelPart = (
  name: string,
  rotationPoint: LegacyVector,
  boxes: readonly LegacyModelBox[],
  rotation?: LegacyVector,
): LegacyModelPart => ({ name, rotationPoint, boxes, ...(rotation ? { rotation } : {}) });

const quadrupedLegParts = (
  height: number,
  pivots: readonly LegacyVector[],
  options: { readonly inflate?: number; readonly texturePath?: string } = {},
): readonly LegacyModelPart[] => pivots.map((pivot, index) => modelPart(`leg${index + 1}`, pivot, [
  box([-2, 0, -2], [4, height, 4], [0, 16], { mirror: index % 2 === 1, ...options }),
]));

export const COW_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/cow', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 4, -8], [
      box([-4, -4, -6], [8, 8, 6], [0, 0]),
      box([-5, -5, -4], [1, 3, 1], [22, 0]),
      box([4, -5, -4], [1, 3, 1], [22, 0], { mirror: true }),
    ]),
    modelPart('body', [0, 5, 2], [
      box([-6, -10, -7], [12, 18, 10], [18, 4]),
      box([-2, 2, -8], [4, 6, 1], [52, 0]),
    ], [Math.PI / 2, 0, 0]),
    ...quadrupedLegParts(12, [[-4, 12, 7], [4, 12, 7], [-4, 12, -6], [4, 12, -6]]),
  ],
};

export const PIG_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/pig', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 12, -6], [
      box([-4, -4, -8], [8, 8, 8], [0, 0]),
      box([-2, 0, -9], [4, 3, 1], [16, 16]),
    ]),
    modelPart('body', [0, 11, 2], [box([-5, -10, -7], [10, 16, 8], [28, 8])], [Math.PI / 2, 0, 0]),
    ...quadrupedLegParts(6, [[-3, 18, 7], [3, 18, 7], [-3, 18, -5], [3, 18, -5]]),
  ],
};

export const SHEEP_BASE_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/sheep', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 6, -8], [box([-3, -4, -6], [6, 6, 8], [0, 0])]),
    modelPart('body', [0, 5, 2], [box([-4, -10, -7], [8, 16, 6], [28, 8])], [Math.PI / 2, 0, 0]),
    ...quadrupedLegParts(12, [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]]),
  ],
};

export const SHEEP_WOOL_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/sheep_fur', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 6, -8], [box([-3, -4, -4], [6, 6, 6], [0, 0], { inflate: 0.6 })]),
    modelPart('body', [0, 5, 2], [box([-4, -10, -7], [8, 16, 6], [28, 8], { inflate: 1.75 })], [Math.PI / 2, 0, 0]),
    ...quadrupedLegParts(6, [[-3, 12, 7], [3, 12, 7], [-3, 12, -5], [3, 12, -5]], { inflate: 0.5, texturePath: 'entity/sheep_fur' }),
  ],
};

export const CHICKEN_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/chicken', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 15, -4], [
      box([-2, -6, -2], [4, 6, 3], [0, 0]),
      box([-2, -4, -4], [4, 2, 2], [14, 0]),
      box([-1, -2, -3], [2, 2, 2], [14, 4]),
    ]),
    modelPart('body', [0, 16, 0], [box([-3, -4, -3], [6, 8, 6], [0, 9])], [Math.PI / 2, 0, 0]),
    modelPart('rightLeg', [-2, 19, 1], [box([-1, 0, -3], [3, 5, 3], [26, 0])]),
    modelPart('leftLeg', [1, 19, 1], [box([-1, 0, -3], [3, 5, 3], [26, 0], { mirror: true })]),
    modelPart('rightWing', [-4, 13, 0], [box([0, 0, -3], [1, 4, 6], [24, 13])]),
    modelPart('leftWing', [4, 13, 0], [box([-1, 0, -3], [1, 4, 6], [24, 13], { mirror: true })]),
  ],
};

export const ZOMBIE_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/zombie', logicalTextureSize: [64, 64],
  parts: [
    modelPart('head', [0, 0, 0], [
      box([-4, -8, -4], [8, 8, 8], [0, 0]),
      box([-4, -8, -4], [8, 8, 8], [32, 0], { inflate: 0.5, alphaTest: 0.45 }),
    ]),
    modelPart('body', [0, 0, 0], [box([-4, 0, -2], [8, 12, 4], [16, 16])]),
    modelPart('rightArm', [-5, 2, 0], [box([-3, -2, -2], [4, 12, 4], [40, 16])]),
    modelPart('leftArm', [5, 2, 0], [box([-1, -2, -2], [4, 12, 4], [40, 16], { mirror: true })]),
    modelPart('rightLeg', [-1.9, 12, 0], [box([-2, 0, -2], [4, 12, 4], [0, 16])]),
    modelPart('leftLeg', [1.9, 12, 0], [box([-2, 0, -2], [4, 12, 4], [0, 16], { mirror: true })]),
  ],
};

export const SKELETON_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/skeleton', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 0, 0], [box([-4, -8, -4], [8, 8, 8], [0, 0])]),
    modelPart('body', [0, 0, 0], [box([-4, 0, -2], [8, 12, 4], [16, 16], { doubleSided: true })]),
    modelPart('rightArm', [-5, 2, 0], [box([-1, -2, -1], [2, 12, 2], [40, 16])]),
    modelPart('leftArm', [5, 2, 0], [box([-1, -2, -1], [2, 12, 2], [40, 16], { mirror: true })]),
    modelPart('rightLeg', [-2, 12, 0], [box([-1, 0, -1], [2, 12, 2], [0, 16])]),
    modelPart('leftLeg', [2, 12, 0], [box([-1, 0, -1], [2, 12, 2], [0, 16], { mirror: true })]),
  ],
};

export const CREEPER_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/creeper', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 6, 0], [box([-4, -8, -4], [8, 8, 8], [0, 0])]),
    modelPart('body', [0, 6, 0], [box([-4, 0, -2], [8, 12, 4], [16, 16])]),
    ...quadrupedLegParts(6, [[-2, 18, 4], [2, 18, 4], [-2, 18, -4], [2, 18, -4]]),
  ],
};

const SPIDER_LEG_PIVOTS: readonly LegacyVector[] = [
  [-4, 15, 2], [4, 15, 2], [-4, 15, 1], [4, 15, 1],
  [-4, 15, 0], [4, 15, 0], [-4, 15, -1], [4, 15, -1],
];
const SPIDER_LEG_ROTATIONS: readonly LegacyVector[] = [
  [0, Math.PI / 4, -Math.PI / 4], [0, -Math.PI / 4, Math.PI / 4],
  [0, Math.PI / 8, -Math.PI / 4 * 0.74], [0, -Math.PI / 8, Math.PI / 4 * 0.74],
  [0, -Math.PI / 8, -Math.PI / 4 * 0.74], [0, Math.PI / 8, Math.PI / 4 * 0.74],
  [0, -Math.PI / 4, -Math.PI / 4], [0, Math.PI / 4, Math.PI / 4],
];

export const SPIDER_MODEL: LegacyModelDefinition = {
  texturePath: 'entity/spider', logicalTextureSize: [64, 32],
  parts: [
    modelPart('head', [0, 15, -3], [
      box([-4, -4, -8], [8, 8, 8], [32, 4]),
      box([-4, -4, -8], [8, 8, 8], [32, 4], { texturePath: 'entity/spider_eyes', inflate: 0.1, glow: true }),
    ]),
    modelPart('neck', [0, 15, 0], [box([-3, -3, -3], [6, 6, 6], [0, 0])]),
    modelPart('body', [0, 15, 9], [box([-5, -4, -6], [10, 8, 12], [0, 12])]),
    ...SPIDER_LEG_PIVOTS.map((pivot, index) => modelPart(
      `leg${index + 1}`,
      pivot,
      [box(index % 2 === 0 ? [-15, -1, -1] : [-1, -1, -1], [16, 2, 2], [18, 0], { mirror: index % 2 === 1 })],
      SPIDER_LEG_ROTATIONS[index],
    )),
  ],
};

export const MOB_LEGACY_MODELS: Readonly<Record<MobKind, readonly LegacyModelDefinition[]>> = {
  cow: [COW_MODEL], pig: [PIG_MODEL], sheep: [SHEEP_BASE_MODEL, SHEEP_WOOL_MODEL],
  chicken: [CHICKEN_MODEL], zombie: [ZOMBIE_MODEL], skeleton: [SKELETON_MODEL],
  creeper: [CREEPER_MODEL], spider: [SPIDER_MODEL],
};

const PART_NAMES: Readonly<Record<MobKind, {
  readonly head?: string;
  readonly legs: readonly string[];
  readonly legSwingSigns: readonly number[];
  readonly arms?: readonly string[];
  readonly wings?: readonly string[];
}>> = {
  cow: { head: 'head', legs: ['leg1', 'leg2', 'leg3', 'leg4'], legSwingSigns: [1, -1, -1, 1] },
  pig: { head: 'head', legs: ['leg1', 'leg2', 'leg3', 'leg4'], legSwingSigns: [1, -1, -1, 1] },
  sheep: { head: 'head', legs: ['leg1', 'leg2', 'leg3', 'leg4'], legSwingSigns: [1, -1, -1, 1] },
  chicken: { head: 'head', legs: ['rightLeg', 'leftLeg'], legSwingSigns: [1, -1], wings: ['rightWing', 'leftWing'] },
  zombie: { head: 'head', legs: ['rightLeg', 'leftLeg'], legSwingSigns: [1, -1], arms: ['rightArm', 'leftArm'] },
  skeleton: { head: 'head', legs: ['rightLeg', 'leftLeg'], legSwingSigns: [1, -1], arms: ['rightArm', 'leftArm'] },
  creeper: { head: 'head', legs: ['leg1', 'leg2', 'leg3', 'leg4'], legSwingSigns: [1, -1, -1, 1] },
  spider: { head: 'head', legs: ['leg1', 'leg2', 'leg3', 'leg4', 'leg5', 'leg6', 'leg7', 'leg8'], legSwingSigns: [] },
};

export function createMobModel(visuals: VoxelVisualFactory, kind: MobKind): MobModel {
  const built = buildLegacyModel(visuals, `mob:${kind}`, MOB_LEGACY_MODELS[kind]);
  const names = PART_NAMES[kind];
  return {
    root: built.root,
    parts: built.parts,
    ...(names.head ? { head: built.parts.get(names.head) } : {}),
    legs: names.legs.map((name) => built.parts.get(name)!),
    legSwingSigns: names.legSwingSigns,
    arms: (names.arms ?? []).map((name) => built.parts.get(name)!),
    wings: (names.wings ?? []).map((name) => built.parts.get(name)!),
  };
}
