/**
 * Content hashes for `player/skins/*.png`. Shared by the Vite virtual module and tests.
 * The running game never scans this directory; Vite inlines the map at dev/build time.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} skinsDir
 * @returns {Record<string, string>}
 */
export function readPlayerSkinContentHashes(skinsDir) {
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const name of readdirSync(skinsDir).sort()) {
    if (!name.endsWith('.png')) continue;
    const digest = createHash('sha256')
      .update(readFileSync(join(skinsDir, name)))
      .digest('hex')
      .slice(0, 16);
    hashes[`player/skins/${name.slice(0, -'.png'.length)}`] = digest;
  }
  return hashes;
}
