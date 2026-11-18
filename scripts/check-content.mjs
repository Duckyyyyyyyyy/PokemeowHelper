// Fails the build when dist/content.js is not a classic script (Chrome refuses `import` there:
// "Cannot use import statement outside a module" and the reader never runs).
import { readFileSync } from 'node:fs';

const js = readFileSync('dist/content.js', 'utf8');
if (/(^|[;}\s])import\s*[{*\w"']/.test(js.slice(0, 2000)) || /\bimport\s*\(/.test(js) || /^export\s|[;}]export\s*\{/m.test(js)) {
  console.error('dist/content.js uses import/export: content scripts must be one classic script.');
  process.exit(1);
}
console.log(`dist/content.js OK (${(js.length / 1024).toFixed(1)} KB, no imports)`);
