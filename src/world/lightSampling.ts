/** Packed cell: sky bits 0..3, block bits 4..7, full occluder bit 8. */
export type LightCellReader = (x: number, y: number, z: number) => number;
export interface SurfaceLight { sky: number; block: number; ao: number }

/** Bilinear exposed-cell lighting, with occlusion separate from light intensity. */
export function sampleSurfaceVertexLight(
  read: LightCellReader,
  px: number, py: number, pz: number,
  nx: number, ny: number, nz: number,
  ox: number, oy: number, oz: number,
  out: SurfaceLight,
): SurfaceLight {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const axis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
  const normal = axis === 0 ? nx : axis === 1 ? ny : nz;
  const plane = Math.floor((axis === 0 ? px : axis === 1 ? py : pz) + Math.sign(normal) * 0.0001);
  const u = (axis === 0 ? py : px) - 0.5;
  const v = (axis === 2 ? py : pz) - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const a = axis === 0 ? read(plane, i, j) : axis === 1 ? read(i, plane, j) : read(i, j, plane);
  const b = axis === 0 ? read(plane, i + 1, j) : axis === 1 ? read(i + 1, plane, j) : read(i + 1, j, plane);
  const c = axis === 0 ? read(plane, i, j + 1) : axis === 1 ? read(i, plane, j + 1) : read(i, j + 1, plane);
  const d = axis === 0 ? read(plane, i + 1, j + 1) : axis === 1 ? read(i + 1, plane, j + 1) : read(i + 1, j + 1, plane);
  const anchor = ((axis === 0 ? oy : ox) > i ? 1 : 0) + ((axis === 2 ? oy : oz) > j ? 2 : 0);
  const mask = ((a & 256) ? 1 : 0) | ((b & 256) ? 2 : 0) | ((c & 256) ? 4 : 0) | ((d & 256) ? 8 : 0);
  // A diagonal behind two solid sides cannot leak light through a sealed corner.
  const blocked = (mask & (1 << (anchor ^ 1))) && (mask & (1 << (anchor ^ 2)))
    ? mask | (1 << (anchor ^ 3)) : mask;
  let weight = 0;
  let sky = 0;
  let block = 0;
  for (let corner = 0; corner < 4; corner += 1) {
    const w = ((corner & 1) ? fu : 1 - fu) * ((corner & 2) ? fv : 1 - fv);
    if (blocked & (1 << corner)) continue;
    const packed = corner === 0 ? a : corner === 1 ? b : corner === 2 ? c : d;
    weight += w;
    sky += (packed & 15) * w;
    block += ((packed >>> 4) & 15) * w;
  }
  out.sky = weight > 0 ? sky / weight : 0;
  out.block = weight > 0 ? block / weight : 0;
  out.ao = 0.8 + 0.2 * weight;
  return out;
}
