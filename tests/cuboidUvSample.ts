import * as THREE from 'three';
import { expect } from 'vitest';

export type VerticalEdge = 'top' | 'bottom';
export type DepthEdge = 'front' | 'back';

function attribute(geometry: THREE.BufferGeometry, name: 'position' | 'normal' | 'uv'): THREE.BufferAttribute {
  const value = geometry.getAttribute(name);
  expect(value).toBeInstanceOf(THREE.BufferAttribute);
  return value as THREE.BufferAttribute;
}

/** U and V of the side-face corner at a front/back and top/bottom extreme. */
export function sideEdgeUv(
  geometry: THREE.BufferGeometry,
  normalX: -1 | 1,
  zEdge: DepthEdge,
  yEdge: VerticalEdge,
): readonly [number, number] {
  const position = attribute(geometry, 'position');
  const normal = attribute(geometry, 'normal');
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = 0;
  for (let index = 0; index < position.count; index += 1) {
    if (normal.getX(index) !== normalX) continue;
    seen += 1;
    minZ = Math.min(minZ, position.getZ(index));
    maxZ = Math.max(maxZ, position.getZ(index));
    minY = Math.min(minY, position.getY(index));
    maxY = Math.max(maxY, position.getY(index));
  }
  expect(seen).toBe(4);
  const z = zEdge === 'front' ? minZ : maxZ;
  const y = yEdge === 'bottom' ? minY : maxY;
  const uv = attribute(geometry, 'uv');
  const matches: Array<readonly [number, number]> = [];
  for (let index = 0; index < position.count; index += 1) {
    if (normal.getX(index) !== normalX) continue;
    if (Math.abs(position.getZ(index) - z) > 1e-5) continue;
    if (Math.abs(position.getY(index) - y) > 1e-5) continue;
    matches.push([uv.getX(index), uv.getY(index)]);
  }
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

export function sideEdgeU(
  geometry: THREE.BufferGeometry,
  normalX: -1 | 1,
  zEdge: DepthEdge,
  yEdge: VerticalEdge,
): number {
  return sideEdgeUv(geometry, normalX, zEdge, yEdge)[0];
}

/** U on the model-front face (normal −Z) at a horizontal and vertical extreme. */
export function frontEdgeU(
  geometry: THREE.BufferGeometry,
  xEdge: 'min' | 'max',
  yEdge: VerticalEdge,
): number {
  const position = attribute(geometry, 'position');
  const normal = attribute(geometry, 'normal');
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    if (normal.getZ(index) !== -1) continue;
    minX = Math.min(minX, position.getX(index));
    maxX = Math.max(maxX, position.getX(index));
    minY = Math.min(minY, position.getY(index));
    maxY = Math.max(maxY, position.getY(index));
  }
  const x = xEdge === 'min' ? minX : maxX;
  const y = yEdge === 'bottom' ? minY : maxY;
  const uv = attribute(geometry, 'uv');
  const matches: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    if (normal.getZ(index) !== -1) continue;
    if (Math.abs(position.getX(index) - x) > 1e-5) continue;
    if (Math.abs(position.getY(index) - y) > 1e-5) continue;
    matches.push(uv.getX(index));
  }
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

export function axisSpan(geometry: THREE.BufferGeometry, axis: 'x' | 'y' | 'z'): number {
  const position = attribute(geometry, 'position');
  const read = axis === 'x' ? (index: number) => position.getX(index)
    : axis === 'y' ? (index: number) => position.getY(index)
      : (index: number) => position.getZ(index);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < position.count; index += 1) {
    const value = read(index);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return max - min;
}
