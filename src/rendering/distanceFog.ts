import { CHUNK_SIZE } from '../core/constants';

/**
 * Furthest loaded corner for a square chunk radius.
 * Chunks cover `dx, dz ∈ [-r, r]`, so the far corner is one chunk past `r`,
 * then the diagonal of that square.
 */
export const MAX_VISIBLE_FOG_BLEND = 0.12;

export interface DistanceFogRange {
  readonly near: number;
  readonly far: number;
  readonly visibleEdge: number;
  readonly maxBlend: number;
}

export function visibleGeometryDistance(renderDistance: number): number {
  const radius = Number.isFinite(renderDistance) ? Math.max(0, renderDistance) : 0;
  return (radius + 1) * CHUNK_SIZE * Math.SQRT2;
}

/**
 * Linear fog that reaches `maxBlend` at the far chunk corner.
 * Near and far both grow with render distance. The old fixed near of 38 does not.
 */
export function distanceFogRange(
  renderDistance: number,
  maxBlend = MAX_VISIBLE_FOG_BLEND,
): DistanceFogRange {
  const visibleEdge = visibleGeometryDistance(renderDistance);
  const near = Math.max(24, visibleEdge * 0.55);
  const blend = Math.min(0.95, Math.max(0.01, maxBlend));
  const gap = visibleEdge - near;
  const far = gap > 0 ? near + gap / blend : near + 1;
  return { near, far, visibleEdge, maxBlend: blend };
}

/** Three.js linear fog factor, clamped to 0..1. */
export function linearFogBlend(distance: number, near: number, far: number): number {
  if (!(far > near)) return distance >= far ? 1 : 0;
  if (distance <= near) return 0;
  if (distance >= far) return 1;
  return (distance - near) / (far - near);
}

/** Writes both planes. A render-distance change must not leave the old near. */
export function applyDistanceFog(
  fog: { near: number; far: number },
  renderDistance: number,
): DistanceFogRange {
  const range = distanceFogRange(renderDistance);
  fog.near = range.near;
  fog.far = range.far;
  return range;
}
