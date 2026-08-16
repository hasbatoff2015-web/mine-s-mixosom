import * as THREE from 'three';
import type { MobKind } from './mobDefinitions';
import { VoxelVisualFactory } from './voxelVisuals';

export interface MobModel {
  readonly root: THREE.Group;
  readonly head?: THREE.Object3D;
  readonly legs: readonly THREE.Object3D[];
  readonly arms: readonly THREE.Object3D[];
}

function quadruped(
  visuals: VoxelVisualFactory,
  kind: MobKind,
  bodyColor: number,
  headColor: number,
  legColor: number,
  bodySize: readonly [number, number, number],
  bodyY: number,
  headSize: readonly [number, number, number],
  headY: number,
): MobModel {
  const root = new THREE.Group();
  root.name = `mob:${kind}`;
  visuals.addBox(root, bodySize, [0, bodyY, 0], bodyColor);
  const head = visuals.addBox(root, headSize, [0, headY, -(bodySize[2] + headSize[2]) * 0.48], headColor);
  const legs = [
    visuals.addBox(root, [0.22, 0.65, 0.22], [-0.28, 0.35, -0.35], legColor),
    visuals.addBox(root, [0.22, 0.65, 0.22], [0.28, 0.35, -0.35], legColor),
    visuals.addBox(root, [0.22, 0.65, 0.22], [-0.28, 0.35, 0.35], legColor),
    visuals.addBox(root, [0.22, 0.65, 0.22], [0.28, 0.35, 0.35], legColor),
  ];
  return { root, head, legs, arms: [] };
}

function humanoid(
  visuals: VoxelVisualFactory,
  kind: 'zombie' | 'skeleton',
  headColor: number,
  torsoColor: number,
  limbColor: number,
  limbWidth: number,
): MobModel {
  const root = new THREE.Group();
  root.name = `mob:${kind}`;
  const head = visuals.addBox(root, [0.5, 0.5, 0.5], [0, 1.55, 0], headColor);
  visuals.addBox(root, [0.55, 0.7, 0.3], [0, 0.95, 0], torsoColor);
  const legs = [
    visuals.addBox(root, [limbWidth, 0.75, limbWidth], [-0.15, 0.38, 0], limbColor),
    visuals.addBox(root, [limbWidth, 0.75, limbWidth], [0.15, 0.38, 0], limbColor),
  ];
  const arms = [
    visuals.addBox(root, [limbWidth, 0.72, limbWidth], [-0.39, 1.03, -0.12], limbColor),
    visuals.addBox(root, [limbWidth, 0.72, limbWidth], [0.39, 1.03, -0.12], limbColor),
  ];
  for (const arm of arms) arm.rotation.x = -Math.PI * 0.42;
  return { root, head, legs, arms };
}

function chicken(visuals: VoxelVisualFactory): MobModel {
  const root = new THREE.Group();
  root.name = 'mob:chicken';
  visuals.addBox(root, [0.45, 0.48, 0.55], [0, 0.45, 0], 0xf1f0e6);
  const head = visuals.addBox(root, [0.38, 0.38, 0.36], [0, 0.78, -0.32], 0xf4f3e9);
  visuals.addBox(root, [0.24, 0.12, 0.24], [0, 0.73, -0.56], 0xe5aa31);
  visuals.addBox(root, [0.12, 0.16, 0.08], [0, 0.6, -0.51], 0xc8322d);
  visuals.addBox(root, [0.09, 0.09, 0.04], [-0.1, 0.83, -0.51], 0x222222);
  visuals.addBox(root, [0.09, 0.09, 0.04], [0.1, 0.83, -0.51], 0x222222);
  const legs = [
    visuals.addBox(root, [0.09, 0.28, 0.09], [-0.12, 0.14, 0], 0xdb9c2e),
    visuals.addBox(root, [0.09, 0.28, 0.09], [0.12, 0.14, 0], 0xdb9c2e),
  ];
  return { root, head, legs, arms: [] };
}

