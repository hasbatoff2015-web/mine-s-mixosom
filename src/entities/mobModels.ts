import * as THREE from 'three';
import type { TexturedCuboidDefinition } from '../rendering/TexturedCuboid';
import type { MobKind } from './mobDefinitions';
import { VoxelVisualFactory } from './voxelVisuals';

export interface MobModel {
  readonly root: THREE.Group;
  readonly head?: THREE.Object3D;
  readonly legs: readonly THREE.Object3D[];
  readonly arms: readonly THREE.Object3D[];
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
  sheep: Object.freeze({
    kind: 'sheep', texturePath: 'entity/sheep', logicalTextureSize: [64, 32] as const,
    overlayTexturePaths: Object.freeze(['entity/sheep_fur']),
  }),
  zombie: Object.freeze({ kind: 'zombie', texturePath: 'entity/zombie', logicalTextureSize: [64, 64] as const }),
  skeleton: Object.freeze({ kind: 'skeleton', texturePath: 'entity/skeleton', logicalTextureSize: [64, 32] as const }),
  creeper: Object.freeze({ kind: 'creeper', texturePath: 'entity/creeper', logicalTextureSize: [64, 32] as const }),
  spider: Object.freeze({
    kind: 'spider', texturePath: 'entity/spider', logicalTextureSize: [64, 32] as const,
    overlayTexturePaths: Object.freeze(['entity/spider_eyes']),
  }),
});

const p = (pixels: number): number => pixels / 16;

function cuboid(
  size: readonly [number, number, number],
  textureOffset: readonly [number, number],
  logicalTextureSize: readonly [number, number],
  options: Pick<TexturedCuboidDefinition, 'mirror' | 'inflate'> = {},
): TexturedCuboidDefinition {
  return { size, textureOffset, logicalTextureSize, ...options };
}

function part(
  visuals: VoxelVisualFactory,
  parent: THREE.Object3D,
  name: string,
  texture: string,
  definition: TexturedCuboidDefinition,
  pivot: readonly [number, number, number],
  offset: readonly [number, number, number] = [0, 0, 0],
): THREE.Group {
  const group = visuals.addPivotCuboid(parent, definition, pivot, offset, texture);
  group.name = name;
  return group;
}

function createCow(visuals: VoxelVisualFactory): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS.cow;
  const root = new THREE.Group();
  root.name = 'mob:cow';
  const body = part(visuals, root, 'cow:body', descriptor.texturePath,
    cuboid([12, 18, 10], [18, 4], descriptor.logicalTextureSize), [0, 0.98, 0.08]);
  body.rotation.x = Math.PI / 2;
  const head = part(visuals, root, 'cow:head', descriptor.texturePath,
    cuboid([8, 8, 6], [0, 0], descriptor.logicalTextureSize), [0, 1.17, -0.64]);
  visuals.addTexturedCuboid(head, cuboid([1, 3, 1], [22, 0], descriptor.logicalTextureSize), [-0.25, 0.33, -0.12], descriptor.texturePath);
  visuals.addTexturedCuboid(head, cuboid([1, 3, 1], [22, 0], descriptor.logicalTextureSize, { mirror: true }), [0.25, 0.33, -0.12], descriptor.texturePath);
  const legs = [
    [-0.27, 0.75, -0.35], [0.27, 0.75, -0.35],
    [-0.27, 0.75, 0.36], [0.27, 0.75, 0.36],
  ].map((pivot, index) => part(
    visuals, root, `cow:leg:${index}`, descriptor.texturePath,
    cuboid([4, 12, 4], [0, 16], descriptor.logicalTextureSize, { mirror: index % 2 === 1 }),
    pivot as [number, number, number], [0, -p(6), 0],
  ));
  return { root, head, legs, arms: [] };
}

function createPig(visuals: VoxelVisualFactory): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS.pig;
  const root = new THREE.Group();
  root.name = 'mob:pig';
  const body = part(visuals, root, 'pig:body', descriptor.texturePath,
    cuboid([10, 16, 8], [28, 8], descriptor.logicalTextureSize), [0, 0.73, 0.08]);
  body.rotation.x = Math.PI / 2;
  const head = part(visuals, root, 'pig:head', descriptor.texturePath,
    cuboid([8, 8, 8], [0, 0], descriptor.logicalTextureSize), [0, 0.93, -0.5]);
  visuals.addTexturedCuboid(head, cuboid([4, 3, 1], [16, 16], descriptor.logicalTextureSize), [0, -0.03, -0.28], descriptor.texturePath);
  const legs = [
    [-0.23, 0.46, -0.3], [0.23, 0.46, -0.3],
    [-0.23, 0.46, 0.31], [0.23, 0.46, 0.31],
  ].map((pivot, index) => part(
    visuals, root, `pig:leg:${index}`, descriptor.texturePath,
    cuboid([4, 6, 4], [0, 16], descriptor.logicalTextureSize, { mirror: index % 2 === 1 }),
    pivot as [number, number, number], [0, -p(3), 0],
  ));
  return { root, head, legs, arms: [] };
}

