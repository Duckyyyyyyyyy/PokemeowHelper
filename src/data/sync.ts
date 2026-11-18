import { parseDataModule } from './literalParser';
import { normalizeDataset } from './normalize';
import { SCHEMA_VERSION, type Dataset } from '../shared/types';

/**
 * Downloads the wiki's static data file and turns it into a Dataset.
 *
 * Runs ONLY when the user presses "Sync data". It reads the same static
 * files the wiki itself loads (HTML + two JS assets), never game APIs, and never
 * executes the game's code: the data module is parsed as literal syntax.
 * The wiki page requires a signed-in session, so this uses the user's cookies.
 */
export const ORIGIN = 'https://pokemeowrpg.com';
const DATA_FILE = /_pokemon-star-wiki-data-[\w-]+\.js/;

export class SyncError extends Error {}

export async function discoverDataUrl(fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(`${ORIGIN}/wiki/`, { credentials: 'include' });
  const html = await res.text();
  if (res.status === 401 || /Sign in to read the Wiki/i.test(html)) {
    throw new SyncError('You are not logged in. Log in to pokemeowrpg.com in Chrome, then sync again.');
  }
  if (!res.ok) throw new SyncError(`The wiki returned error ${res.status}. Open pokemeowrpg.com/wiki/ in Chrome to check (you may need to pass a Cloudflare check), then try again.`);
  const entries = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], ORIGIN).href);
  const seen = new Set<string>();
  let queue = entries;
  // Breadth-first through the wiki's own chunks (the file sits 1–2 imports deep).
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    const next: string[] = [];
    for (const url of queue) {
      if (seen.has(url)) continue;
      seen.add(url);
      const r = await fetcher(url);
      if (!r.ok) throw new SyncError(`Could not load ${url.split('/').pop()} (error ${r.status}).`);
      const js = await r.text();
      const hit = js.match(DATA_FILE);
      if (hit) return `${ORIGIN}/assets/${hit[0]}`;
      for (const m of js.matchAll(/(?:\.\/|assets\/)((?:wiki|WikiContent)[\w-]*\.js)/g)) next.push(`${ORIGIN}/assets/${m[1]}`);
    }
    queue = next;
  }
  throw new SyncError('Wiki data file not found – the game may have changed its layout. Please report it so MeowHelper can be updated.');
}

export interface SyncProgress {
  (step: string): void;
}

export async function syncDataset(currentVersion: string | undefined, onStep: SyncProgress, fetcher: typeof fetch = fetch): Promise<Dataset | null> {
  onStep('Finding the wiki data file…');
  const url = await discoverDataUrl(fetcher);
  const version = `${SCHEMA_VERSION}:${url.split('/').pop()}`;
  if (version === currentVersion) return null; // already up to date
  onStep('Downloading data (~8 MB)…');
  const res = await fetcher(url);
  if (!res.ok) throw new SyncError(`Could not load the data file (error ${res.status}).`);
  const source = await res.text();
  onStep('Reading data…');
  await new Promise((r) => setTimeout(r, 0)); // let the UI paint before the heavy parse
  const raw = parseDataModule(source) as Record<string, unknown>;
  if (!raw || !Array.isArray((raw as any).challenges)) throw new SyncError('The data file is not in the expected format.');
  return normalizeDataset(raw, version);
}
