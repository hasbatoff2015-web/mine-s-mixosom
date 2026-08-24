/** One vertical fire plane in world/cell space. */
export interface FirePlane {
  readonly corners: readonly (readonly [number, number, number])[];
}

const EDGE = 0.04;
const TAPER = 0.07;
const OUTER_HEIGHT = 1.02;
const INNER_HEIGHT = 1.22;
const INNER_INSET = 0.14;

function plane(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y: number,
  height: number,
  taper: number,
): FirePlane {
  const mx = (ax + bx) * 0.5;
  const mz = (az + bz) * 0.5;
  const topA: readonly [number, number, number] = [
    ax + (mx - ax) * taper,
    y + height,
    az + (mz - az) * taper,
  ];
  const topB: readonly [number, number, number] = [
    bx + (mx - bx) * taper,
    y + height,
    bz + (mz - bz) * taper,
  ];
  return {
    corners: [
      [ax, y, az],
      [bx, y, bz],
      topB,
      topA,
    ],
  };
}

/**
 * Minecraft-style fire: 4 vertical planes on the cell edges and 2 inner
 * diagonals as an X. Tops taper inward so the silhouette reads as flames,
 * not a cube.
 */
export function fireBlockPlanes(x = 0, y = 0, z = 0): readonly FirePlane[] {
  const x0 = x + EDGE;
  const x1 = x + 1 - EDGE;
  const z0 = z + EDGE;
  const z1 = z + 1 - EDGE;
  const ix0 = x + INNER_INSET;
  const ix1 = x + 1 - INNER_INSET;
  const iz0 = z + INNER_INSET;
  const iz1 = z + 1 - INNER_INSET;
  return [
    plane(x0, z0, x0, z1, y, OUTER_HEIGHT, TAPER),
    plane(x1, z0, x1, z1, y, OUTER_HEIGHT, TAPER),
    plane(x0, z0, x1, z0, y, OUTER_HEIGHT, TAPER),
    plane(x0, z1, x1, z1, y, OUTER_HEIGHT, TAPER),
    plane(ix0, iz0, ix1, iz1, y, INNER_HEIGHT, TAPER * 1.15),
    plane(ix1, iz0, ix0, iz1, y, INNER_HEIGHT, TAPER * 1.15),
  ];
}

export const FIRE_PLANE_COUNT = 6;
