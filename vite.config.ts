/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Builds the side panel page and the background service worker (the content script: vite.content.config.ts).
// public/ (manifest.json, icons) is copied as-is into dist/.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'sidepanel.html'),
        background: resolve(root, 'src/background/index.ts'),
        // The content script is built separately as one classic script: vite.content.config.ts.
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? `${chunk.name}.js` : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
