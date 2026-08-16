import * as THREE from 'three';
import { BLOCKS } from '../blocks';

export interface AtlasTile {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const FALLBACK_KEY = 'block/missing';

export class TextureAtlas {
  readonly tiles = new Map<string, AtlasTile>();
  readonly texture: THREE.CanvasTexture;
  private constructor(canvas: HTMLCanvasElement) {
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  static async create(): Promise<TextureAtlas> {
    const keys = new Set<string>([FALLBACK_KEY]);
    for (const block of BLOCKS) {
      for (const texture of Object.values(block.textures)) if (texture) keys.add(texture);
    }
    const ordered = [...keys].sort();
    const tileSize = 32;
    const columns = 8;
    const rows = Math.ceil(ordered.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = columns * tileSize;
    canvas.height = rows * tileSize;
    const context = canvas.getContext('2d', { alpha: true })!;
    context.imageSmoothingEnabled = false;
    const atlas = new TextureAtlas(canvas);

    for (let index = 0; index < ordered.length; index += 1) {
      const key = ordered[index]!;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * tileSize;
      const y = row * tileSize;
      if (key === FALLBACK_KEY || key === 'block/air') TextureAtlas.drawPlaceholder(context, x, y, tileSize, key === 'block/air');
      else {
        try {
          const image = await TextureAtlas.loadImage(TextureAtlas.url(key));
          const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
          context.drawImage(image, 0, 0, sourceSize, sourceSize, x, y, tileSize, tileSize);
        } catch {
          TextureAtlas.drawPlaceholder(context, x, y, tileSize, false);
        }
      }
      atlas.tiles.set(key, {
        u0: x / canvas.width,
        u1: (x + tileSize) / canvas.width,
        v0: 1 - (y + tileSize) / canvas.height,
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
}
