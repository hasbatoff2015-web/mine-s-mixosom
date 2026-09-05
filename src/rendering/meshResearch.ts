/**
 * Isolated mesher research helpers. Not imported by WorldRenderer.
 * Greedy / 3×3 AO / neighborhood fill stay out of the production mesh path.
 */
import { BlockId, getBlockDefinition } from '../blocks';
import { CHUNK_SIZE } from '../core/constants';
import {
  sampleSurfaceVertexLight,
  shadePackedQuad,
  surfaceSamplePlane,
  type LightCellReader,
  type SurfaceLight,
} from '../world/lightSampling';
import type { Chunk } from '../world/Chunk';
import type { VoxelWorld } from '../world/World';

const CUBE_FACE_CORNERS: ReadonlyArray<{
  normal: readonly [number, number, number];
  corners: ReadonlyArray<readonly [number, number, number]>;
}> = [
  { normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const scratch: SurfaceLight = { sky: 0, block: 0, ao: 1 };
const cells9 = new Float64Array(9);

function occludes(id: number): boolean {
  if (id === BlockId.Air) return false;
  return getBlockDefinition(id as BlockId).occludesFaces === true;
}

function neighborId(world: VoxelWorld, cx: number, cz: number, x: number, y: number, z: number, height: number): number {
  if (y < 0) return BlockId.Bedrock;
  if (y >= height) return BlockId.Air;
  const wx = cx * CHUNK_SIZE + x;
  const wz = cz * CHUNK_SIZE + z;
  const ncx = Math.floor(wx / CHUNK_SIZE);
  const ncz = Math.floor(wz / CHUNK_SIZE);
  const chunk = ncx === cx && ncz === cz
    ? world.getChunk(cx, cz, false)
    : world.getChunk(ncx, ncz, false);
  if (!chunk) return BlockId.Air;
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return chunk.blocks[y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx]!;
}

/** 3×3 plane cache for one cube face; each corner still uses shadePackedQuad. */
export function sampleCubeFace3x3(
  read: LightCellReader,
  x: number, y: number, z: number,
  normal: readonly [number, number, number],
  corners: ReadonlyArray<readonly [number, number, number]>,
  out: SurfaceLight[],
): void {
  const nx = normal[0]!;
  const ny = normal[1]!;
  const nz = normal[2]!;
  let minI = Infinity;
  let minJ = Infinity;
  let axis: 0 | 1 | 2 = 1;
  let plane = 0;
  for (let c = 0; c < 4; c += 1) {
    const corner = corners[c]!;
    const sample = surfaceSamplePlane(x + corner[0], y + corner[1], z + corner[2], nx, ny, nz);
    axis = sample.axis;
    plane = sample.plane;
    if (sample.i < minI) minI = sample.i;
    if (sample.j < minJ) minJ = sample.j;
  }
  for (let dj = 0; dj < 3; dj += 1) {
    for (let di = 0; di < 3; di += 1) {
      const i = minI + di;
      const j = minJ + dj;
      cells9[dj * 3 + di] = axis === 0
        ? read(plane, i, j)
        : axis === 1
          ? read(i, plane, j)
          : read(i, j, plane);
    }
  }
  for (let c = 0; c < 4; c += 1) {
    const corner = corners[c]!;
    const sample = surfaceSamplePlane(x + corner[0], y + corner[1], z + corner[2], nx, ny, nz);
    const di = sample.i - minI;
    const dj = sample.j - minJ;
    const a = cells9[dj * 3 + di]!;
    const b = cells9[dj * 3 + di + 1]!;
    const cc = cells9[(dj + 1) * 3 + di]!;
    const d = cells9[(dj + 1) * 3 + di + 1]!;
    const anchor = ((sample.axis === 0 ? y : x) > sample.i ? 1 : 0)
      + ((sample.axis === 2 ? y : z) > sample.j ? 2 : 0);
    shadePackedQuad(a, b, cc, d, sample.fu, sample.fv, anchor, out[c]!);
  }
}

export function compareAo3x3(
  world: VoxelWorld,
  cx: number,
  cz: number,
  read: LightCellReader,
  maxFaces = 4000,
): { compared: number; mismatches: number; perVertexMs: number; face3x3Ms: number } {
  const chunk = world.getChunk(cx, cz)!;
  const height = chunk.scanMaxY() + 1;
  const blocks = chunk.blocks;
  const current: SurfaceLight[] = [
    { sky: 0, block: 0, ao: 1 },
    { sky: 0, block: 0, ao: 1 },
    { sky: 0, block: 0, ao: 1 },
    { sky: 0, block: 0, ao: 1 },
  ];
  const alt: SurfaceLight[] = [
    { sky: 0, block: 0, ao: 1 },
    { sky: 0, block: 0, ao: 1 },
    { sky: 0, block: 0, ao: 1 },
    { sky: 0, block: 0, ao: 1 },
  ];
  let compared = 0;
  let mismatches = 0;
  let perVertexMs = 0;
  let face3x3Ms = 0;
  outer: for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const id = blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x]!;
        if (id === BlockId.Air) continue;
        const def = getBlockDefinition(id as BlockId);
        if (def.renderShape !== 'cube') continue;
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        for (const face of CUBE_FACE_CORNERS) {
          const nx = face.normal[0];
          const ny = face.normal[1];
          const nz = face.normal[2];
          if (occludes(neighborId(world, cx, cz, x + nx, y + ny, z + nz, height))) continue;
          const t0 = performance.now();
          for (let c = 0; c < 4; c += 1) {
            const corner = face.corners[c]!;
            sampleSurfaceVertexLight(
              read, wx + corner[0], y + corner[1], wz + corner[2],
              nx, ny, nz, wx, y, wz, current[c]!,
            );
          }
          perVertexMs += performance.now() - t0;
          const t1 = performance.now();
          sampleCubeFace3x3(read, wx, y, wz, face.normal, face.corners, alt);
          face3x3Ms += performance.now() - t1;
          for (let c = 0; c < 4; c += 1) {
            const a = current[c]!;
            const b = alt[c]!;
            if (Math.abs(a.sky - b.sky) > 1e-9 || Math.abs(a.block - b.block) > 1e-9 || Math.abs(a.ao - b.ao) > 1e-9) {
              mismatches += 1;
            }
          }
          compared += 1;
          if (compared >= maxFaces) break outer;
        }
      }
    }
  }
  void scratch;
  return { compared, mismatches, perVertexMs, face3x3Ms };
}

