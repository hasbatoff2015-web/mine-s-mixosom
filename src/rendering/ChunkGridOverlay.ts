import * as THREE from 'three';
import { CHUNK_SIZE } from '../core/constants';
import { CATEGORY_COLORS, type ChunkDebugCategory } from '../debug/chunkStreamingInspector';

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function pushRectangle(
  positions: number[],
  colors: number[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  hex: number,
): void {
  const [r, g, b] = hexToRgb(hex);
  const segs: Array<[number, number, number, number]> = [
    [x0, z0, x1, z0],
    [x1, z0, x1, z1],
    [x1, z1, x0, z1],
    [x0, z1, x0, z0],
  ];
  for (const [sx, sz, ex, ez] of segs) {
    positions.push(sx, y, sz, ex, y, ez);
    colors.push(r, g, b, r, g, b);
  }
}

/** DEV-only 16×16 X/Z chunk tiles, colored by streaming state. */
export class ChunkGridOverlay {
  readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly highlights: THREE.LineSegments;
  private lastLayout = '';
  private lastColor = '';
  private cells: Array<{ cx: number; cz: number }> = [];

  constructor() {
    this.group.name = 'chunk-grid-overlay';
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.78,
        depthTest: false,
      }),
    );
    this.highlights = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthTest: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.highlights.frustumCulled = false;
    this.lines.renderOrder = 40;
    this.highlights.renderOrder = 41;
    this.group.add(this.lines, this.highlights);
    this.group.visible = false;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (!visible) {
      this.lastLayout = '';
      this.lastColor = '';
    }
  }

  update(
    centerX: number,
    centerY: number,
    centerZ: number,
    chunkRadius: number,
    options: {
      colorAt?: (cx: number, cz: number) => number;
      highlights?: ReadonlyArray<{ cx: number; cz: number; color: number }>;
      colorRevision?: number;
    } = {},
  ): void {
    if (!this.group.visible) return;
    const cx = Math.floor(centerX / CHUNK_SIZE);
    const cz = Math.floor(centerZ / CHUNK_SIZE);
    const y = Math.floor(centerY) + 0.08;
    const layout = `${cx},${cz},${y},${chunkRadius}`;
    const colorKey = `${layout}:${options.colorRevision ?? 0}:${(options.highlights ?? []).map((item) => `${item.cx},${item.cz}`).join(';')}`;
    if (layout !== this.lastLayout) {
      this.rebuildLayout(cx, cz, y, chunkRadius, options.colorAt);
      this.lastLayout = layout;
      this.lastColor = '';
    }
    if (colorKey !== this.lastColor) {
      this.recolor(options.colorAt, y, options.highlights);
      this.lastColor = colorKey;
    }
  }

  private rebuildLayout(
    cx: number,
    cz: number,
    y: number,
    chunkRadius: number,
    colorAt?: (cx: number, cz: number) => number,
  ): void {
    const positions: number[] = [];
    const colors: number[] = [];
    this.cells = [];
    for (let dz = -chunkRadius; dz <= chunkRadius; dz += 1) {
      for (let dx = -chunkRadius; dx <= chunkRadius; dx += 1) {
        const tileX = cx + dx;
        const tileZ = cz + dz;
        this.cells.push({ cx: tileX, cz: tileZ });
        const hex = colorAt?.(tileX, tileZ) ?? CATEGORY_COLORS.visible;
        pushRectangle(
          positions,
          colors,
          tileX * CHUNK_SIZE,
          tileZ * CHUNK_SIZE,
          (tileX + 1) * CHUNK_SIZE,
          (tileZ + 1) * CHUNK_SIZE,
          y,
          hex,
        );
      }
    }
    this.lines.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.lines.geometry = geometry;
  }

  private recolor(
    colorAt: ((cx: number, cz: number) => number) | undefined,
    y: number,
    highlights?: ReadonlyArray<{ cx: number; cz: number; color: number }>,
  ): void {
    const colorAttr = this.lines.geometry.getAttribute('color');
    if (colorAttr && colorAt) {
      let offset = 0;
      for (const cell of this.cells) {
        const [r, g, b] = hexToRgb(colorAt(cell.cx, cell.cz));
        for (let i = 0; i < 8; i += 1) {
          colorAttr.setXYZ(offset + i, r, g, b);
        }
        offset += 8;
      }
      colorAttr.needsUpdate = true;
    }
    const positions: number[] = [];
    const colors: number[] = [];
    for (const item of highlights ?? []) {
      const pad = 0.12;
      pushRectangle(
        positions,
        colors,
        item.cx * CHUNK_SIZE + pad,
        item.cz * CHUNK_SIZE + pad,
        (item.cx + 1) * CHUNK_SIZE - pad,
        (item.cz + 1) * CHUNK_SIZE - pad,
        y + 0.02,
        item.color,
      );
    }
    this.highlights.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    if (positions.length > 0) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    this.highlights.geometry = geometry;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.highlights.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    (this.highlights.material as THREE.Material).dispose();
  }
}

export function overlayHex(category: ChunkDebugCategory): number {
  return CATEGORY_COLORS[category];
}
