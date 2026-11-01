import { defineConfig } from 'vite';

export default defineConfig({
  root: 'admin-ui',
  base: '/admin/',
  publicDir: false,
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets',
    target: 'es2020',
  },
});