function createChicken(visuals: VoxelVisualFactory): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS.chicken;
  const root = new THREE.Group();
  root.name = 'mob:chicken';
  const body = part(visuals, root, 'chicken:body', descriptor.texturePath,
    cuboid([6, 8, 6], [0, 9], descriptor.logicalTextureSize), [0, 0.45, 0.02]);
  body.rotation.x = Math.PI / 2;
  const head = part(visuals, root, 'chicken:head', descriptor.texturePath,
    cuboid([4, 6, 3], [0, 0], descriptor.logicalTextureSize), [0, 0.76, -0.27]);
  visuals.addTexturedCuboid(head, cuboid([4, 2, 2], [14, 0], descriptor.logicalTextureSize), [0, 0, -0.15], descriptor.texturePath);
  visuals.addTexturedCuboid(head, cuboid([2, 2, 2], [14, 4], descriptor.logicalTextureSize), [0, -0.13, -0.13], descriptor.texturePath);
  part(visuals, root, 'chicken:left-wing', descriptor.texturePath,
    cuboid([1, 4, 6], [24, 13], descriptor.logicalTextureSize), [-0.22, 0.49, 0]);
  part(visuals, root, 'chicken:right-wing', descriptor.texturePath,
    cuboid([1, 4, 6], [24, 13], descriptor.logicalTextureSize, { mirror: true }), [0.22, 0.49, 0]);
  const legs = [-0.12, 0.12].map((x, index) => part(
    visuals, root, `chicken:leg:${index}`, descriptor.texturePath,
    cuboid([3, 5, 3], [26, 0], descriptor.logicalTextureSize, { mirror: index === 1 }),
    [x, 0.32, 0.03], [0, -p(2.5), 0],
  ));
  return { root, head, legs, arms: [] };
}

function createSheep(visuals: VoxelVisualFactory): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS.sheep;
  const fur = descriptor.overlayTexturePaths![0]!;
  const root = new THREE.Group();
  root.name = 'mob:sheep';
  const bodyDefinition = cuboid([8, 16, 6], [28, 8], descriptor.logicalTextureSize);
  const body = part(visuals, root, 'sheep:body', descriptor.texturePath, bodyDefinition, [0, 0.86, 0.06]);
  body.rotation.x = Math.PI / 2;
  visuals.addTexturedCuboid(body, { ...bodyDefinition, inflate: 0.075 }, [0, 0, 0], fur);
  const headDefinition = cuboid([6, 6, 8], [0, 0], descriptor.logicalTextureSize);
  const head = part(visuals, root, 'sheep:head', descriptor.texturePath, headDefinition, [0, 1.05, -0.52]);
  visuals.addTexturedCuboid(head, { ...headDefinition, inflate: 0.04 }, [0, 0, 0], fur);
  const legs = [
    [-0.22, 0.54, -0.3], [0.22, 0.54, -0.3],
    [-0.22, 0.54, 0.3], [0.22, 0.54, 0.3],
  ].map((pivot, index) => {
    const definition = cuboid([4, 6, 4], [0, 16], descriptor.logicalTextureSize, { mirror: index % 2 === 1 });
    const leg = part(visuals, root, `sheep:leg:${index}`, descriptor.texturePath, definition,
      pivot as [number, number, number], [0, -p(3), 0]);
    visuals.addTexturedCuboid(leg, { ...definition, inflate: 0.025 }, [0, -p(3), 0], fur);
    return leg;
  });
  return { root, head, legs, arms: [] };
}

