import * as THREE from 'three';
import { CHUNK_SIZE } from '../core/constants';

/** DEV-only 16×16 X/Z chunk grid. Not a production control. */
export class ChunkGridOverlay {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private lastKey = '';

  constructor() {
    this.group.name = 'chunk-grid-overlay';
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xffee55,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 40;
    this.group.add(this.lines);
    this.group.visible = false;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) this.lastKey = '';
  }

  update(centerX: number, centerY: number, centerZ: number, chunkRadius: number): void {
    if (!this.group.visible) return;
    const cx = Math.floor(centerX / CHUNK_SIZE);
    const cz = Math.floor(centerZ / CHUNK_SIZE);
    const y = Math.floor(centerY) + 0.08;
    const key = `${cx},${cz},${y},${chunkRadius}`;
    if (key === this.lastKey) {
      this.group.position.set(0, 0, 0);
      return;
    }
    this.lastKey = key;
    const positions: number[] = [];
    const minChunkX = cx - chunkRadius;
    const maxChunkX = cx + chunkRadius + 1;
    const minChunkZ = cz - chunkRadius;
    const maxChunkZ = cz + chunkRadius + 1;
    const x0 = minChunkX * CHUNK_SIZE;
    const x1 = maxChunkX * CHUNK_SIZE;
    const z0 = minChunkZ * CHUNK_SIZE;
    const z1 = maxChunkZ * CHUNK_SIZE;
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      const x = chunkX * CHUNK_SIZE;
      positions.push(x, y, z0, x, y, z1);
    }
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      const z = chunkZ * CHUNK_SIZE;
      positions.push(x0, y, z, x1, y, z);
    }
    this.lines.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.lines.geometry = geometry;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
