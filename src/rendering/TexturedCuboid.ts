import * as THREE from 'three';

export type TextureSize = readonly [number, number];
export type CuboidSize = readonly [number, number, number];

export interface TexturedCuboidDefinition {
  /** Legacy model dimensions in logical texture pixels. */
  readonly size: CuboidSize;
  readonly textureOffset: readonly [number, number];
  readonly logicalTextureSize: TextureSize;
  /** World-space dimensions. Defaults to `size / 16`. */
  readonly physicalSize?: CuboidSize;
  readonly mirror?: boolean;
  /** Expands each side in world units, used by fur/eyes overlay layers. */
  readonly inflate?: number;
}

export interface LogicalUvRect {
  readonly u: number;
  readonly v: number;
  readonly width: number;
  readonly height: number;
}

export type CuboidFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

interface FaceDefinition {
  readonly face: CuboidFace;
  readonly normal: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
}

const FACES: readonly FaceDefinition[] = [
  { face: 'right', normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { face: 'left', normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { face: 'top', normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { face: 'bottom', normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { face: 'back', normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { face: 'front', normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/** Standard legacy entity-sheet cross layout in logical texture pixels. */
export function cuboidUvRects(definition: TexturedCuboidDefinition): Readonly<Record<CuboidFace, LogicalUvRect>> {
  const [width, height, depth] = definition.size;
  const [u, v] = definition.textureOffset;
  return {
    top: { u: u + depth, v, width, height: depth },
    bottom: { u: u + depth + width, v, width, height: depth },
    left: { u, v: v + depth, width: depth, height },
    front: { u: u + depth, v: v + depth, width, height },
    right: { u: u + depth + width, v: v + depth, width: depth, height },
    back: { u: u + depth + width + depth, v: v + depth, width, height },
  };
}

/**
 * Maps logical model coordinates through the physical sheet scale into WebGL
 * normalized UVs. The explicit actual-size step keeps 1x/2x/4x packs equal.
 */
export function logicalUvToNormalized(
  point: readonly [number, number],
  logicalTextureSize: TextureSize,
  actualTextureSize: TextureSize = logicalTextureSize,
): readonly [number, number] {
  const scaleX = actualTextureSize[0] / logicalTextureSize[0];
  const scaleY = actualTextureSize[1] / logicalTextureSize[1];
  return [point[0] * scaleX / actualTextureSize[0], point[1] * scaleY / actualTextureSize[1]];
}

function rectUvs(
  rect: LogicalUvRect,
  logicalTextureSize: TextureSize,
  mirror: boolean,
): readonly (readonly [number, number])[] {
  const u0 = rect.u;
  const u1 = rect.u + rect.width;
  const v0 = rect.v;
  const v1 = rect.v + rect.height;
  const left = mirror ? u1 : u0;
  const right = mirror ? u0 : u1;
  return [
    logicalUvToNormalized([left, v1], logicalTextureSize),
    logicalUvToNormalized([right, v1], logicalTextureSize),
    logicalUvToNormalized([right, v0], logicalTextureSize),
    logicalUvToNormalized([left, v0], logicalTextureSize),
  ];
}

export function createTexturedCuboidGeometry(definition: TexturedCuboidDefinition): THREE.BufferGeometry {
  const [sourceWidth, sourceHeight, sourceDepth] = definition.size;
  const physical = definition.physicalSize ?? [sourceWidth / 16, sourceHeight / 16, sourceDepth / 16];
  const inflate = definition.inflate ?? 0;
  const width = physical[0] + inflate * 2;
  const height = physical[1] + inflate * 2;
  const depth = physical[2] + inflate * 2;
  const minimum = [-width / 2, -height / 2, -depth / 2] as const;
  const dimensions = [width, height, depth] as const;
  const rects = cuboidUvRects(definition);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const face of FACES) {
    const base = positions.length / 3;
    const faceUvs = rectUvs(rects[face.face], definition.logicalTextureSize, definition.mirror === true);
    for (let index = 0; index < 4; index += 1) {
      const corner = face.corners[index]!;
      positions.push(
        minimum[0] + corner[0] * dimensions[0],
        minimum[1] + corner[1] * dimensions[1],
        minimum[2] + corner[2] * dimensions[2],
      );
      normals.push(...face.normal);
      uvs.push(...faceUvs[index]!);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