function createHumanoid(visuals: VoxelVisualFactory, kind: 'zombie' | 'skeleton'): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS[kind];
  const root = new THREE.Group();
  root.name = `mob:${kind}`;
  const head = part(visuals, root, `${kind}:head`, descriptor.texturePath,
    cuboid([8, 8, 8], [0, 0], descriptor.logicalTextureSize), [0, 1.52, 0]);
  part(visuals, root, `${kind}:torso`, descriptor.texturePath,
    cuboid([8, 12, 4], [16, 16], descriptor.logicalTextureSize), [0, 1.02, 0]);
  const limbWidth = kind === 'skeleton' ? 2 : 4;
  const leftLegUv: readonly [number, number] = kind === 'zombie' ? [16, 48] : [0, 16];
  const leftArmUv: readonly [number, number] = kind === 'zombie' ? [32, 48] : [40, 16];
  const legs = [
    part(visuals, root, `${kind}:right-leg`, descriptor.texturePath,
      cuboid([limbWidth, 12, limbWidth], [0, 16], descriptor.logicalTextureSize), [-0.125, 0.75, 0], [0, -0.375, 0]),
    part(visuals, root, `${kind}:left-leg`, descriptor.texturePath,
      cuboid([limbWidth, 12, limbWidth], leftLegUv, descriptor.logicalTextureSize, { mirror: true }), [0.125, 0.75, 0], [0, -0.375, 0]),
  ];
  const shoulder = kind === 'skeleton' ? 0.31 : 0.375;
  const arms = [
    part(visuals, root, `${kind}:right-arm`, descriptor.texturePath,
      cuboid([limbWidth, 12, limbWidth], [40, 16], descriptor.logicalTextureSize), [-shoulder, 1.37, 0], [0, -0.375, 0]),
    part(visuals, root, `${kind}:left-arm`, descriptor.texturePath,
      cuboid([limbWidth, 12, limbWidth], leftArmUv, descriptor.logicalTextureSize, { mirror: true }), [shoulder, 1.37, 0], [0, -0.375, 0]),
  ];
  return { root, head, legs, arms };
}

function createCreeper(visuals: VoxelVisualFactory): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS.creeper;
  const root = new THREE.Group();
  root.name = 'mob:creeper';
  const head = part(visuals, root, 'creeper:head', descriptor.texturePath,
    cuboid([8, 8, 8], [0, 0], descriptor.logicalTextureSize), [0, 1.4, 0]);
  part(visuals, root, 'creeper:body', descriptor.texturePath,
    cuboid([8, 12, 4], [16, 16], descriptor.logicalTextureSize), [0, 0.85, 0]);
  const legs = [
    [-0.18, 0.375, -0.14], [0.18, 0.375, -0.14],
    [-0.18, 0.375, 0.14], [0.18, 0.375, 0.14],
  ].map((pivot, index) => part(
    visuals, root, `creeper:leg:${index}`, descriptor.texturePath,
    cuboid([4, 6, 4], [0, 16], descriptor.logicalTextureSize, { mirror: index % 2 === 1 }),
    pivot as [number, number, number], [0, -p(3), 0],
  ));
  return { root, head, legs, arms: [] };
}

function createSpider(visuals: VoxelVisualFactory): MobModel {
  const descriptor = MOB_MODEL_DESCRIPTORS.spider;
  const root = new THREE.Group();
  root.name = 'mob:spider';
  part(visuals, root, 'spider:thorax', descriptor.texturePath,
    cuboid([6, 6, 6], [0, 0], descriptor.logicalTextureSize), [0, 0.48, -0.05]);
  part(visuals, root, 'spider:abdomen', descriptor.texturePath,
    cuboid([10, 8, 12], [0, 12], descriptor.logicalTextureSize), [0, 0.48, 0.43]);
  const headDefinition = cuboid([8, 8, 8], [32, 4], descriptor.logicalTextureSize);
  const head = part(visuals, root, 'spider:head', descriptor.texturePath, headDefinition, [0, 0.48, -0.48]);
  visuals.addTexturedCuboid(
    head,
    { ...headDefinition, inflate: 0.006 },
    [0, 0, 0],
    descriptor.overlayTexturePaths![0]!,
    { glow: true },
  );
  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1] as const) {
    for (let index = 0; index < 4; index += 1) {
      const pivot: [number, number, number] = [side * 0.24, 0.45, (index - 1.5) * 0.13];
      const leg = part(
        visuals, root, `spider:leg:${side}:${index}`, descriptor.texturePath,
        cuboid([16, 2, 2], [18, 0], descriptor.logicalTextureSize, { mirror: side === 1 }),
        pivot, [side * 0.5, 0, 0],
      );
      leg.rotation.y = side * (0.16 + index * 0.055);
      leg.rotation.z = side * -0.34;
      leg.userData.baseRotationY = leg.rotation.y;
      leg.userData.baseRotationZ = leg.rotation.z;
      legs.push(leg);
    }
  }
  return { root, head, legs, arms: [] };
}

export function createMobModel(visuals: VoxelVisualFactory, kind: MobKind): MobModel {
  switch (kind) {
    case 'cow': return createCow(visuals);
    case 'pig': return createPig(visuals);
    case 'chicken': return createChicken(visuals);
    case 'sheep': return createSheep(visuals);
    case 'zombie': return createHumanoid(visuals, 'zombie');
    case 'skeleton': return createHumanoid(visuals, 'skeleton');
    case 'creeper': return createCreeper(visuals);
    case 'spider': return createSpider(visuals);
  }
}
