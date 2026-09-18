import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const PLAYER_SKIN_PUBLIC_DIR = resolve('public/textures/player/skins');
const PLAYER_SKIN_HASH_MODULE = 'virtual:player-skin-content-hashes';
const PLAYER_SKIN_HASH_MODULE_RESOLVED = `\0${PLAYER_SKIN_HASH_MODULE}`;

/** First 16 hex chars of sha256 for each `public/textures/player/skins/*.png`. */
function playerSkinContentHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of readdirSync(PLAYER_SKIN_PUBLIC_DIR).sort()) {
    if (!name.endsWith('.png')) continue;
    const digest = createHash('sha256')
      .update(readFileSync(join(PLAYER_SKIN_PUBLIC_DIR, name)))
      .digest('hex')
      .slice(0, 16);
    hashes[`player/skins/${name.slice(0, -'.png'.length)}`] = digest;
  }
  return hashes;
}

function playerSkinHashPlugin(): Plugin {
  return {
    name: 'player-skin-content-hashes',
    resolveId(id) {
      if (id === PLAYER_SKIN_HASH_MODULE) return PLAYER_SKIN_HASH_MODULE_RESOLVED;
    },
    load(id) {
      if (id !== PLAYER_SKIN_HASH_MODULE_RESOLVED) return;
      return `export default ${JSON.stringify(playerSkinContentHashes())};`;
    },
    configureServer(server) {
      server.watcher.add(PLAYER_SKIN_PUBLIC_DIR);
    },
    handleHotUpdate(ctx) {
      if (!ctx.file.startsWith(PLAYER_SKIN_PUBLIC_DIR) || !ctx.file.endsWith('.png')) return;
      const mod = ctx.server.moduleGraph.getModuleById(PLAYER_SKIN_HASH_MODULE_RESOLVED);
      if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [playerSkinHashPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    host: true,
    port: 4173,
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setupClientEntityHost.ts'],
  },
});
