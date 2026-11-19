import { describe, expect, it } from 'vitest';
import mini from './fixtures/wiki-mini.json';
import exploreRaw from './fixtures/wiki-explore-raw.json';
import type { Dataset, GameTip } from '../src/shared/types';
import { generateTips } from '../src/data/tipsGen';
import { CURATED_TIPS, REGION_STAGE } from '../src/data/tips';
import { fromChallenges, fromWild, normalizeDataset } from '../src/data/normalize';
import { allTips, mapNeeds, progressPath, searchTips, tipsForMap, tipsForNpc } from '../src/engine/tips';

/** Small synthetic wiki data (short made-up strings, same shape as the real file). */
const champ = (id: string, region: string, regionName: string, name: string, rewardItems: string[], prereq: string[] = []) => ({
  id, name, region, regionName, category: 'champion', title: 'Champion', badge: '', levelCap: 60, requirements: [], prerequisiteTrainerIds: prereq, rewardItems, team: [], format: 'singles',
});
const raw = {
  regions: [{ id: 'kanto', name: 'Kanto' }, { id: 'hoenn', name: 'Hoenn' }],
  challenges: [
    { id: 'brock', name: 'Brock', region: 'kanto', regionName: 'Kanto', category: 'gym', title: 'Gym Leader', badge: 'Boulder', levelCap: 19, requirements: [], prerequisiteTrainerIds: [], rewardItems: ['tmrocktomb'], team: [], format: 'singles' },
    { id: 'misty', name: 'Misty', region: 'kanto', regionName: 'Kanto', category: 'gym', title: 'Gym Leader', badge: 'Cascade', levelCap: 26, requirements: [], prerequisiteTrainerIds: ['brock'], rewardItems: [], team: [], format: 'singles' },
    champ('kanto-blue', 'kanto', 'Kanto', 'Blue', ['hmcut', 'expcharm'], ['brock', 'misty']),
    champ('hoenn-wallace', 'hoenn', 'Hoenn', 'Wallace', ['hmsurf']),
  ],
  items: [
    { id: 'hmsurf', name: 'HM03 · Surf', category: 'tms', moveId: 'surf', challengeSource: 'Champion reward, once.' },
    { id: 'hmcut', name: 'HM01 · Cut', category: 'tms', moveId: 'cut', challengeSource: 'Champion reward, once.' },
    { id: 'tmrocktomb', name: 'TM39 · Rock Tomb', category: 'tms', moveId: 'rocktomb', gymSources: ['brock'], mapItemSource: 'Chest loot.\nChests move daily.' },
    { id: 'tmdig', name: 'TM55 · Dig', category: 'tms', moveId: 'dig', mapItemSource: 'Chest loot.\nChests move daily.' },
    { id: 'expcharm', name: 'Exp. Charm', category: 'key-items', description: 'More EXP.', keyItemSource: 'Beat Champion Blue in Kanto.', gymSources: ['kanto-blue'] },
    { id: 'silphscope', name: 'Silph Scope', category: 'key-items', description: 'See ghosts.', keyItemSource: 'Dig it up in the Graveyard’s Forgotten Plots.' },
    { id: 'oldrod', name: 'Old Rod', category: 'key-items', description: 'Fish.', keyItemSource: 'Beat Misty in the Kanto League twice.' },
    { id: 'repel', name: 'Repel', category: 'exploration', description: 'Fewer commons.', shopPrice: 1800 },
    { id: 'mewtwodna', name: 'Mewtwo DNA', category: 'evolution', challengeSource: 'Hideout clear, 5%.' },
  ],
  maps: [
    { id: 'verdant-trail', name: 'Grasslands', sections: [{ id: 's1', name: 'Grasslands 1' }], encounters: [{ species: 7, method: 'surf', rarity: 'common', levels: [5, 9], day: 0.1, night: 0.1, sections: ['s1'] }, { species: 7, method: 'oldrod', rarity: 'common', levels: [5, 9], day: 0.1, night: 0.1, sections: ['s1'] }] },
    { id: 'haunted-wood', name: 'Graveyard', sections: [{ id: 's3', name: 'Forgotten Plots' }], encounters: [] },
    { id: 'stone-ridge', name: 'Caves', sections: [], encounters: [] },
    { id: 'caves-upper', name: 'Upper Caves', sections: [], encounters: [] },
  ],
  species: [
    { id: 7, name: 'Squirtle', machineMoves: ['surf', 'dig'], locations: [] },
    { id: 50, name: 'Diglett', machineMoves: ['dig'], locations: [] },
    { id: 144, name: 'Articuno', spawnRequirement: 'Defeat Kanto Champion Blue to unlock this spawn.', locations: [{ mapId: 'stone-ridge' }] },
    { id: 150, name: 'Mewtwo', spawnItem: 'mewtwodna', spawnRequirement: 'Defeat Kanto Champion Blue to unlock this spawn. Needs DNA.', locations: [{ mapId: 'caves-upper' }] },
    { id: 999, name: 'Springmon', spawnRequirement: 'Spring only · March 1–May 31 (UTC).', locations: [{ mapId: 'verdant-trail' }] },
  ],
  battleTowers: [{ id: 'whirl-tower', name: 'Whirl Tower', guardian: 'Zuki', type: 'Water', requirement: 'Beat Lance.', championId: 'kanto-blue', reward: 'mewtwodna', rewardChance: 0.05, coins: 2000, team: [{}, {}] }],
  evolutionMethods: [
    { from: 64, to: 65, methods: ['trade'], requirement: 'Trade it' },
    { from: 7, to: 8, methods: ['level'], requirement: 'Level 16' },
  ],
};

