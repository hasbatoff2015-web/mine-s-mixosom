import { defineConfig } from 'vite';
import { resolveViteDevServer } from './vite.devHost';

const viteDev = resolveViteDevServer();

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    host: viteDev.host,
    port: 4173,
    ...(viteDev.allowedHosts ? { allowedHosts: viteDev.allowedHosts } : {}),
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setupClientEntityHost.ts'],
  },
});
