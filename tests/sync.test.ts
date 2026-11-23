import { describe, expect, it } from 'vitest';
import { discoverDataUrl, discoverWikiFiles, evYieldFrom, syncDataset, SyncError } from '../src/data/sync';
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

// The EV Training table as the wiki ships it (shape copied 2026-11-23): yields by id, plus an alias map for forms.
const EV = 'const e={1:{hp:0,atk:0,def:0,spa:1,spd:0,spe:0},1e3:{hp:0,atk:0,def:0,spa:2,spd:0,spe:0},869:{hp:0,atk:0,def:0,spa:0,spd:3,spe:0}},d={1000485:869,1000500:{hp:2,atk:0,def:0,spa:0,spd:0,spe:0}};function a(p){if(!Number.isInteger(p))return;const s=d[p];return typeof s=="number"?e[s]:s??e[p]}export{a as speciesEvYield};';
const DATA_SPECIES = 'const e={challenges:[],types:[],species:[{id:1,name:"Bulbasaur",types:["Grass"],baseStats:{hp:45,atk:49,def:49,spa:65,spd:65,spe:45}},{id:4,name:"Charmander",types:["Fire"],baseStats:{hp:39,atk:52,def:43,spa:60,spd:50,spe:65}}],moves:[],abilities:[],items:[]};export{e as default};';
const siteEv = {
  ...site,
  'https://pokemeowrpg.com/assets/wiki-AAA.js': { body: 'import("./WikiContent-BBB.js");import("./pokemon-ev-yield-EEE.js")' },
  'https://pokemeowrpg.com/assets/_pokemon-star-wiki-data-CCC_1.js': { body: DATA_SPECIES },
  'https://pokemeowrpg.com/assets/pokemon-ev-yield-EEE.js': { body: EV },
};

describe('sync: EV yields', () => {
  it('reads yields and resolves form ids through the alias map, without running the module', () => {
    const y = evYieldFrom(EV);
    expect(y(1)).toEqual({ hp: 0, atk: 0, def: 0, spa: 1, spd: 0, spe: 0 });
    expect(y(1000485)).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 3, spe: 0 });
    expect(y(1000500)).toEqual({ hp: 2, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(y(4)).toBeUndefined();
    // The real file writes id 1000 as `1e3`.
    expect(y(1000)).toEqual({ hp: 0, atk: 0, def: 0, spa: 2, spd: 0, spe: 0 });
  });
  it('finds the EV file in the same crawl and attaches yields to species', async () => {
    expect(await discoverWikiFiles(fakeFetch(siteEv))).toEqual({
      data: 'https://pokemeowrpg.com/assets/_pokemon-star-wiki-data-CCC_1.js',
      evYield: 'https://pokemeowrpg.com/assets/pokemon-ev-yield-EEE.js',
    });
    const ds = (await syncDataset(undefined, () => {}, fakeFetch(siteEv)))!;
    expect(ds.species[1].evYield).toEqual({ hp: 0, atk: 0, def: 0, spa: 1, spd: 0, spe: 0 });
    expect(ds.species[4].evYield).toBeUndefined();
    expect(ds.version).toBe(`${SCHEMA_VERSION}:_pokemon-star-wiki-data-CCC_1.js+pokemon-ev-yield-EEE.js`);
    expect(await syncDataset(ds.version, () => {}, fakeFetch(siteEv))).toBeNull();
  });
  it('a missing or broken EV file never fails Sync', async () => {
    const noEv = { ...siteEv, 'https://pokemeowrpg.com/assets/pokemon-ev-yield-EEE.js': { status: 404, body: '' } };
    const missed = (await syncDataset(undefined, () => {}, fakeFetch(noEv)))!;
    expect(missed.species[1].evYield).toBeUndefined();
    // Stored without the EV file in its version, so the next Sync tries again instead of "up to date".
    expect(missed.version).toBe(`${SCHEMA_VERSION}:_pokemon-star-wiki-data-CCC_1.js`);
    expect(await syncDataset(missed.version, () => {}, fakeFetch(siteEv))).not.toBeNull();
    const broken = { ...siteEv, 'https://pokemeowrpg.com/assets/pokemon-ev-yield-EEE.js': { body: 'export const x = fetch("/x");' } };
    expect((await syncDataset(undefined, () => {}, fakeFetch(broken)))!.species[1].evYield).toBeUndefined();
    expect(await discoverWikiFiles(fakeFetch(site))).toEqual({ data: 'https://pokemeowrpg.com/assets/_pokemon-star-wiki-data-CCC_1.js' });
  });
});
