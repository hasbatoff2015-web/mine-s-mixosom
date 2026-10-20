import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { generatePlayerSkinCatalog } from './scripts/generate-player-skins.mjs';
import { readPlayerSkinContentHashes } from './scripts/player-skin-content-hashes.mjs';

const PLAYER_SKIN_PUBLIC_DIR = resolve('public/textures/player/skins');
const PLAYER_SKIN_OVERRIDES = resolve('src/player/appearance/playerSkinModelOverrides.json');
const PLAYER_SKIN_HASH_MODULE = 'virtual:player-skin-content-hashes';
const PLAYER_SKIN_HASH_MODULE_RESOLVED = `\0${PLAYER_SKIN_HASH_MODULE}`;

/** First 16 hex chars of sha256 for each `public/textures/player/skins/*.png`. */
function playerSkinContentHashes(): Record<string, string> {
  return readPlayerSkinContentHashes(PLAYER_SKIN_PUBLIC_DIR);
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
    buildStart() {
      generatePlayerSkinCatalog();
    },
    configureServer(server) {
      generatePlayerSkinCatalog();
      server.watcher.add(PLAYER_SKIN_PUBLIC_DIR);
      server.watcher.add(PLAYER_SKIN_OVERRIDES);
    },
    handleHotUpdate(ctx) {
      const isSkinPng = ctx.file.startsWith(PLAYER_SKIN_PUBLIC_DIR) && ctx.file.endsWith('.png');
      const isOverride = ctx.file === PLAYER_SKIN_OVERRIDES;
      if (!isSkinPng && !isOverride) return;
      generatePlayerSkinCatalog();
      if (isSkinPng) {
        const mod = ctx.server.moduleGraph.getModuleById(PLAYER_SKIN_HASH_MODULE_RESOLVED);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      }
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

function moveItemsDevRoutePlugin(): Plugin {
  return {
    name: 'moveitems-dev-route',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path === '/moveitems' || path === '/moveitems/') {
          req.url = req.url?.replace(/^\/moveitems\/?/, '/index.html') ?? '/index.html';
        }
        next();
      });
    },
  };
}

// `vite build` loads `.env.production` (`VITE_ANARCHY_URL`). `npm run dev` does not.
export default defineConfig({
  base: './',
  plugins: [playerSkinHashPlugin(), moveItemsDevRoutePlugin()],
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
