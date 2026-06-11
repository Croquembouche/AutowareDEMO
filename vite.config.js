import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'static',
    sourcemap: true,
    chunkSizeWarningLimit: 700
  }
});
