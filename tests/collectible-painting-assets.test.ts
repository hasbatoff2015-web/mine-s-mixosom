import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLLECTIBLE_PAINTING_IDS, collectiblePaintingTexture, getItemDefinition } from '../src/items';

const DIRECTORY = join(process.cwd(), 'public/textures/painting/collectibles');

function pngInfo(file: string): { width: number; height: number; bitDepth: number; colorType: number } {
  const buffer = readFileSync(file);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(buffer.toString('ascii', 12, 16)).toBe('IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24] ?? 0,
    colorType: buffer[25] ?? 0,
  };
}

describe('collectible painting assets', () => {
  it('keeps the twenty committed files square and free of a doubled extension', () => {
    const files = readdirSync(DIRECTORY).filter((name) => !name.startsWith('.'));
    expect(files).toHaveLength(20);
    expect(files.some((name) => name.includes('.png.png'))).toBe(false);
    expect(new Set(files)).toEqual(new Set(COLLECTIBLE_PAINTING_IDS.map((id) => `${id}.png`)));
    for (const id of COLLECTIBLE_PAINTING_IDS) {
      const info = pngInfo(join(DIRECTORY, `${id}.png`));
      expect(info.width).toBe(64);
      expect(info.height).toBe(64);
      expect(info.bitDepth).toBe(8);
      expect(info.colorType).toBe(2);
      expect(readFileSync(join(DIRECTORY, `${id}.png`)).byteLength).toBeLessThan(256 * 1024);
      expect(getItemDefinition(id).texture).toBe(collectiblePaintingTexture(id));
    }
  });
});
