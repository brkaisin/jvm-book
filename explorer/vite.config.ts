import { defineConfig } from 'vite';

// The explorer is built straight into the book's source tree, so mdBook
// copies it verbatim and serves it at <site>/explorer/.
export default defineConfig({
  base: './',
  build: {
    outDir: '../docs/explorer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
