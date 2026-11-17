import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { BoxSyncError, fetchCollection, mergeBox, resolveAbility, toBoxMons, type RawCollectionMon } from '../src/data/boxSync';

const ds = fixture as unknown as Dataset;
const noSleep = async () => {};

const mon = (id: string, species: number, extra: Partial<RawCollectionMon> = {}): RawCollectionMon => ({
  id, species, level: 20, moves: ['tackle', 'growl'], nature: 'Hasty', abilitySlot: '0', heldItem: null, gender: 'F',
  ivs: { hp: 1, atk: 2, def: 3, spa: 4, spd: 5, spe: 6 }, evs: { hp: 0, atk: 0, def: 11, spa: 0, spd: 0, spe: 0 }, ...extra,
});

/** Fake game API: pages keyed by cursor ('' = first page). Records every requested URL. */
function fakeGame(pages: Record<string, { pokemon: RawCollectionMon[]; nextCursor: string | null }>, status = 200) {
  const urls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    if (status !== 200) return new Response('nope', { status, headers: { 'retry-after': '30' } });
    const page = pages[url.searchParams.get('cursor') ?? ''];
    return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetcher, urls };
}

describe('fetchCollection', () => {
  it('follows nextCursor with the game team-picker parameters', async () => {
    const g = fakeGame({
      '': { pokemon: [mon('a', 1), mon('b', 4)], nextCursor: 'C2' },
      C2: { pokemon: [mon('c', 7)], nextCursor: null },
    });
    const progress: number[] = [];
    const all = await fetchCollection({ fetcher: g.fetcher, sleep: noSleep, onProgress: (n) => progress.push(n) });
    expect(all.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(g.urls).toHaveLength(2);
    const first = new URL(g.urls[0]);
    expect(first.pathname).toBe('/api/collection');
    expect(Object.fromEntries(first.searchParams)).toEqual({ egg: 'false', sort: 'level', order: 'desc', limit: '30' });
    expect(new URL(g.urls[1]).searchParams.get('cursor')).toBe('C2');
    expect(progress).toEqual([2, 3]);
  });

  it('waits between pages', async () => {
    const waits: number[] = [];
    const g = fakeGame({ '': { pokemon: [mon('a', 1)], nextCursor: 'X' }, X: { pokemon: [], nextCursor: null } });
    await fetchCollection({ fetcher: g.fetcher, delayMs: 800, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([800]);
  });

  it('stops on rate limit and on sign-out with a clear message', async () => {
    await expect(fetchCollection({ fetcher: fakeGame({}, 429).fetcher, sleep: noSleep })).rejects.toThrow(/slow down.*30 s/);
    await expect(fetchCollection({ fetcher: fakeGame({}, 401).fetcher, sleep: noSleep })).rejects.toThrow(/not signed in/);
    await expect(fetchCollection({ fetcher: fakeGame({}, 500).fetcher, sleep: noSleep })).rejects.toBeInstanceOf(BoxSyncError);
  });

  it('refuses to loop on a repeated cursor and caps the page count', async () => {
    const loop = fakeGame({ '': { pokemon: [mon('a', 1)], nextCursor: 'L' }, L: { pokemon: [mon('b', 1)], nextCursor: 'L' } });
    await expect(fetchCollection({ fetcher: loop.fetcher, sleep: noSleep })).rejects.toThrow(/same page/);
    const pages: Record<string, any> = {};
    for (let i = 0; i < 10; i++) pages[i ? `p${i}` : ''] = { pokemon: [mon(`m${i}`, 1)], nextCursor: `p${i + 1}` };
    await expect(fetchCollection({ fetcher: fakeGame(pages).fetcher, sleep: noSleep, maxPages: 3 })).rejects.toThrow(/Stopped after 3 pages/);
  });
});

describe('mapping to the box', () => {
  it('keeps level, moves, nature, IVs/EVs and resolves the ability slot', () => {
    const [b] = toBoxMons(ds, [mon('x1', 1, { abilitySlot: '0' }), mon('egg', 0, { egg: {} })]);
    expect(b).toMatchObject({ uid: 'game:x1', source: 'game', species: 1, level: 20, moves: ['tackle', 'growl'], nature: 'Hasty', gender: 'F' });
    expect(b.ivs?.spe).toBe(6);
    expect(b.ability).toBe(ds.species[1].abilities.find((a) => !a.hidden)!.name);
    expect(toBoxMons(ds, [mon('egg', 0, { egg: {} })])).toEqual([]);
  });
  it('maps a non-numeric slot to the hidden ability', () => {
    const hidden = ds.species[1].abilities.find((a) => a.hidden)?.name;
    expect(resolveAbility(ds, 1, 'H')).toBe(hidden);
    expect(resolveAbility(ds, 1, undefined)).toBeUndefined();
  });
  it('replaces previously synced Pokémon but keeps manual ones', () => {
    const manual: BoxMon = { uid: 'm1', species: 25, moves: [], source: 'manual' };
    const legacy: BoxMon = { uid: 'old', species: 4, moves: [] }; // Phase 1 entries have no source
    const oldSync: BoxMon = { uid: 'game:z', species: 7, moves: [], source: 'game' };
    const fresh = toBoxMons(ds, [mon('y', 1)]);
    const merged = mergeBox([manual, legacy, oldSync], fresh);
    expect(merged.map((b) => b.uid)).toEqual(['game:y', 'm1', 'old']);
  });
});
