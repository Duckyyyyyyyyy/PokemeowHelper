/**
 * Runs data-file discovery against the REAL game assets (public static files).
 * Only the signed-in /wiki/ HTML is stubbed, with the wiki's real entry script tag.
 *
 *   npx tsx scripts/check-discovery.ts [wiki-entry-script-path]
 */
import { discoverDataUrl, ORIGIN } from '../src/data/sync';

const entry = process.argv[2] ?? '/assets/wiki-Vwj9xxuu.js';
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === `${ORIGIN}/wiki/`) {
    return new Response(`<script src="/theme-init.js"></script><script type="module" crossorigin src="${entry}"></script>`, { status: 200 });
  }
  return fetch(url, init);
};

const t0 = performance.now();
console.log(await discoverDataUrl(fetcher), `${Math.round(performance.now() - t0)} ms`);
