import { describe, expect, it } from 'vitest';
import mini from './fixtures/wiki-mini.json';
import raw from './fixtures/wiki-explore-raw.json';
import type { BoxMon, Dataset, GameTip } from '../src/shared/types';
import { fromWild, itemExtras, wildSpeciesFields } from '../src/data/normalize';
import { CURATED_TIPS } from '../src/data/tips';
import { gearNeeded, huntBall, huntFor, huntWhy, knownGear, mapAccess, mapIdForTitle, passedStage, type Progress } from '../src/engine/hunt';
import { fightOrCatch } from '../src/engine/explore';
import { worthGrinding } from '../src/engine/potential';
import { suggestTeam } from '../src/engine/teamSuggest';

/** wiki-mini + the explore subset, as normalize() would build it (same as explore.test.ts). */
const base = mini as unknown as Dataset;
const r = raw as any;
const ds: Dataset = {
  ...base,
  species: Object.fromEntries(Object.entries(base.species).map(([id, s]) => {
    const extra = r.species.find((x: any) => x.id === Number(id));
    return [id, extra ? { ...s, ...wildSpeciesFields(extra) } : s];
  })),
  items: { ...base.items, ...Object.fromEntries(r.items.map((i: any) => [i.id, { id: i.id, name: i.name, effect: i.heldEffect ?? i.itemEffect ?? i.description ?? '', ...itemExtras(i) }])) },
  wild: fromWild({ maps: r.maps, species: r.species, mechanics: r.mechanics }),
};
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const npc = (id: string) => ds.npcs.find((n) => n.id === id)!;
const mon = (name: string, level: number, moves: string[] = []): BoxMon => ({ uid: `${name}-${level}`, species: sp(name), level, moves, source: 'manual' });
const tips = CURATED_TIPS as GameTip[];
const progress = (p: Partial<Progress> = {}): Progress => ({ tips, done: new Set(), seenMaps: new Set(), ...p });
const noGear = knownGear(new Set(), new Set());

function hunt(boxMons: BoxMon[], npcId = 'challenge:brock', extra: Partial<Parameters<typeof huntFor>[5]> = {}, variant = 0) {
  const n = npc(npcId);
  const v = n.variants[variant];
  const ready = suggestTeam(ds, boxMons, v, { levelCap: v.levelCap });
  const grind = worthGrinding(ds, v, ready, { levelCap: v.levelCap });
  return huntFor(ds, v, boxMons, ready, grind, { levelCap: v.levelCap, progress: progress({ passed: passedStage(n) }), gear: noGear, ...extra });
}

describe('hunt: reachable maps (guess)', () => {
  it('places League NPCs on the path by region', () => {
    expect(passedStage(npc('challenge:brock'))).toBe(0); // Kanto: nothing beaten yet
    expect(passedStage(npc('challenge:hoenn-tateandliza'))).toBe(2); // Hoenn: Kanto + Johto Champions
    expect(passedStage(npc('tower:whirl-tower'))).toBeUndefined();
  });
  it('maps without a gate are open; gated maps are locked until seen, ticked or passed on the path', () => {
    expect(mapAccess('verdant-trail', progress()).access).toBe('open');
    expect(mapAccess('dark-forest', progress()).access).toBe('open'); // just walk there
    const sea = mapAccess('azure-shore', progress({ passed: 0 }));
    expect(sea.access).toBe('locked');
    expect(sea.tip?.id).toBe('map:blue-sea');
    expect(sea.requires).toContain('HM03 Surf');
    expect(mapAccess('azure-shore', progress({ passed: 3 })).access).toBe('guess');
    expect(mapAccess('azure-shore', progress({ done: new Set(['map:blue-sea']) })).access).toBe('ticked');
    expect(mapAccess('azure-shore', progress({ seenMaps: new Set(['azure-shore']) })).access).toBe('seen');
    expect(mapAccess('void-wastes', progress({ passed: 9 })).access).toBe('locked'); // no path stage: never guessed
  });
  it('"All maps unlocked" opens every map, but seen and ticked still say so', () => {
    expect(mapAccess('void-wastes', progress({ allOpen: true })).access).toBe('open');
    expect(mapAccess('azure-shore', progress({ passed: 0, allOpen: true })).access).toBe('open');
    expect(mapAccess('azure-shore', progress({ seenMaps: new Set(['azure-shore']), allOpen: true })).access).toBe('seen');
  });
  it('finds the map from the encounter card title', () => {
    expect(mapIdForTitle(ds, 'Grasslands 3')).toBe('verdant-trail');
    expect(mapIdForTitle(ds, 'The Blue Sea 2')).toBe('azure-shore');
    expect(mapIdForTitle(ds, 'Nowhere')).toBeUndefined();
  });
  it('Surf, rods and the Safari Ticket: only known when ticked in Tips or in the bag', () => {
    expect(gearNeeded('surf', 'verdant-trail', noGear)).toBe('Surf');
    expect(gearNeeded('goodrod', 'verdant-trail', noGear)).toBe('Good Rod');
    expect(gearNeeded('walking', 'verdant-trail', noGear)).toBeUndefined();
    expect(gearNeeded('walking', 'safari-zone', noGear)).toBe('Safari Ticket');
    const g = knownGear(new Set(['item:goodrod', 'hm:hmsurf']), new Set(['safariticket']));
    expect(gearNeeded('surf', 'verdant-trail', g)).toBeUndefined();
    expect(gearNeeded('goodrod', 'verdant-trail', g)).toBeUndefined();
    expect(gearNeeded('oldrod', 'verdant-trail', g)).toBe('Old Rod');
    expect(gearNeeded('walking', 'safari-zone', g)).toBeUndefined();
  });
});