const tips = generateTips(raw);
const byId = (id: string, list: GameTip[] = tips) => list.find((t) => t.id === id)!;

describe('tip generation from wiki data', () => {
  it('links each HM to the Champion whose rewardItems list it, with the path stage', () => {
    const surf = byId('hm:hmsurf');
    expect(surf.title).toBe('Get HM03 Surf');
    expect(surf.category).toBe('hm');
    expect(surf.npcs).toEqual(['challenge:hoenn-wallace']);
    expect(surf.requires).toEqual(['Defeat Hoenn Champion Wallace']);
    expect(surf.stage).toBe(REGION_STAGE.hoenn);
    expect(surf.moves).toEqual(['surf']);
    expect(surf.steps.some((s) => s.includes('1 species can learn Surf'))).toBe(true);
    expect(surf.source).toEqual(expect.arrayContaining([{ kind: 'data', ref: 'challenges[].rewardItems' }]));
  });

  it('builds Key Item tips from keyItemSource and tags maps and trainers named in it', () => {
    const scope = byId('item:silphscope');
    expect(scope.steps[0]).toContain('Forgotten Plots');
    expect(scope.maps).toEqual(['haunted-wood']);
    expect(scope.stage).toBe(0); // curated path placement
    const rod = byId('item:oldrod');
    expect(rod.npcs).toEqual(['challenge:misty']); // named with its region
    expect(rod.category).toBe('key');
    const charm = byId('item:expcharm');
    expect(charm.npcs).toContain('challenge:kanto-blue');
    expect(charm.stage).toBe(REGION_STAGE.kanto);
  });

  it('tags the longest map name only', () => {
    const t = generateTips({ ...raw, items: [{ id: 'k', name: 'K', category: 'key-items', keyItemSource: 'Hidden in the Upper Caves.' }] });
    expect(byId('item:k', t).maps).toEqual(['caves-upper']);
  });

  it('groups plain Champion spawn unlocks and gives item spawns their own tip', () => {
    const group = byId('spawns:champ:kanto-blue');
    expect(group.species).toEqual([144]);
    expect(group.maps).toEqual(['stone-ridge']);
    const mewtwo = byId('spawn:150');
    expect(mewtwo.items).toEqual(['mewtwodna']);
    expect(mewtwo.steps.join(' ')).toContain('Hideout clear, 5%.');
    expect(mewtwo.steps.join(' ')).toContain('Whirl Tower: 5% per clear.');
    expect(byId('spawns:season').species).toEqual([999]);
  });

  it('lists the League in prerequisite order with caps and special rewards', () => {
    const k = byId('league:kanto');
    expect(k.steps[0]).toMatch(/^Brock – Gym Leader · Boulder Badge · team cap Lv 19/);
    expect(k.steps[1]).toMatch(/^Misty/);
    expect(k.steps[2]).toContain('gives HM01 Cut, Exp. Charm');
    expect(k.order).toBe(-1);
  });

  it('tells "all, any order" groups apart from version alternatives', () => {
    const t = (id: string, name: string, edition: string, prereq: string[]) => ({ id, name, region: 'galar', regionName: 'Galar', category: 'gym', title: 'Gym Leader', badge: '', edition, prerequisiteTrainerIds: prereq, rewardItems: [], team: [] });
    const g = generateTips({
      challenges: [
        t('a', 'Ann', 'Sword and Shield', []), t('b', 'Bea', 'Sword', ['a']), t('c', 'Cal', 'Shield', ['a']),
        t('d', 'Dee', 'Sword and Shield', ['a', 'b', 'c']), t('e', 'Eve', 'Sword and Shield', ['a', 'b', 'c']),
      ],
    });
    const steps = byId('league:galar', g).steps;
    expect(steps[1]).toMatch(/^Bea or Cal \(either one\)/);
    expect(steps[2]).toMatch(/^Dee, Eve \(all, any order\)/);
  });

  it('aggregates item sources and special evolution methods', () => {
    const chests = byId('source:chests');
    expect(chests.items).toEqual(['tmrocktomb', 'tmdig']);
    expect(chests.steps).toContain('Chest loot.');
    expect(byId('source:shop').steps[0]).toContain('Repel 1,800 coins');
    expect(byId('evo:trade').species).toEqual([64, 65]);
    expect(tips.some((t) => t.id === 'evo:level')).toBe(false);
    expect(byId('tower:whirl-tower').requires).toEqual(['Defeat Kanto Champion Blue']);
  });

  it('copes with missing sections and leaves no empty arrays', () => {
    expect(generateTips({})).toEqual([]);
    for (const t of tips) for (const k of ['maps', 'items', 'npcs', 'moves', 'species', 'requires'] as const) expect(t[k] === undefined || t[k]!.length > 0).toBe(true);
  });

  it('is part of normalizeDataset, and League NPCs carry badge and rewards', () => {
    const ds = normalizeDataset(raw, 'v', 0);
    expect(ds.tips?.length).toBe(tips.length);
    const brock = fromChallenges(raw.challenges).find((n) => n.id === 'challenge:brock')!;
    expect(brock.badge).toBe('Boulder');
    expect(brock.rewardItems).toEqual(['tmrocktomb']);
  });
});

