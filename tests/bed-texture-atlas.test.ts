import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BED_SHEET_KEY, BED_SHEET_SIZE, SIGN_SHEET_HEIGHT, SIGN_SHEET_KEY, SIGN_SHEET_WIDTH, TextureAtlas,
} from '../src/rendering/TextureAtlas';

afterEach(() => vi.unstubAllGlobals());

describe('entity sheet atlas registration', () => {
  it('loads the actual bed and sign sheets without cropping either to a block tile', async () => {
    const png = readFileSync(new URL('../public/textures/entity/bed/white.png', import.meta.url));
    expect(png.readUInt32BE(16)).toBe(BED_SHEET_SIZE);
    expect(png.readUInt32BE(20)).toBe(BED_SHEET_SIZE);
    const signPng = readFileSync(new URL('../public/textures/entity/sign.png', import.meta.url));
    expect(signPng.readUInt32BE(16)).toBe(SIGN_SHEET_WIDTH);
    expect(signPng.readUInt32BE(20)).toBe(SIGN_SHEET_HEIGHT);

    const draws: Array<{ source: string; args: unknown[] }> = [];
    const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
    const context = {
      canvas,
      imageSmoothingEnabled: true,
      fillStyle: '',
      drawImage(source: { src?: string }, ...args: unknown[]) {
        if (source.src) draws.push({ source: source.src, args });
      },
      fillRect() {},
      clearRect() {},
    };
    canvas.getContext = (() => context as unknown as CanvasRenderingContext2D) as unknown as HTMLCanvasElement['getContext'];
    vi.stubGlobal('document', { createElement: () => canvas });
    class FakeImage {
      naturalWidth = 32;
      naturalHeight = 32;
      decoding = 'async';
      onload?: () => void;
      onerror?: () => void;
      private path = '';
      get src() { return this.path; }
      set src(value: string) {
        this.path = value;
        if (value.endsWith('/entity/bed/white.png')) {
          this.naturalWidth = BED_SHEET_SIZE;
          this.naturalHeight = BED_SHEET_SIZE;
        } else if (value.endsWith('/entity/sign.png')) {
          this.naturalWidth = SIGN_SHEET_WIDTH;
          this.naturalHeight = SIGN_SHEET_HEIGHT;
        }
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);

    const atlas = await TextureAtlas.create();
    const draw = draws.find((entry) => entry.source.endsWith('/entity/bed/white.png'));
    expect(draw).toBeDefined();
    expect(draw!.args).toHaveLength(2); // Full-resolution drawImage(image, x, y).
    const bed = atlas.tile(BED_SHEET_KEY);
    const fallback = atlas.tile('block/missing');
    expect(bed).not.toEqual(fallback);
    expect((bed.u1 - bed.u0) * canvas.width).toBe(BED_SHEET_SIZE);
    expect((bed.v1 - bed.v0) * canvas.height).toBe(BED_SHEET_SIZE);
    const signDraw = draws.find((entry) => entry.source.endsWith('/entity/sign.png'));
    expect(signDraw?.args).toHaveLength(2);
    const sign = atlas.tile(SIGN_SHEET_KEY);
    expect(sign).not.toEqual(fallback);
    expect((sign.u1 - sign.u0) * canvas.width).toBe(SIGN_SHEET_WIDTH);
    expect((sign.v1 - sign.v0) * canvas.height).toBe(SIGN_SHEET_HEIGHT);
    expect(sign.v1).toBeLessThan(bed.v0); // Separate, guttered source regions.
    atlas.dispose();
  });
});