describe('hunt: candidates vs Brock (cap 19)', () => {
  const weakBox = [mon('Pikachu', 12, ['thundershock'])]; // Electric does nothing to Geodude/Onix
  const res = hunt(weakBox);
  // Every candidate through the full calc (cap 19 keeps it cheap); shared by the tests below.
  const all = hunt(weakBox, 'challenge:brock', { limit: 50, shortlist: 400 });

  it('suggests reachable Water/Grass answers for the NPC Pokémon nobody in the box handles', () => {
    expect(res.gaps).toEqual(['Geodude', 'Onix']);
    expect(res.covered).toBe(false);
    expect(res.picks.length).toBeGreaterThan(0);
    expect(res.picks.length).toBeLessThanOrEqual(5);
    const top = res.picks[0];
    expect(top.fillsGap.length).toBeGreaterThan(0);
    const types = ds.species[top.evolvedTo ?? top.mon.species].types;
    expect(types.some((t) => t === 'Water' || t === 'Grass' || t === 'Fighting' || t === 'Ground' || t === 'Steel' || t === 'Ice')).toBe(true);
    expect(top.why).toMatch(/^Answers .+ with .+/);
    expect(top.ivs.text).toContain('90/186');
  });
  it('only uses maps that look reachable (Blue Sea is behind Surf and Wallace) unless asked', () => {
    // Rematch (no cap, Lv 61): Blue Sea and Caves spawns are in range but look locked for a Kanto NPC.
    const re = hunt(weakBox, 'challenge:brock', {}, 1);
    expect(re.picks.length).toBeGreaterThan(0);
    expect(re.picks.every((p) => p.where.access.access !== 'locked')).toBe(true);
    expect(re.lockedForms).toBeGreaterThan(0);
    const all = hunt(weakBox, 'challenge:brock', { showLocked: true, limit: 50 }, 1);
    expect(all.picks.some((p) => p.where.access.access === 'locked')).toBe(true);
    expect(all.lockedForms).toBe(0);
    // Default cap of 5: locked ones come after the 5 reachable ones, not crowded out.
    const shown = hunt(weakBox, 'challenge:brock', { showLocked: true }, 1);
    expect(shown.picks.slice(0, 5).every((p) => p.where.access.access !== 'locked')).toBe(true);
    expect(shown.picks.slice(5).length).toBeGreaterThan(0);
    expect(shown.picks.slice(5).every((p) => p.where.access.access === 'locked')).toBe(true);
  });
  it('catch levels stay under the cap, and evolutions by then are scored as the evolved form', () => {
    for (const p of res.picks) {
      expect(p.catchLevel).toBeLessThanOrEqual(19);
      expect(p.where.enc.levels[0]).toBeLessThanOrEqual(19);
    }
    // Caterpie → Metapod (7) → Butterfree (10), both by Lv 19; Psyduck evolves at 33 (not yet).
    expect(all.picks.find((p) => p.mon.species === sp('Caterpie'))?.evolvedTo).toBe(sp('Butterfree'));
    const psy = all.picks.find((p) => p.mon.species === sp('Psyduck'));
    expect(psy).toBeTruthy();
    expect(psy!.evolvedTo).toBeUndefined();
    // One card per form scored.
    const forms = all.picks.map((p) => p.evolvedTo ?? p.mon.species);
    expect(new Set(forms).size).toBe(forms.length);
  });
  it('Surf/rod spots you are not known to have are tagged, not dropped, and rank a bit lower', () => {
    const tagged = all.picks.filter((p) => p.where.needs);
    expect(tagged.length).toBeGreaterThan(0);
    for (const p of tagged) expect(['Surf', 'Old Rod', 'Good Rod', 'Super Rod', 'Safari Ticket']).toContain(p.where.needs);
    // Goldeen (Good Rod, 100) vs Oddish (walking, 95): the walking one comes first.
    expect(res.picks[0].where.needs).toBeUndefined();
    const geared = hunt(weakBox, 'challenge:brock', { limit: 50, shortlist: 400, gear: knownGear(new Set(['hm:hmsurf', 'item:oldrod', 'item:goodrod', 'item:superrod']), new Set(['safariticket'])) });
    expect(geared.picks.some((p) => p.where.needs)).toBe(false);
  });
  it('skips species you already own (as caught or as what they become)', () => {
    const owned = hunt([...weakBox, mon('Oddish', 10, ['absorb']), mon('Butterfree', 30)], 'challenge:brock', { limit: 50, shortlist: 400 });
    expect(owned.picks.some((p) => p.mon.species === sp('Oddish'))).toBe(false);
    expect(owned.picks.some((p) => p.mon.species === sp('Caterpie'))).toBe(false);
  });
  it('says the box already covers the NPC when every Pokémon of theirs has an answer', () => {
    const strong = [mon('Starmie', 19, ['watergun', 'bubblebeam', 'surf']), mon('Vileplume', 19, ['megadrain', 'gigadrain'])];
    const c = hunt(strong);
    expect(c.gaps).toEqual([]);
    expect(c.covered).toBe(true);
    for (const p of c.picks) expect(p.fillsGap).toEqual([]);
  });
  it('best ball from the bag', () => {
    const p = res.picks[0];
    expect(huntBall(ds, p, new Map([['pokeball', 5]]))?.id).toBe('pokeball');
    expect(huntBall(ds, p, null)).not.toBeNull();
  });
});

