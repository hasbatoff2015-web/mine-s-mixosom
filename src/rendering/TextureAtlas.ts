import * as THREE from 'three';
import { BLOCKS } from '../blocks';

export interface AtlasTile {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const FALLBACK_KEY = 'block/missing';
export const ATLAS_TILE_SIZE = 32;
export const ATLAS_GUTTER = 4;
export const ATLAS_COLUMNS = 8;

export interface AtlasLayout {
  readonly tileSize: number;
  readonly gutter: number;
  readonly cellSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
}

const nextPowerOfTwo = (value: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

export function calculateAtlasLayout(tileCount: number): AtlasLayout {
  const rows = Math.max(1, Math.ceil(tileCount / ATLAS_COLUMNS));
  const cellSize = ATLAS_TILE_SIZE + ATLAS_GUTTER * 2;
  return {
    tileSize: ATLAS_TILE_SIZE,
    gutter: ATLAS_GUTTER,
    cellSize,
    columns: ATLAS_COLUMNS,
    rows,
    width: nextPowerOfTwo(ATLAS_COLUMNS * cellSize),
    height: nextPowerOfTwo(rows * cellSize),
  };
}

export class TextureAtlas {
  readonly tiles = new Map<string, AtlasTile>();
  readonly texture: THREE.CanvasTexture;
  private constructor(canvas: HTMLCanvasElement, anisotropy: number) {
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    // Nearest within each level keeps pixel art crisp; linear blending between
    // adjacent mip levels is visibly steadier than hard nearest-mip transitions.
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = Math.max(1, anisotropy);
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  static async create(anisotropy = 1): Promise<TextureAtlas> {
    const keys = new Set<string>([FALLBACK_KEY]);
    for (const block of BLOCKS) {
      for (const texture of Object.values(block.textures)) if (texture) keys.add(texture);
    }
    const ordered = [...keys].sort();
    const layout = calculateAtlasLayout(ordered.length);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext('2d', { alpha: true })!;
    context.imageSmoothingEnabled = false;
    const atlas = new TextureAtlas(canvas, anisotropy);

    for (let index = 0; index < ordered.length; index += 1) {
      const key = ordered[index]!;
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const cellX = column * layout.cellSize;
      const cellY = row * layout.cellSize;
      const x = cellX + layout.gutter;
      const y = cellY + layout.gutter;
      if (key === FALLBACK_KEY || key === 'block/air') TextureAtlas.drawPlaceholder(context, x, y, layout.tileSize, key === 'block/air');
      else {
        try {
          const image = await TextureAtlas.loadImage(TextureAtlas.url(key));
          const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
          context.drawImage(image, 0, 0, sourceSize, sourceSize, x, y, layout.tileSize, layout.tileSize);
        } catch {
          TextureAtlas.drawPlaceholder(context, x, y, layout.tileSize, false);
        }
      }
      TextureAtlas.extrudeTile(context, x, y, layout.tileSize, layout.gutter);
      atlas.tiles.set(key, {
        u0: x / canvas.width,
        u1: (x + layout.tileSize) / canvas.width,
        v0: 1 - (y + layout.tileSize) / canvas.height,
        v1: 1 - y / canvas.height,
      });
    }
    atlas.texture.needsUpdate = true;
    return atlas;
  }

  tile(key: string): AtlasTile {
    return this.tiles.get(key) ?? this.tiles.get(FALLBACK_KEY)!;
  }

  dispose(): void {
    this.texture.dispose();
  }

  static url(textureKey: string): string {
    return `${import.meta.env.BASE_URL}textures/${textureKey}.png`;
  }

  private static loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load ${url}`));
      image.src = url;
    });
  }

  private static drawPlaceholder(context: CanvasRenderingContext2D, x: number, y: number, size: number, transparent: boolean): void {
    if (transparent) {
      context.clearRect(x, y, size, size);
      return;
    }
    context.fillStyle = '#d332ce';
    context.fillRect(x, y, size, size);
    context.fillStyle = '#161419';
    context.fillRect(x, y, size / 2, size / 2);
    context.fillRect(x + size / 2, y + size / 2, size / 2, size / 2);
  }

  private static extrudeTile(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    gutter: number,
  ): void {
    if (gutter <= 0) return;
    context.drawImage(context.canvas, x, y, size, 1, x, y - gutter, size, gutter);
    context.drawImage(context.canvas, x, y + size - 1, size, 1, x, y + size, size, gutter);
    context.drawImage(context.canvas, x, y, 1, size, x - gutter, y, gutter, size);
    context.drawImage(context.canvas, x + size - 1, y, 1, size, x + size, y, gutter, size);
    context.drawImage(context.canvas, x, y, 1, 1, x - gutter, y - gutter, gutter, gutter);
    context.drawImage(context.canvas, x + size - 1, y, 1, 1, x + size, y - gutter, gutter, gutter);
    context.drawImage(context.canvas, x, y + size - 1, 1, 1, x - gutter, y + size, gutter, gutter);
    context.drawImage(context.canvas, x + size - 1, y + size - 1, 1, 1, x + size, y + size, gutter, gutter);
  }
}
