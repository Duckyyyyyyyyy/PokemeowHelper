import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The content script is a CLASSIC script (Chrome does not run manifest content scripts as
 * modules), so it must be one self-contained file with no `import`. It is built on its own,
 * as an IIFE, after the main build: code it shares with the panel is inlined, never split
 * into a shared chunk. scripts/check-content.mjs fails the build if an import slips in.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    lib: {
      entry: resolve(root, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'MeowHelperContent',
      fileName: () => 'content.js',
    },
  },
});
