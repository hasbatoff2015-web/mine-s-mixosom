import * as THREE from 'three';
import type { CuboidFace, LogicalUvRect, TextureSize } from '../rendering/TexturedCuboid';
import type { VoxelVisualFactory } from './voxelVisuals';
import {
  LEGACY_MODEL_GROUND_Y,
  LEGACY_MODEL_UNITS_PER_BLOCK,
  type LegacyVector,
  legacyBoxCenterToLocal,
  legacyRotationPointToWorld,
  legacyRotationToThree,
} from './legacySpace';

export {
  LEGACY_MODEL_GROUND_Y,
  LEGACY_MODEL_UNITS_PER_BLOCK,
  type LegacyVector,
  legacyBoxCenterToLocal,
  legacyRotationPointToWorld,
  legacyRotationToThree,
} from './legacySpace';

export interface LegacyModelBox {
  /** addBox origin relative to the part rotation point, in legacy model units. */
  readonly origin: LegacyVector;
  readonly size: LegacyVector;
  readonly textureOffset: readonly [u: number, v: number];
  readonly mirror?: boolean;
  readonly faceUvRects?: Partial<Readonly<Record<CuboidFace, LogicalUvRect>>>;
  /** Optional render dimensions in legacy model units; UV layout still uses `size`. */
  readonly physicalSize?: LegacyVector;
  /** Legacy addBox inflation in model units. */
  readonly inflate?: number;
  readonly texturePath?: string;
  readonly glow?: boolean;
  readonly doubleSided?: boolean;
  readonly alphaTest?: number;
  /** Optional mesh tag, e.g. wolf collar overlay. */
  readonly layer?: string;
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
        part.userData.basePositionX = part.position.x;
        part.userData.basePositionY = part.position.y;
        part.userData.basePositionZ = part.position.z;
        part.userData.baseLegacyPivotX = partDefinition.rotationPoint[0];
        part.userData.baseLegacyPivotY = partDefinition.rotationPoint[1];
        part.userData.baseLegacyPivotZ = partDefinition.rotationPoint[2];
        root.add(part);
        parts.set(partDefinition.name, part);
      }
      for (const box of partDefinition.boxes) {
        const mesh = visuals.addTexturedCuboid(part, {
          size: box.size,
          textureOffset: box.textureOffset,
          logicalTextureSize: definition.logicalTextureSize,
          ...(box.physicalSize === undefined ? {} : {
            physicalSize: [
              box.physicalSize[0] / LEGACY_MODEL_UNITS_PER_BLOCK,
              box.physicalSize[1] / LEGACY_MODEL_UNITS_PER_BLOCK,
              box.physicalSize[2] / LEGACY_MODEL_UNITS_PER_BLOCK,
            ] as LegacyVector,
          }),
          ...(box.mirror === undefined ? {} : { mirror: box.mirror }),
          ...(box.faceUvRects === undefined ? {} : { faceUvRects: box.faceUvRects }),
          ...(box.inflate === undefined ? {} : { inflate: box.inflate / LEGACY_MODEL_UNITS_PER_BLOCK }),
        }, legacyBoxCenterToLocal(box), box.texturePath ?? definition.texturePath, {
          glow: box.glow === true,
          doubleSided: box.doubleSided === true,
          ...(box.alphaTest === undefined ? {} : { alphaTest: box.alphaTest }),
        });
        if (box.layer) mesh.userData.petLayer = box.layer;
      }
    }
  }
  return { root, parts };
}
