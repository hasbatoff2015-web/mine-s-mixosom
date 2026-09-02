import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
