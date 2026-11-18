/// <reference types="vitest" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Builds the side panel page, the background service worker and the read-only content script.
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
        // Classic (non-module) content script: it must import nothing shared with the panel.
        content: resolve(root, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' || chunk.name === 'content' ? `${chunk.name}.js` : 'assets/[name]-[hash].js'),
      },
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