describe('hunt: why text', () => {
  it('groups NPC Pokémon by the move that answers them, with its learn level', () => {
    const why = huntWhy({
      answers: [{ foe: 'Salamence', move: 'Ice Beam', level: 40 }, { foe: 'Altaria', move: 'Ice Beam', level: 40 }, { foe: 'Altaria', move: 'Ice Beam', level: 40 }, { foe: 'Garchomp', move: 'Surf' }],
      potential: 70, potentialWins: 3, targetLevel: 50, beats: { name: 'Rattata', potential: 30 },
    }, 6);
    expect(why).toBe('Answers Salamence and Altaria with Ice Beam (Lv 40); Garchomp with Surf · wins 3/6 1v1 at Lv 50 · beats your grind pick Rattata (70 vs 30)');
  });
});

describe('hunt list: wild encounter verdict', () => {
  it('a hunt-list species is CATCH even when it is registered', () => {
    const t = { species: sp('Oddish'), registered: true, catchlist: false };
    expect(fightOrCatch(ds, t, []).verdict).toBe('fight');
    const d = fightOrCatch(ds, t, [], new Set(), { hunt: new Map([[sp('Oddish'), 'Brock']]) });
    expect(d.verdict).toBe('catch');
    expect(d.reasons[0]).toBe('On your hunt list for Brock.');
  });
});
