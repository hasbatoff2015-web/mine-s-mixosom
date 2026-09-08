import type { PlayerModelVariant } from '../../player/appearance/PlayerAppearance';

export interface SkinPortraitSource {
  readonly width: number;
  readonly height: number;
  readonly data: ArrayLike<number>;
}

export interface SkinPortraitPixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

function pixel(source: SkinPortraitSource, x: number, y: number): [number, number, number, number] {
  const index = (y * source.width + x) * 4;
  return [
    source.data[index] ?? 0,
    source.data[index + 1] ?? 0,
    source.data[index + 2] ?? 0,
    source.data[index + 3] ?? 0,
  ];
}

function blit(
  target: Uint8ClampedArray,
  size: number,
  dx: number,
  dy: number,
  source: SkinPortraitSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  scale: number,
): void {
  for (let y = 0; y < sh * scale; y += 1) {
    for (let x = 0; x < sw * scale; x += 1) {
      const [r, g, b, a] = pixel(source, sx + Math.floor(x / scale), sy + Math.floor(y / scale));
      if (a < 8) continue;
      const tx = dx + x;
      const ty = dy + y;
      const index = (ty * size + tx) * 4;
      target[index] = r;
      target[index + 1] = g;
      target[index + 2] = b;
      target[index + 3] = 255;
    }
  }
}

function layout(model: PlayerModelVariant, size: number): {
  scale: number;
  originX: number;
  originY: number;
  arm: number;
} {
  const scale = Math.max(1, Math.floor(size / 16));
  return {
    scale,
    originX: Math.floor((size - 16 * scale) / 2),
    originY: Math.floor((size - 16 * scale) / 2),
    arm: model === 'slim' ? 3 : 4,
  };
}

/** Front-view 2D portrait from a 64×64 Java skin. Thumbnail only; 3D preview still uses PlayerVisual. */
export function paintSkinPortrait(
  source: SkinPortraitSource,
  model: PlayerModelVariant = 'classic',
  size = 64,
): SkinPortraitPixels {
  const data = new Uint8ClampedArray(size * size * 4);
  const { scale, originX, originY, arm } = layout(model, size);
  blit(data, size, originX + 4 * scale, originY, source, 8, 8, 8, 8, scale);
  blit(data, size, originX + 4 * scale, originY, source, 40, 8, 8, 8, scale);
  blit(data, size, originX + 4 * scale, originY + 8 * scale, source, 20, 20, 8, 8, scale);
  blit(data, size, originX + (4 - arm) * scale, originY + 8 * scale, source, 44, 20, arm, 8, scale);
  blit(data, size, originX + 12 * scale, originY + 8 * scale, source, 36, 52, arm, 8, scale);
  return { data, width: size, height: size };
}

export function drawSkinPortrait(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  model: PlayerModelVariant = 'classic',
  size = 64,
): void {
  context.clearRect(0, 0, size, size);
  const { scale, originX, originY, arm } = layout(model, size);
  const draw = (dx: number, dy: number, sx: number, sy: number, sw: number, sh: number): void => {
    context.imageSmoothingEnabled = false;
    context.drawImage(image, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
  };
  draw(originX + 4 * scale, originY, 8, 8, 8, 8);
  draw(originX + 4 * scale, originY, 40, 8, 8, 8);
  draw(originX + 4 * scale, originY + 8 * scale, 20, 20, 8, 8);
  draw(originX + (4 - arm) * scale, originY + 8 * scale, 44, 20, arm, 8);
  draw(originX + 12 * scale, originY + 8 * scale, 36, 52, arm, 8);
}
