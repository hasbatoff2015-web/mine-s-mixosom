/**
 * Compare generated outer-alpha metadata with the real pixels of each production skin.
 * The PNG decoder and UV masks live in `player-skin-png.mjs`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NPC_PLAYER_SKIN_ID, parseGeneratedPlayerSkinModule } from './generate-player-skins.mjs';
import { scanPlayerSkinAlpha } from './player-skin-png.mjs';

export { scanPlayerSkinAlpha } from './player-skin-png.mjs';

export function productionSkinDescriptors(projectRoot = process.cwd()) {
  const source = readFileSync(resolve(projectRoot, 'src/player/appearance/generatedPlayerSkins.ts'), 'utf8');
  return parseGeneratedPlayerSkinModule(source)
    .filter((skin) => skin.texturePath.startsWith('player/skins/') && skin.id !== NPC_PLAYER_SKIN_ID);
}

export function scanProductionPlayerSkins(projectRoot = process.cwd()) {
  return productionSkinDescriptors(projectRoot).map((skin) => ({
    skinId: skin.id,
    model: skin.defaultModel,
    declaredOuterAlpha: skin.outerLayerAlpha ?? 'binary',
    ...scanPlayerSkinAlpha(
      resolve(projectRoot, 'public', 'textures', `${skin.texturePath}.png`),
      skin.defaultModel,
    ),
  }));
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryUrl) {
  const results = scanProductionPlayerSkins();
  console.table(results);
  const mismatches = results.filter((skin) => (
    skin.declaredOuterAlpha === 'translucent'
  ) !== (skin.outerIntermediatePixels > 0));
  if (mismatches.length > 0) {
    console.error('Player skin outer-alpha metadata does not match PNG contents:', mismatches.map((skin) => skin.skinId));
    process.exitCode = 1;
  }
}
