import * as THREE from 'three';
import type { HorizontalFacing } from '../blocks';

/** Faithful/vanilla entity atlas. UV math is in 64×64 logical pixels. */
export const CHEST_TEXTURE_KEY = 'entity/chest/normal';

export const CHEST_ATLAS_LOGICAL = 64;
export const CHEST_INSET = 1 / 16;
export const CHEST_BODY_HEIGHT = 10 / 16;
export const CHEST_LID_HEIGHT = 5 / 16;
export const CHEST_OPEN_ANGLE = Math.PI / 2;
/** Exponential lid follow per 20 TPS tick, matching vanilla ~0.1 lerp. */
export const CHEST_LID_TICK_LERP = 0.1;
/**
 * Lift the lid off the body top by a sub-pixel so closed body-top and lid-bottom
 * are not coplanar. Large polygonOffset is not used.
 */
export const CHEST_LID_SEAM = 1 / 64;

export interface ChestCuboid {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** Vanilla single-chest body, north-facing lock at −Z. */
export const CHEST_BODY_BOX: ChestCuboid = Object.freeze({
  minX: CHEST_INSET, minY: 0, minZ: CHEST_INSET,
  maxX: 1 - CHEST_INSET, maxY: CHEST_BODY_HEIGHT, maxZ: 1 - CHEST_INSET,
});

export const CHEST_LID_BOX: ChestCuboid = Object.freeze({
  minX: CHEST_INSET, minY: CHEST_BODY_HEIGHT + CHEST_LID_SEAM, minZ: CHEST_INSET,
  maxX: 1 - CHEST_INSET, maxY: 14 / 16 + CHEST_LID_SEAM, maxZ: 1 - CHEST_INSET,
});

export const CHEST_LATCH_BOX: ChestCuboid = Object.freeze({
  minX: 7 / 16, minY: 7 / 16, minZ: 0,
  maxX: 9 / 16, maxY: 11 / 16, maxZ: 1 / 16,
});

export const CHEST_LID_PIVOT = Object.freeze({
  x: 0.5,
  y: CHEST_BODY_HEIGHT,
  z: 1 - CHEST_INSET,
});

export function defaultChestFacing(facing?: HorizontalFacing): HorizontalFacing {
  return facing ?? 'north';
}

/** Yaw so the authored north lock faces `facing`. */
export function chestYaw(facing: HorizontalFacing): number {
  switch (facing) {
    case 'north': return 0;
    case 'south': return Math.PI;
    case 'west': return Math.PI / 2;
    case 'east': return -Math.PI / 2;
  }
}

export function chestLidAngle(openProgress: number): number {
  const t = Math.max(0, Math.min(1, openProgress));
  if (t === 0) return 0;
  return t * CHEST_OPEN_ANGLE;
}

/** Authored latch/front is −Z. After `chestYaw(facing)` this equals `facing`. */
export function chestLatchWorldNormal(facing: HorizontalFacing): readonly [number, number, number] {
  const yaw = chestYaw(facing);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [-sin, 0, -cos];
}

export function isChestEntityTextureKey(key: string): boolean {
  return key === CHEST_TEXTURE_KEY || key.endsWith('/chest/normal');
}

/** World Y of the lid's front-top edge after hinge rotation (block-local). */
export function chestLidFrontTopY(openProgress: number): number {
  const angle = chestLidAngle(openProgress);
  const py = CHEST_LID_BOX.maxY - CHEST_LID_PIVOT.y;
  const pz = CHEST_LID_BOX.minZ - CHEST_LID_PIVOT.z;
  return CHEST_LID_PIVOT.y + py * Math.cos(angle) - pz * Math.sin(angle);
}

/** Frame-rate independent approach of `current` toward `target` (0/1). */
export function stepChestOpenProgress(current: number, target: number, dtSeconds: number): number {
  const blend = 1 - Math.pow(1 - CHEST_LID_TICK_LERP, Math.max(0, dtSeconds) / 0.05);
  return current + (target - current) * blend;
}

interface FaceSpec {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly corners: readonly (readonly [number, number, number])[];
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

/**
 * ModelRenderer-style box UVs in a 64×64 atlas (v=0 at image top).
 * `texX/texY` is the box's texture offset.
 */
function modelBoxFaces(
  box: ChestCuboid,
  texX: number,
  texY: number,
  logicalW: number,
  logicalH: number,
  logicalD: number,
  omit: ReadonlySet<'east' | 'west' | 'up' | 'down' | 'south' | 'north'> = new Set(),
): FaceSpec[] {
  const w = logicalW;
  const h = logicalH;
  const d = logicalD;
  const toUv = (px: number, py: number): readonly [number, number] => [
    px / CHEST_ATLAS_LOGICAL,
    1 - py / CHEST_ATLAS_LOGICAL,
  ];
  const rect = (px: number, py: number, sx: number, sy: number): readonly [number, number, number, number] => {
    const a = toUv(px, py + sy);
    const b = toUv(px + sx, py);
    return [a[0], a[1], b[0], b[1]];
  };
  const down = rect(texX + d, texY, w, d);
  const up = rect(texX + d + w, texY, w, d);
  const west = rect(texX, texY + d, d, h);
  const south = rect(texX + d, texY + d, w, h);
  const east = rect(texX + d + w, texY + d, d, h);
  const north = rect(texX + d + w + d, texY + d, w, h);
  const { minX, minY, minZ, maxX, maxY, maxZ } = box;
  const faces: FaceSpec[] = [];
  if (!omit.has('east')) {
    faces.push({ nx: 1, ny: 0, nz: 0, corners: [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]], u0: east[0], v0: east[1], u1: east[2], v1: east[3] });
  }
  if (!omit.has('west')) {
    faces.push({ nx: -1, ny: 0, nz: 0, corners: [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]], u0: west[0], v0: west[1], u1: west[2], v1: west[3] });
  }
  if (!omit.has('up')) {
    faces.push({ nx: 0, ny: 1, nz: 0, corners: [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]], u0: up[0], v0: up[1], u1: up[2], v1: up[3] });
  }
  if (!omit.has('down')) {
    faces.push({ nx: 0, ny: -1, nz: 0, corners: [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]], u0: down[0], v0: down[1], u1: down[2], v1: down[3] });
  }
  if (!omit.has('south')) {
    faces.push({ nx: 0, ny: 0, nz: 1, corners: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]], u0: south[0], v0: south[1], u1: south[2], v1: south[3] });
  }
  if (!omit.has('north')) {
    faces.push({ nx: 0, ny: 0, nz: -1, corners: [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]], u0: north[0], v0: north[1], u1: north[2], v1: north[3] });
  }
  return faces;
}

