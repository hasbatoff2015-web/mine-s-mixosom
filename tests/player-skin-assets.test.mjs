import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MINECRAFT_SKINS } from '../src/rendering/player/MinecraftSkin';

function pngDimensions(path) {
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('bundled player skin assets', () => {
  it('keeps all 45 unique supplied skins plus the QA sheet at exact Java 64x64 dimensions', () => {
    expect(BUILTIN_MINECRAFT_SKINS).toHaveLength(46);
    for (const skin of BUILTIN_MINECRAFT_SKINS) {
      const path = resolve('public', 'textures', `${skin.texturePath}.png`);
      expect(pngDimensions(path), skin.id).toEqual([64, 64]);
      expect(skin.texturePath).not.toMatch(/[\s\\]/);
    }
  });
});