describe('curated tips', () => {
  const mapIds = new Set([
    ...(exploreRaw as any).maps.map((m: any) => m.id),
    'moonlit-grove', 'sky-meadow', 'dragon-sanctuary', 'dream-forest', 'void-wastes', 'fairy-sanctuary', 'snow-mountain', 'dark-forest', 'mt-ember', 'caves-upper', 'caves-underground', 'azure-depths', 'volcano-edge', 'unown-ruins', 'berry-garden', 'safari-approach', 'safari-house',
  ]);
  it('have unique ids, a source each, and known map ids', () => {
    const ids = CURATED_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of CURATED_TIPS) {
      expect(t.source.length, t.id).toBeGreaterThan(0);
      for (const s of t.source) if (s.kind === 'page') expect(s.ref).toMatch(/^#\//);
      for (const m of t.maps ?? []) expect(mapIds.has(m), `${t.id}: ${m}`).toBe(true);
      expect(t.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('tip search and views', () => {
  const ds = { ...(mini as unknown as Dataset), tips, wild: fromWild(raw) } as Dataset;
  const list = allTips(ds);

  it('finds tips by item, map, move and NPC names, every word required', () => {
    expect(searchTips(list, ds, 'silph scope')[0].id).toMatch(/silphscope|field:dig/);
    expect(searchTips(list, ds, 'surf').slice(0, 3).map((t) => t.id)).toContain('hm:hmsurf');
    expect(searchTips(list, ds, 'Graveyard').some((t) => t.id === 'map:graveyard')).toBe(true);
    expect(searchTips(list, ds, 'wallace').some((t) => t.id === 'hm:hmsurf')).toBe(true);
    expect(searchTips(list, ds, 'surf zzzz')).toEqual([]);
    expect(searchTips(list, ds, 'pokemon').length).toBeGreaterThan(0); // accent-insensitive "Pokémon"
  });

  it('ranks title matches first and filters by category', () => {
    const r = searchTips(list, ds, 'dig');
    expect(r[0].title.toLowerCase()).toContain('dig');
    expect(searchTips(list, ds, '', 'maps').every((t) => t.category === 'maps')).toBe(true);
  });

  it('works without generated tips (old cache)', () => {
    const old = allTips({ ...ds, tips: undefined });
    expect(old.length).toBe(CURATED_TIPS.length);
    expect(searchTips(old, null, 'surf').some((t) => t.id === 'field:surf')).toBe(true);
  });

  it('orders the progress path by stage then order', () => {
    const path = progressPath(list, ds);
    expect(path[0].stage).toBe(0);
    expect(path[0].label).toBe('Getting started');
    expect(path.map((s) => s.stage)).toEqual([...path.map((s) => s.stage)].sort((a, b) => a - b));
    const kanto = path.find((s) => s.stage === REGION_STAGE.kanto)!;
    expect(kanto.tips[0].id).toBe('league:kanto');
  });

  it('cross-links maps and NPCs', () => {
    expect(mapNeeds(ds, 'verdant-trail').map((n) => n.tipId)).toEqual(['hm:hmsurf', 'item:oldrod']);
    expect(tipsForMap(list, 'haunted-wood')[0].category).toBe('maps');
    const wallace = tipsForNpc(list, 'challenge:hoenn-wallace').map((t) => t.id);
    expect(wallace).toContain('hm:hmsurf');
    expect(wallace).toContain('map:blue-sea');
  });
});