type Axis = 'x' | 'y' | 'z';

function greedyMerge(
  world: VoxelWorld,
  cx: number,
  cz: number,
  nx: number, ny: number, nz: number,
  uAxis: Axis,
  vAxis: Axis,
  mode: 'id' | 'id+ao',
  read?: LightCellReader,
): { naive: number; greedy: number } {
  const chunk = world.getChunk(cx, cz)!;
  const height = chunk.scanMaxY() + 1;
  const blocks = chunk.blocks;
  const uSize = uAxis === 'y' ? height : CHUNK_SIZE;
  const vSize = vAxis === 'y' ? height : CHUNK_SIZE;
  const wSize = nx !== 0 ? CHUNK_SIZE : ny !== 0 ? height : CHUNK_SIZE;
  const used = new Uint8Array(Math.max(uSize * vSize, 1));
  const aoKey = (x: number, y: number, z: number): number => {
    if (!read || mode !== 'id+ao') return 0;
    const wx = cx * CHUNK_SIZE + x;
    const wz = cz * CHUNK_SIZE + z;
    let key = 0;
    for (let c = 0; c < 4; c += 1) {
      sampleSurfaceVertexLight(read, wx + 0.5, y + 0.5, wz + 0.5, nx, ny, nz, wx, y, wz, scratch);
      key = (key * 31 + Math.round(scratch.ao * 1000) + Math.round(scratch.sky * 15)) | 0;
    }
    return key;
  };
  const coord = (w: number, u: number, v: number) => {
    const x = nx !== 0 ? w : uAxis === 'x' ? u : v;
    const y = ny !== 0 ? w : uAxis === 'y' ? u : vAxis === 'y' ? v : 0;
    const z = nz !== 0 ? w : uAxis === 'z' ? u : v;
    return { x, y, z };
  };
  const blockAt = (x: number, y: number, z: number) => {
    if (y < 0 || y >= height || x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return 0;
    return blocks[y * CHUNK_SIZE * CHUNK_SIZE + z * CHUNK_SIZE + x]!;
  };
  let naive = 0;
  let greedy = 0;
  for (let w = 0; w < wSize; w += 1) {
    used.fill(0);
    for (let v = 0; v < vSize; v += 1) {
      for (let u = 0; u < uSize; u += 1) {
        const { x, y, z } = coord(w, u, v);
        const id = blockAt(x, y, z);
        if (id === BlockId.Air) continue;
        const def = getBlockDefinition(id as BlockId);
        if (def.renderShape !== 'cube') continue;
        if (occludes(neighborId(world, cx, cz, x + nx, y + ny, z + nz, height))) continue;
        naive += 1;
        if (used[u + v * uSize]) continue;
        const key = aoKey(x, y, z);
        let width = 1;
        while (u + width < uSize && !used[u + width + v * uSize]) {
          const n = coord(w, u + width, v);
          if (blockAt(n.x, n.y, n.z) !== id) break;
          if (occludes(neighborId(world, cx, cz, n.x + nx, n.y + ny, n.z + nz, height))) break;
          if (aoKey(n.x, n.y, n.z) !== key) break;
          width += 1;
        }
        let depth = 1;
        outer: while (v + depth < vSize) {
          for (let du = 0; du < width; du += 1) {
            if (used[u + du + (v + depth) * uSize]) break outer;
            const n = coord(w, u + du, v + depth);
            if (blockAt(n.x, n.y, n.z) !== id) break outer;
            if (occludes(neighborId(world, cx, cz, n.x + nx, n.y + ny, n.z + nz, height))) break outer;
            if (aoKey(n.x, n.y, n.z) !== key) break outer;
          }
          depth += 1;
        }
        for (let dv = 0; dv < depth; dv += 1) {
          for (let du = 0; du < width; du += 1) used[u + du + (v + dv) * uSize] = 1;
        }
        greedy += 1;
      }
    }
  }
  return { naive, greedy };
}

export function greedyRealistic(world: VoxelWorld, cx: number, cz: number, read: LightCellReader) {
  const dirs: Array<{ nx: number; ny: number; nz: number; u: Axis; v: Axis }> = [
    { nx: 1, ny: 0, nz: 0, u: 'y', v: 'z' },
    { nx: -1, ny: 0, nz: 0, u: 'y', v: 'z' },
    { nx: 0, ny: 1, nz: 0, u: 'x', v: 'z' },
    { nx: 0, ny: -1, nz: 0, u: 'x', v: 'z' },
    { nx: 0, ny: 0, nz: 1, u: 'x', v: 'y' },
    { nx: 0, ny: 0, nz: -1, u: 'x', v: 'y' },
  ];
  let idNaive = 0;
  let idGreedy = 0;
  let aoNaive = 0;
  let aoGreedy = 0;
  for (const dir of dirs) {
    const byId = greedyMerge(world, cx, cz, dir.nx, dir.ny, dir.nz, dir.u, dir.v, 'id');
    const byAo = greedyMerge(world, cx, cz, dir.nx, dir.ny, dir.nz, dir.u, dir.v, 'id+ao', read);
    idNaive += byId.naive;
    idGreedy += byId.greedy;
    aoNaive += byAo.naive;
    aoGreedy += byAo.greedy;
  }
  return {
    cubeFaces: idNaive,
    greedyIdOnlyQuads: idGreedy,
    greedyIdOnlyRatio: idNaive > 0 ? Number((idNaive / Math.max(1, idGreedy)).toFixed(2)) : 0,
    greedyIdAoQuads: aoGreedy,
    greedyIdAoRatio: aoNaive > 0 ? Number((aoNaive / Math.max(1, aoGreedy)).toFixed(2)) : 0,
    note: 'id-only ignores AO/light/texture. id+ao merges only when a cheap AO fingerprint matches — closer to a visually safe greedy.',
  };
}

export function packedNeighborhoodFillMs(chunk: Chunk): number {
  const height = chunk.scanMaxY() + 2;
  const packed = new Uint16Array(18 * height * 18);
  const start = performance.now();
  const originX = chunk.x * CHUNK_SIZE;
  const originZ = chunk.z * CHUNK_SIZE;
  for (let y = 0; y < height; y += 1) {
    for (let z = -1; z < CHUNK_SIZE + 1; z += 1) {
      for (let x = -1; x < CHUNK_SIZE + 1; x += 1) {
        const wx = originX + x;
        const wz = originZ + z;
        const localX = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const localZ = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        packed[(y * 18 + (z + 1)) * 18 + (x + 1)] = chunk.blocks[y * CHUNK_SIZE * CHUNK_SIZE + localZ * CHUNK_SIZE + localX] ?? 0;
      }
    }
  }
  return performance.now() - start;
}
