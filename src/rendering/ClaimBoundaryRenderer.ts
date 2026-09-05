import * as THREE from 'three';
import type { ServerClaimBoundaryMessage } from '../../shared/protocol';

const EDGE_COLOR = 0xff3b3b;

interface ClaimBoundaryVisual {
  claimId: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  expiresAt: number;
  lines: THREE.LineSegments;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
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

/**
 * Local-only red wireframe of a claim AABB. Server sends coordinates;
 * other players never receive this packet.
 */
export class ClaimBoundaryRenderer {
  private readonly visuals = new Map<string, ClaimBoundaryVisual>();

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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        claimBoundaryEdgePositions(
          message.minX,
          message.minY,
          message.minZ,
          message.maxX,
          message.maxY,
          message.maxZ,
        ),
        3,
      ),
    );
    const material = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = `claim-boundary:${message.claimId}`;
    lines.frustumCulled = false;
    lines.renderOrder = 22;
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
      material,
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
  }

  private disposeVisual(visual: ClaimBoundaryVisual): void {
    this.scene.remove(visual.lines);
    visual.geometry.dispose();
    visual.material.dispose();
  }
}
