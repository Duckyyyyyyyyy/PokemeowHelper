import { describe, expect, it } from 'vitest';
import { discoverDataUrl, syncDataset, SyncError } from '../src/data/sync';
import { SCHEMA_VERSION } from '../src/shared/types';

const DATA = 'const e={challenges:[],types:[],species:[],moves:[],abilities:[],items:[]};export{e as default};';

function fakeFetch(map: Record<string, { status?: number; body: string }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = map[url];
    if (!hit) return new Response('not found', { status: 404 });
    return new Response(hit.body, { status: hit.status ?? 200 });
  }) as typeof fetch;
}

const site = {
  'https://pokemeowrpg.com/wiki/': { body: '<script src="/theme-init.js"></script><script type="module" src="/assets/wiki-AAA.js"></script>' },
  'https://pokemeowrpg.com/theme-init.js': { body: '/* theme */' },
  'https://pokemeowrpg.com/assets/wiki-AAA.js': { body: 'import("./WikiContent-BBB.js")' },
  'https://pokemeowrpg.com/assets/WikiContent-BBB.js': { body: 'import("./_pokemon-star-wiki-data-CCC_1.js")' },
  'https://pokemeowrpg.com/assets/_pokemon-star-wiki-data-CCC_1.js': { body: DATA },
};

describe('sync', () => {
  it('finds the data file through the wiki chunks', async () => {
    expect(await discoverDataUrl(fakeFetch(site))).toBe('https://pokemeowrpg.com/assets/_pokemon-star-wiki-data-CCC_1.js');
  });
  it('reports other HTTP failures with the status', async () => {
    const f = fakeFetch({ 'https://pokemeowrpg.com/wiki/': { status: 503, body: 'down' } });
    await expect(discoverDataUrl(f)).rejects.toThrow(/503/);
  });
  it('explains a signed-out wiki', async () => {
    const f = fakeFetch({ 'https://pokemeowrpg.com/wiki/': { status: 401, body: '<p>Sign in to read the Wiki.</p>' } });
    await expect(discoverDataUrl(f)).rejects.toBeInstanceOf(SyncError);
  });
  it('skips download when the version is unchanged', async () => {
    expect(await syncDataset(`${SCHEMA_VERSION}:_pokemon-star-wiki-data-CCC_1.js`, () => {}, fakeFetch(site))).toBeNull();
  });
  it('builds a dataset for a new version', async () => {
    const ds = await syncDataset(undefined, () => {}, fakeFetch(site));
    expect(ds?.version).toBe(`${SCHEMA_VERSION}:_pokemon-star-wiki-data-CCC_1.js`);
    expect(ds?.npcs).toEqual([]);
  });
});
