import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MINECRAFT_SKINS,
  PRODUCTION_PLAYER_SKINS,
  skinHasTranslucentOuterLayer,
} from '../src/rendering/player/MinecraftSkin';
import { scanProductionPlayerSkins } from '../scripts/validate-player-skin-alpha.mjs';

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

  it('classifies production alpha and keeps the runtime outer-material policy in sync', () => {
    const results = scanProductionPlayerSkins();
    expect(results.map((result) => result.skinId)).toEqual(PRODUCTION_PLAYER_SKINS.map((skin) => skin.id));
    expect(Object.fromEntries(
      results
        .filter((result) => result.hasIntermediateAlpha)
        .map((result) => [result.skinId, {
          base: result.baseIntermediatePixels,
          outer: result.outerIntermediatePixels,
          unused: result.unusedIntermediatePixels,
        }]),
    )).toEqual({
      '00f6338deb336a6e': { base: 0, outer: 5, unused: 0 },
      '0f15ad5e5c148f40': { base: 9, outer: 11, unused: 0 },
      '55264c2ebdb9ed9d': { base: 0, outer: 149, unused: 0 },
      '5bc8ad7edfb7ee86': { base: 0, outer: 1488, unused: 48 },
      'c026b7f8552098de': { base: 0, outer: 0, unused: 4 },
      'dce095dc5bddc925': { base: 0, outer: 0, unused: 27 },
      'dee6149d4583a54b': { base: 0, outer: 0, unused: 12 },
    });
    for (const result of results) {
      expect(result.hasBinaryAlpha, result.skinId).toBe(!result.hasIntermediateAlpha);
      expect(result.declaredOuterAlpha, result.skinId)
        .toBe(result.outerIntermediatePixels > 0 ? 'translucent' : 'binary');
      expect(skinHasTranslucentOuterLayer(result.skinId), result.skinId)
        .toBe(result.outerIntermediatePixels > 0);
    }
  });
});
