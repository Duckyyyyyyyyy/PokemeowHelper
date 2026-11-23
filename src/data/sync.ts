import { parseDataDeclarations, parseDataModule } from './literalParser';
import { normalizeDataset } from './normalize';
import { SCHEMA_VERSION, type Dataset, type StatTable } from '../shared/types';

/**
 * Downloads the wiki's static data file and turns it into a Dataset.
 *
 * Runs ONLY when the user presses "Sync data". It reads the same static
 * files the wiki itself loads (HTML, its JS chunks, the data file and the EV Training
 * table), never game APIs, and never executes the game's code: the data is parsed as literal syntax.
 * The wiki page requires a signed-in session, so this uses the user's cookies.
 */
export const ORIGIN = 'https://pokemeowrpg.com';
const DATA_FILE = /_pokemon-star-wiki-data-[\w-]+\.js/;
const EV_FILE = /pokemon-ev-yield-[\w-]+\.js/;

export class SyncError extends Error {}

export interface WikiFiles {
  /** The wiki data file (species, moves, NPCs…). */
  data: string;
  /** The EV Training page's yield table (`pokemon-ev-yield-*.js`), when found. Optional: Sync works without it. */
  evYield?: string;
}

/** Breadth-first through the wiki's own chunks (the files sit 1–2 imports deep); stops once both are found. */
export async function discoverWikiFiles(fetcher: typeof fetch = fetch): Promise<WikiFiles> {
  const res = await fetcher(`${ORIGIN}/wiki/`, { credentials: 'include' });
  const html = await res.text();
  if (res.status === 401 || /Sign in to read the Wiki/i.test(html)) {
    throw new SyncError('You are not logged in. Log in to pokemeowrpg.com in Chrome, then sync again.');
  }
  if (!res.ok) throw new SyncError(`The wiki returned error ${res.status}. Open pokemeowrpg.com/wiki/ in Chrome to check (you may need to pass a Cloudflare check), then try again.`);
  const entries = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], ORIGIN).href);
  const seen = new Set<string>();
  let data: string | undefined;
  let evYield: string | undefined;
  let queue = entries;
  for (let depth = 0; depth < 3 && queue.length && !(data && evYield); depth++) {
    const next: string[] = [];
    for (const url of queue) {
      if (seen.has(url)) continue;
      seen.add(url);
      const r = await fetcher(url);
      if (!r.ok) throw new SyncError(`Could not load ${url.split('/').pop()} (error ${r.status}).`);
      const js = await r.text();
      data ??= js.match(DATA_FILE)?.[0];
      evYield ??= js.match(EV_FILE)?.[0];
      if (data && evYield) break;
      for (const m of js.matchAll(/(?:\.\/|assets\/)((?:wiki|WikiContent)[\w-]*\.js)/g)) next.push(`${ORIGIN}/assets/${m[1]}`);
    }
    queue = next;
  }
  if (!data) throw new SyncError('Wiki data file not found – the game may have changed its layout. Please report it so MeowRPGAdvisor can be updated.');
  return { data: `${ORIGIN}/assets/${data}`, ...(evYield ? { evYield: `${ORIGIN}/assets/${evYield}` } : {}) };
}

export async function discoverDataUrl(fetcher: typeof fetch = fetch): Promise<string> {
  return (await discoverWikiFiles(fetcher)).data;
}

/**
 * The EV Training table: `const e={1:{hp:0,…},…},d={1000485:869,…}` where `e` holds yields and `d` maps
 * other ids (forms) to an `e` key (a number) or to a yield of their own. Species missing from both: unknown.
 */
export function evYieldFrom(source: string): (id: number) => StatTable | undefined {
  const decls = parseDataDeclarations(source);
  const vals = Object.values(decls).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  const isYield = (x: unknown): x is StatTable => !!x && typeof x === 'object' && 'hp' in (x as object) && 'spe' in (x as object);
  const table = vals.find((o) => Object.values(o).some(isYield));
  const alias = vals.find((o) => o !== table);
  if (!table) throw new Error('No EV yield table');
  return (id) => {
    const a = alias?.[id];
    const y = typeof a === 'number' ? table[a] : a ?? table[id];
    return isYield(y) ? { hp: +y.hp || 0, atk: +y.atk || 0, def: +y.def || 0, spa: +y.spa || 0, spd: +y.spd || 0, spe: +y.spe || 0 } : undefined;
  };
}

export interface SyncProgress {
  (step: string): void;
}

export async function syncDataset(currentVersion: string | undefined, onStep: SyncProgress, fetcher: typeof fetch = fetch): Promise<Dataset | null> {
  onStep('Finding the wiki data file…');
  const files = await discoverWikiFiles(fetcher);
  const url = files.data;
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
  const ds = normalizeDataset(raw, version);
  // EV yields (EV Training page): optional; a missing or changed file only leaves them unknown.
  if (files.evYield) {
    try {
      onStep('Reading EV yields…');
      const r = await fetcher(files.evYield);
      if (r.ok) {
        const yieldOf = evYieldFrom(await r.text());
        for (const sp of Object.values(ds.species)) {
          const y = yieldOf(sp.id);
          if (y) sp.evYield = y;
        }
      }
    } catch {
      // keep the dataset without EV yields
    }
  }
  return ds;
}
