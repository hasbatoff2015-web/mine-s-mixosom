import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { ServerClaimBoundaryMessage } from '../../shared/protocol';

const EDGE_COLOR = 0xff0000;
/** Screen-space CSS pixels. LineBasicMaterial cannot do this in WebGL. */
const EDGE_WIDTH_PX = 6;

interface ClaimBoundaryVisual {
  claimId: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  expiresAt: number;
  lines: LineSegments2;
  geometry: LineSegmentsGeometry;
}

function sameVolume(visual: ClaimBoundaryVisual, message: ServerClaimBoundaryMessage): boolean {
  return visual.minX === message.minX
    && visual.minY === message.minY
    && visual.minZ === message.minZ
    && visual.maxX === message.maxX
    && visual.maxY === message.maxY
    && visual.maxZ === message.maxZ;
}

/** Inclusive block AABB occupies world space [min, max+1]. 12 cube edges. */
export function claimBoundaryEdgePositions(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Float32Array {
  const x0 = minX;
  const y0 = minY;
  const z0 = minZ;
  const x1 = maxX + 1;
  const y1 = maxY + 1;
  const z1 = maxZ + 1;
  return new Float32Array([
    x0, y0, z0, x1, y0, z0,
    x1, y0, z0, x1, y0, z1,
    x1, y0, z1, x0, y0, z1,
    x0, y0, z1, x0, y0, z0,
    x0, y1, z0, x1, y1, z0,
    x1, y1, z0, x1, y1, z1,
    x1, y1, z1, x0, y1, z1,
    x0, y1, z1, x0, y1, z0,
    x0, y0, z0, x0, y1, z0,
    x1, y0, z0, x1, y1, z0,
    x1, y0, z1, x1, y1, z1,
    x0, y0, z1, x0, y1, z1,
  ]);
}

function createBoundaryMaterial(): LineMaterial {
  const material = new LineMaterial({
    linewidth: EDGE_WIDTH_PX,
    worldUnits: false,
    dashed: false,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    transparent: false,
  });
  material.color.setHex(EDGE_COLOR);
  return material;
}

/**
 * Local-only red wireframe of a claim AABB. Server sends coordinates;
 * other players never receive this packet.
 */
export class ClaimBoundaryRenderer {
  private readonly visuals = new Map<string, ClaimBoundaryVisual>();
  private readonly material = createBoundaryMaterial();

  constructor(private readonly scene: THREE.Scene) {}

  show(message: ServerClaimBoundaryMessage, now = performance.now()): void {
    const duration = Math.max(1_000, Math.min(30_000, message.durationMs));
    const expiresAt = now + duration;
    const existing = this.visuals.get(message.claimId);
    if (existing && sameVolume(existing, message)) {
      existing.expiresAt = expiresAt;
      existing.lines.visible = true;
      return;
    }
    if (existing) this.disposeVisual(existing);

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(
      claimBoundaryEdgePositions(
        message.minX,
        message.minY,
        message.minZ,
        message.maxX,
        message.maxY,
        message.maxZ,
      ),
    );
    const lines = new LineSegments2(geometry, this.material);
    lines.name = `claim-boundary:${message.claimId}`;
    lines.frustumCulled = false;
    lines.renderOrder = 50;
    this.scene.add(lines);
    this.visuals.set(message.claimId, {
      claimId: message.claimId,
      minX: message.minX,
      minY: message.minY,
      minZ: message.minZ,
      maxX: message.maxX,
      maxY: message.maxY,
      maxZ: message.maxZ,
      expiresAt,
      lines,
      geometry,
    });
  }

  update(now = performance.now()): void {
    for (const [claimId, visual] of this.visuals) {
      if (now < visual.expiresAt) continue;
      this.disposeVisual(visual);
      this.visuals.delete(claimId);
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) this.disposeVisual(visual);
    this.visuals.clear();
    this.material.dispose();
  }

  private disposeVisual(visual: ClaimBoundaryVisual): void {
    this.scene.remove(visual.lines);
    visual.geometry.dispose();
  }
}