function sheep(visuals: VoxelVisualFactory): MobModel {
  const model = quadruped(
    visuals, 'sheep', 0xf0f0eb, 0x77736c, 0x77736c,
    [0.9, 0.75, 1.15], 0.92, [0.52, 0.55, 0.48], 1.08,
  );
  visuals.addBox(model.root, [0.15, 0.15, 0.05], [-0.13, 1.16, -0.83], 0x222222);
  visuals.addBox(model.root, [0.15, 0.15, 0.05], [0.13, 1.16, -0.83], 0x222222);
  return model;
}

function creeper(visuals: VoxelVisualFactory): MobModel {
  const root = new THREE.Group();
  root.name = 'mob:creeper';
  const head = visuals.addBox(root, [0.62, 0.62, 0.62], [0, 1.42, 0], 0x4ea83e);
  visuals.addBox(root, [0.48, 0.82, 0.42], [0, 0.78, 0], 0x4a9a39);
  const legs = [
    visuals.addBox(root, [0.25, 0.48, 0.25], [-0.18, 0.24, -0.14], 0x377e31),
    visuals.addBox(root, [0.25, 0.48, 0.25], [0.18, 0.24, -0.14], 0x377e31),
    visuals.addBox(root, [0.25, 0.48, 0.25], [-0.18, 0.24, 0.14], 0x377e31),
    visuals.addBox(root, [0.25, 0.48, 0.25], [0.18, 0.24, 0.14], 0x377e31),
  ];
  visuals.addBox(root, [0.12, 0.18, 0.04], [-0.13, 1.5, -0.32], 0x182419);
  visuals.addBox(root, [0.12, 0.18, 0.04], [0.13, 1.5, -0.32], 0x182419);
  visuals.addBox(root, [0.25, 0.26, 0.04], [0, 1.25, -0.32], 0x182419);
  return { root, head, legs, arms: [] };
}

function spider(visuals: VoxelVisualFactory): MobModel {
  const root = new THREE.Group();
  root.name = 'mob:spider';
  visuals.addBox(root, [0.82, 0.4, 0.92], [0, 0.53, 0.2], 0x29272a);
  const head = visuals.addBox(root, [0.62, 0.45, 0.55], [0, 0.5, -0.55], 0x353238);
  visuals.addBox(root, [0.11, 0.09, 0.04], [-0.17, 0.57, -0.84], 0xa31f26);
  visuals.addBox(root, [0.11, 0.09, 0.04], [0.17, 0.57, -0.84], 0xa31f26);
  const legs: THREE.Object3D[] = [];
  for (const side of [-1, 1] as const) {
    for (let index = 0; index < 4; index += 1) {
      const leg = visuals.addBox(
        root,
        [0.68, 0.12, 0.12],
        [side * 0.65, 0.42, (index - 1.5) * 0.24],
        0x242226,
      );
      leg.rotation.y = side * (0.25 + index * 0.08);
      leg.rotation.z = side * -0.18;
      legs.push(leg);
    }
  }
  return { root, head, legs, arms: [] };
}

export function createMobModel(visuals: VoxelVisualFactory, kind: MobKind): MobModel {
  switch (kind) {
    case 'cow': {
      const model = quadruped(
        visuals, 'cow', 0x795033, 0x8b5b3a, 0x4a3325,
        [0.9, 0.72, 1.25], 0.96, [0.58, 0.56, 0.54], 1.14,
      );
      visuals.addBox(model.root, [0.13, 0.13, 0.16], [-0.25, 1.47, -0.78], 0xd8cfaf);
      visuals.addBox(model.root, [0.13, 0.13, 0.16], [0.25, 1.47, -0.78], 0xd8cfaf);
      return model;
    }
    case 'pig':
      return quadruped(
        visuals, 'pig', 0xe48c98, 0xea9aa4, 0xd77f8b,
        [0.88, 0.62, 1.05], 0.78, [0.58, 0.5, 0.5], 0.92,
      );
    case 'chicken': return chicken(visuals);
    case 'sheep': return sheep(visuals);
    case 'zombie': return humanoid(visuals, 'zombie', 0x679b5a, 0x3d8d8b, 0x4c557f, 0.22);
    case 'skeleton': return humanoid(visuals, 'skeleton', 0xc7c7bd, 0xbdbdb3, 0xb6b6ae, 0.14);
    case 'creeper': return creeper(visuals);
    case 'spider': return spider(visuals);
  }
}