function appendFaces(
  faces: readonly FaceSpec[],
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  origin: readonly [number, number, number] = [0, 0, 0],
): void {
  for (const face of faces) {
    const base = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2]);
      normals.push(face.nx, face.ny, face.nz);
    }
    uvs.push(face.u0, face.v0, face.u1, face.v0, face.u1, face.v1, face.u0, face.v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function geometryFrom(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  extra: Record<string, unknown>,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  Object.assign(geometry.userData, extra);
  return geometry;
}

export function createChestBodyGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  appendFaces(modelBoxFaces(CHEST_BODY_BOX, 0, 19, 14, 10, 14), positions, normals, uvs, indices);
  return geometryFrom(positions, normals, uvs, indices, { chestPart: 'body', chestModel: true });
}

export function createChestLidGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Include the lid underside (`down`). It was previously omitted to avoid a
  // coplanar seam with the body top; CHEST_LID_SEAM already separates those
  // planes, and omitting `down` made the inner lid transparent when open.
  appendFaces(
    modelBoxFaces(CHEST_LID_BOX, 0, 0, 14, 5, 14),
    positions, normals, uvs, indices,
    [CHEST_LID_PIVOT.x, CHEST_LID_PIVOT.y, CHEST_LID_PIVOT.z],
  );
  return geometryFrom(positions, normals, uvs, indices, { chestPart: 'lid', chestModel: true });
}

export function createChestLatchGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  appendFaces(
    modelBoxFaces(CHEST_LATCH_BOX, 0, 0, 2, 4, 1, new Set(['south'])),
    positions, normals, uvs, indices,
    [CHEST_LID_PIVOT.x, CHEST_LID_PIVOT.y, CHEST_LID_PIVOT.z],
  );
  return geometryFrom(positions, normals, uvs, indices, { chestPart: 'latch', chestModel: true });
}

/** Closed chest as one mesh, origin at block centre for held/icon use. */
export function createClosedChestGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const origin: readonly [number, number, number] = [0.5, 0.5, 0.5];
  appendFaces(modelBoxFaces(CHEST_BODY_BOX, 0, 19, 14, 10, 14), positions, normals, uvs, indices, origin);
  appendFaces(modelBoxFaces(CHEST_LID_BOX, 0, 0, 14, 5, 14), positions, normals, uvs, indices, origin);
  appendFaces(modelBoxFaces(CHEST_LATCH_BOX, 0, 0, 2, 4, 1, new Set(['south'])), positions, normals, uvs, indices, origin);
  return geometryFrom(positions, normals, uvs, indices, {
    chestModel: true,
    specialHeldModel: true,
    chestPart: 'closed',
    specialHeldBoxes: 3,
  });
}

export function chestCollisionBox(x: number, y: number, z: number): {
  minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number;
} {
  return {
    minX: x + CHEST_INSET,
    minY: y,
    minZ: z + CHEST_INSET,
    maxX: x + 1 - CHEST_INSET,
    maxY: y + 14 / 16,
    maxZ: z + 1 - CHEST_INSET,
  };
}

export function chestGeometryHasCoplanarBodyLidOverlap(): boolean {
  return CHEST_LID_BOX.minY < CHEST_BODY_BOX.maxY;
}

/** Lid underside is a real `down` face (FrontSide), not a missing/culled interior. */
export function chestLidIncludesInteriorFace(geometry: THREE.BufferGeometry): boolean {
  const normals = geometry.getAttribute('normal');
  if (!normals) return false;
  for (let index = 0; index < normals.count; index += 1) {
    if (normals.getX(index) === 0 && normals.getY(index) < -0.5 && normals.getZ(index) === 0) {
      return true;
    }
  }
  return false;
}
