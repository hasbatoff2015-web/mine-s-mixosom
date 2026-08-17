import * as THREE from 'three';
import type { TextureSize } from '../rendering/TexturedCuboid';
import type { VoxelVisualFactory } from './voxelVisuals';

export const LEGACY_MODEL_UNITS_PER_BLOCK = 16;
export const LEGACY_MODEL_GROUND_Y = 24;

export type LegacyVector = readonly [x: number, y: number, z: number];

export interface LegacyModelBox {
  /** addBox origin relative to the part rotation point, in legacy model units. */
  readonly origin: LegacyVector;
  readonly size: LegacyVector;
  readonly textureOffset: readonly [u: number, v: number];
  readonly mirror?: boolean;
  /** Legacy addBox inflation in model units. */
  readonly inflate?: number;
  readonly texturePath?: string;
  readonly glow?: boolean;
  readonly doubleSided?: boolean;
  readonly alphaTest?: number;
}

export interface LegacyModelPart {
  readonly name: string;
  /** setRotationPoint value in legacy model units. */
  readonly rotationPoint: LegacyVector;
  readonly boxes: readonly LegacyModelBox[];
  /** Legacy model Euler angles, radians. */
  readonly rotation?: LegacyVector;
}

export interface LegacyModelDefinition {
  readonly texturePath: string;
  readonly logicalTextureSize: TextureSize;
  readonly parts: readonly LegacyModelPart[];
  readonly groundY?: number;
}

export interface BuiltLegacyModel {
  readonly root: THREE.Group;
  readonly parts: ReadonlyMap<string, THREE.Group>;
}

/** Legacy X/right, Y/down, Z/back point mapped into Three X/right, Y/up, Z/back. */
export function legacyRotationPointToWorld(
  point: LegacyVector,
  groundY = LEGACY_MODEL_GROUND_Y,
): LegacyVector {
  return [
    point[0] / LEGACY_MODEL_UNITS_PER_BLOCK,
    (groundY - point[1]) / LEGACY_MODEL_UNITS_PER_BLOCK,
    point[2] / LEGACY_MODEL_UNITS_PER_BLOCK,
  ];
}

/** addBox center mapped relative to its pivot; this is deliberately not the pivot itself. */
export function legacyBoxCenterToLocal(box: Pick<LegacyModelBox, 'origin' | 'size'>): LegacyVector {
  return [
    (box.origin[0] + box.size[0] / 2) / LEGACY_MODEL_UNITS_PER_BLOCK,
    -(box.origin[1] + box.size[1] / 2) / LEGACY_MODEL_UNITS_PER_BLOCK,
    (box.origin[2] + box.size[2] / 2) / LEGACY_MODEL_UNITS_PER_BLOCK,
  ];
}

/** Reflection of legacy Y-down coordinates changes X/Z rotation signs. */
export function legacyRotationToThree(rotation: LegacyVector): LegacyVector {
  return [-rotation[0], rotation[1], -rotation[2]];
}

export function buildLegacyModel(
  visuals: VoxelVisualFactory,
  name: string,
  definitions: readonly LegacyModelDefinition[],
): BuiltLegacyModel {
  const root = new THREE.Group();
  root.name = name;
  const parts = new Map<string, THREE.Group>();

  for (const definition of definitions) {
    for (const partDefinition of definition.parts) {
      let part = parts.get(partDefinition.name);
      if (!part) {
        part = new THREE.Group();
        part.name = `${name}:${partDefinition.name}`;
        part.position.set(...legacyRotationPointToWorld(
          partDefinition.rotationPoint,
          definition.groundY ?? LEGACY_MODEL_GROUND_Y,
        ));
        if (partDefinition.rotation) part.rotation.set(...legacyRotationToThree(partDefinition.rotation));
        part.userData.baseRotationX = part.rotation.x;
        part.userData.baseRotationY = part.rotation.y;
        part.userData.baseRotationZ = part.rotation.z;
        root.add(part);
        parts.set(partDefinition.name, part);
      }
      for (const box of partDefinition.boxes) {
        visuals.addTexturedCuboid(part, {
          size: box.size,
          textureOffset: box.textureOffset,
          logicalTextureSize: definition.logicalTextureSize,
          ...(box.mirror === undefined ? {} : { mirror: box.mirror }),
          ...(box.inflate === undefined ? {} : { inflate: box.inflate / LEGACY_MODEL_UNITS_PER_BLOCK }),
        }, legacyBoxCenterToLocal(box), box.texturePath ?? definition.texturePath, {
          glow: box.glow === true,
          doubleSided: box.doubleSided === true,
          ...(box.alphaTest === undefined ? {} : { alphaTest: box.alphaTest }),
        });
      }
    }
  }
  return { root, parts };
}
