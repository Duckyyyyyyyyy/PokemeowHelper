import { describe, expect, it } from 'vitest';
import mini from './fixtures/wiki-mini.json';
import raw from './fixtures/wiki-explore-raw.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { fromWild, itemExtras, mergeEncounters, wildSpeciesFields } from '../src/data/normalize';
import { filterEncounters, findableSpecies, fightOrCatch, mapForCard, speciesByCardName, isFindable, wantedSpecies, whereToFind, wildHeldItems } from '../src/engine/explore';
import { BALL_RULES, ballItems, catchChance, criticalStrength, levelBonus, rankBalls, statusBonus, type BallContext } from '../src/engine/catching';
import { afterPlan, planCatch, statusImmunity } from '../src/engine/catchPlan';
import { boxToCalc, moveDamage, npcToCalc } from '../src/engine/damage';

/** wiki-mini + the explore subset, as normalize() would build it. */
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
const mon = (name: string, moves: string[], level = 30): BoxMon => ({ uid: name, species: sp(name), moves, level });
const ctx = (name: string, extra: Partial<BallContext> = {}): BallContext => {
  const s = ds.species[sp(name)];
  return { speciesId: s.id, types: s.types, catchRate: s.catchRate ?? 45, level: 20, baseSpeed: s.baseStats.spe, ...extra };
};

describe('explore data normalize', () => {
  it('keeps maps and merges overlapping encounter rows without summing odds', () => {
    const merged = mergeEncounters([
      { species: 1, rarity: 'common', method: 'walking', label: 'A', levels: [5, 9], day: 0.03, night: 0, sections: ['s1'] },
      { species: 1, rarity: 'common', method: 'walking', label: 'B', levels: [6, 12], day: 0.02, night: 0.01, sections: ['s1', 's2'] },
      { species: 1, rarity: 'common', method: 'surf', label: 'Surf', levels: [10, 10], day: 0.1, night: 0.1, sections: ['s1'] },
    ]);
    expect(merged).toHaveLength(2);
    const walk = merged.find((e) => e.method === 'walking')!;
    expect(walk.day).toBe(0.03);
    expect(walk.night).toBe(0.01);
    expect(walk.levels).toEqual([5, 12]);
    expect(walk.labels).toEqual(['A', 'B']);
    expect(walk.sections).toEqual(['s1', 's2']);
  });
  it('reads every map from the wiki subset, with Moon Stone species', () => {
    expect(ds.wild!.maps.map((m) => m.id)).toContain('verdant-trail');
    expect(ds.wild!.moonStone).toContain(sp('Clefairy'));
    expect(ds.species[sp('Caterpie')].catchRate).toBe(255);
  });
  it('is undefined for old data without maps', () => {
    expect(fromWild({})).toBeUndefined();
  });
});

describe('encounter filter', () => {
  it('searches by species name and type, most likely first', () => {
    const rows = filterEncounters(ds, { query: 'pikachu' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.species?.name === 'Pikachu')).toBe(true);
    const ghosts = filterEncounters(ds, { type: 'Ghost' });
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((x) => x.species!.types.includes('Ghost'))).toBe(true);
    for (let i = 1; i < ghosts.length; i++) {
      expect(Math.max(ghosts[i - 1].enc.day, ghosts[i - 1].enc.night)).toBeGreaterThanOrEqual(Math.max(ghosts[i].enc.day, ghosts[i].enc.night));
    }
  });
  it('findable = common/rare tiers that actually spawn, never legendary or extremely rare', () => {
    const all = filterEncounters(ds);
    const rare = all.filter((x) => x.enc.rarity === 'extremely-rare' || x.enc.rarity === 'legendary');
    expect(rare.length).toBeGreaterThan(0);
    expect(rare.some((x) => isFindable(ds, x.enc))).toBe(false);
    const only = filterEncounters(ds, { findableOnly: true });
    expect(only.every((x) => ['common', 'rare'].includes(x.enc.rarity))).toBe(true);
    expect(findableSpecies(ds).has(sp('Mewtwo'))).toBe(false);
  });
  it('answers "where do I find X"', () => {
    const where = whereToFind(ds, sp('Pikachu'));
    expect(where.map((w) => w.map.id)).toContain('power-plant');
  });
  it('knows wild held items per species and map', () => {
    expect(wildHeldItems(ds, sp('Pikachu'), 'power-plant').map((h) => h.itemId)).toContain('lightball');
    expect(wildHeldItems(ds, sp('Pikachu'), 'verdant-trail').map((h) => h.itemId)).not.toContain('lightball');
  });
});

describe('wanted species vs an NPC', () => {
  it('ranks findable species whose types hit the NPC team (Brock → Water/Grass/Fighting/Ground)', () => {
    const brock = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0];
    const wanted = wantedSpecies(ds, brock, []);
    expect(wanted.length).toBeGreaterThan(0);
    const top = wanted.slice(0, 5).flatMap((w) => w.attackTypes);
    expect(top.some((t) => ['Water', 'Grass', 'Fighting', 'Ground', 'Steel'].includes(t))).toBe(true);
    const findable = findableSpecies(ds);
    expect(wanted.every((w) => findable.has(w.species.id))).toBe(true);
    expect(wanted.some((w) => w.species.types.includes('Fire') && w.species.types.length === 1)).toBe(false);
  });
  it('flags species already in the box', () => {
    const brock = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0];
    const first = wantedSpecies(ds, brock, [])[0];
    const again = wantedSpecies(ds, brock, [{ uid: 'x', species: first.species.id, moves: [] }]);
    expect(again.find((w) => w.species.id === first.species.id)!.owned).toBe(true);
  });
});

describe('fight or catch', () => {
  const rattata = sp('Rattata');
  it('catches what you do not own yet', () => {
    const d = fightOrCatch(ds, { species: rattata, level: 5 }, []);
    expect(d.verdict).toBe('catch');
  });
  it('fights an owned species with nothing special', () => {
    const d = fightOrCatch(ds, { species: rattata, level: 5 }, [mon('Rattata', [])]);
    expect(d.verdict).toBe('fight');
  });
  it('catches only Catchlist or unregistered species; in box: 0 alone is a fight (Haunter, live 2026-11-19)', () => {
    const haunter = { species: sp('Haunter'), level: 35, inBox: 0, registered: true, catchlist: false };
    const d = fightOrCatch(ds, haunter, []);
    expect(d).toMatchObject({ verdict: 'fight', reasons: ['Registered, not on Catchlist → fight for EXP.'] });
    expect(fightOrCatch(ds, { ...haunter, catchlist: true }, [])).toMatchObject({ verdict: 'catch', reasons: ["On this week's Catchlist."] });
    expect(fightOrCatch(ds, { ...haunter, inBox: 3, catchlist: true }, [mon('Haunter', [])]).verdict).toBe('catch');
    expect(fightOrCatch(ds, { ...haunter, registered: false }, []).reasons[0]).toMatch(/^Not in your Pokédex yet/);
    expect(fightOrCatch(ds, { ...haunter, catchlist: undefined }, []).reasons[0]).toBe('Registered (no Catchlist marker read) → fight for EXP.');
  });
  it('shiny, held item, good IVs and countering the NPC are hints, never a catch on their own', () => {
    const reg = { registered: true, catchlist: false };
    const d = fightOrCatch(ds, { species: sp('Pikachu'), item: 'lightball', shiny: true, goodIvs: true, ...reg }, [], new Set([sp('Pikachu')]), { npcName: 'Roxanne' });
    expect(d.verdict).toBe('fight');
    expect(d.hints).toEqual(['shiny', 'holds Light Ball', 'good IVs', 'counters Roxanne']);
    expect(fightOrCatch(ds, { species: sp('Pikachu'), item: 'potion', ...reg }, []).hints).toEqual([]);
  });
});

describe('catch odds (wiki bonuses, mainline formula)', () => {
  it('uses the wiki status and level bonuses', () => {
    expect(statusBonus('slp')).toBe(2.5);
    expect(statusBonus('frz')).toBe(2.5);
    expect(statusBonus('par')).toBe(1.5);
    expect(statusBonus('psn')).toBe(1.5);
    expect(statusBonus()).toBe(1);
    expect(levelBonus(1)).toBeCloseTo(3.4);
    expect(levelBonus(5)).toBeCloseTo(2.6);
    expect(levelBonus(10)).toBeCloseTo(1.6);
    expect(levelBonus(13)).toBe(1);
    expect(criticalStrength(30)).toBe(0);
    expect(criticalStrength(200)).toBe(1);
    expect(criticalStrength(700, true)).toBe(5);
  });
  it('is higher at low HP and with status, 0 at zero HP', () => {
    const full = catchChance({ catchRate: 45, hpFrac: 1, level: 30, ballMul: 1 });
    const low = catchChance({ catchRate: 45, hpFrac: 0.05, level: 30, ballMul: 1 });
    const asleep = catchChance({ catchRate: 45, hpFrac: 0.05, level: 30, ballMul: 1, status: 'slp' });
    expect(low).toBeGreaterThan(full);
    expect(asleep).toBeGreaterThan(low);
    expect(catchChance({ catchRate: 45, hpFrac: 0, level: 30, ballMul: 1 })).toBe(0);
    expect(catchChance({ catchRate: 255, hpFrac: 0.1, level: 30, ballMul: 2 })).toBe(1);
  });
  it('adds critical captures at 31+ registered species (mainline: min(255,a) × strength / 6 out of 256)', () => {
    const a = 15; // rate 45, full HP, Poké Ball
    const shake = Math.pow(a / 255, 3 / 16);
    const crit = Math.floor((a * 1) / 6) / 256; // 151–300 species → strength ×1
    const expected = crit * shake + (1 - crit) * Math.pow(shake, 4);
    expect(catchChance({ catchRate: 45, hpFrac: 1, level: 30, ballMul: 1, dexCount: 200 })).toBeCloseTo(expected, 10);
    expect(catchChance({ catchRate: 45, hpFrac: 1, level: 30, ballMul: 1, dexCount: 200 })).toBeGreaterThan(catchChance({ catchRate: 45, hpFrac: 1, level: 30, ballMul: 1 }));
  });
});

describe('ball choice', () => {
  it('has a rule for every ball in the wiki data', () => {
    const balls = ballItems(ds);
    expect(balls.length).toBeGreaterThan(30);
    expect(balls.filter((b) => !BALL_RULES[b.id]).map((b) => b.id)).toEqual([]);
  });
  it('Net Ball for a Water type, Dusk Ball at night, Quick Ball on the first throw only', () => {
    const owned = new Map([['pokeball', 10], ['netball', 1], ['duskball', 1], ['quickball', 1]]);
    expect(rankBalls(ds, ctx('Staryu', { turn: 3, throwsSoFar: 1 }), { owned }).bestOwned!.id).toBe('netball');
    expect(rankBalls(ds, ctx('Gastly', { night: true, turn: 3, throwsSoFar: 1 }), { owned }).bestOwned!.id).toBe('duskball');
    expect(rankBalls(ds, ctx('Gastly', { turn: 1 }), { owned }).bestOwned!.id).toBe('quickball');
    expect(rankBalls(ds, ctx('Gastly', { turn: 2, throwsSoFar: 1 }), { owned }).bestOwned!.id).not.toBe('quickball');
  });
  it('prefers balls in the bag, and a cheap ball when it is as good', () => {
    const owned = new Map([['pokeball', 10], ['ultraball', 2]]);
    const easy = rankBalls(ds, ctx('Caterpie', { level: 5 }), { owned, hpFrac: 0.1 });
    expect(easy.bestOwned!.id).toBe('pokeball'); // Caterpie at 10% HP is a sure catch either way
    const hard = rankBalls(ds, ctx('Pikachu', { level: 30, turn: 3, throwsSoFar: 1 }), { owned });
    expect(hard.bestOwned!.id).toBe('ultraball');
  });
  it('never suggests unawarded balls, Safari Balls outside the Safari Zone, or a Master Ball on a common catch', () => {
    const adv = rankBalls(ds, ctx('Scyther', { turn: 3, throwsSoFar: 1 }), { owned: null });
    expect(['sportball', 'parkball', 'strangeball', 'cherishball', 'safariball', 'masterball']).not.toContain(adv.best!.id);
    expect(adv.ranked.find((b) => b.id === 'sportball')!.unavailable).toBeTruthy();
    expect(adv.ranked.find((b) => b.id === 'masterball')!.saveIt).toBe(true);
    expect(rankBalls(ds, ctx('Mewtwo'), { owned: new Map([['masterball', 1]]), precious: true }).bestOwned!.id).toBe('masterball');
  });
  it('applies Moon Ball, Level Ball and Nest Ball conditions', () => {
    const moon = BALL_RULES.moonball(ctx('Clefairy', { moonStone: ds.wild!.moonStone.includes(sp('Clefairy')) }));
    expect(moon.mul).toBe(4);
    expect(BALL_RULES.levelball(ctx('Rattata', { level: 10, myLevel: 45 })).mul).toBe(8);
    expect(BALL_RULES.levelball(ctx('Rattata', { level: 10, myLevel: 11 })).mul).toBe(2);
    expect(BALL_RULES.nestball(ctx('Rattata', { level: 11 })).mul).toBeCloseTo(3);
    expect(BALL_RULES.nestball(ctx('Rattata', { level: 35 })).mul).toBe(1);
    expect(BALL_RULES.heavyball(ctx('Onix')).unknown).toBe(true);
  });
});

describe('catch plan: weaken without KO, then status', () => {
  it('puts False Swipe first and never offers a hit whose max roll can KO', () => {
    const box = [mon('Scyther', ['falseswipe', 'wingattack', 'slash'], 40), mon('Machamp', ['crosschop', 'karatechop'], 60)];
    const plan = planCatch(ds, box, { species: sp('Rattata'), level: 10 });
    expect(plan.weaken[0].moveId).toBe('falseswipe');
    expect(plan.weaken.every((w) => w.safe || w.maxPct < 100)).toBe(true);
    expect(plan.weaken.some((w) => w.moveId === 'crosschop')).toBe(false);
  });
  it('sizes a weak hit that leaves it standing', () => {
    const plan = planCatch(ds, [mon('Pidgey', ['tackle', 'gust'], 12)], { species: sp('Onix'), level: 30 });
    expect(plan.weaken.length).toBeGreaterThan(0);
    expect(plan.weaken.every((w) => w.maxPct < 100)).toBe(true);
  });
  it('sizes hits against the worst nature/ability, not a neutral copy', () => {
    const me = boxToCalc(ds, mon('Machamp', ['karatechop'], 40), 40);
    const lax = ds.species[sp('Snorlax')];
    const neutral = moveDamage(ds, me, npcToCalc(ds, { species: lax.id, name: lax.name, level: 40, moves: [], baseStats: lax.baseStats, ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }), 'karatechop')!;
    const w = planCatch(ds, [mon('Machamp', ['karatechop'], 40)], { species: lax.id, level: 40 }).weaken.find((x) => x.moveId === 'karatechop')!;
    expect(w.maxPct).toBeGreaterThan(neutral.maxPct);
  });
  it('drops hits that would KO at its current HP', () => {
    const box = [mon('Scyther', ['falseswipe', 'wingattack', 'quickattack'], 40), mon('Pidgey', ['tackle', 'gust'], 12)];
    const plan = planCatch(ds, box, { species: sp('Onix'), level: 30 }, { hpPct: 30 });
    expect(plan.weaken.length).toBeGreaterThan(0);
    expect(plan.weaken.every((w) => w.safe || w.maxPct < 30)).toBe(true);
  });
  it('False Swipe does nothing to Ghosts', () => {
    const plan = planCatch(ds, [mon('Scyther', ['falseswipe'], 40)], { species: sp('Gastly'), level: 30 });
    expect(plan.weaken.some((w) => w.moveId === 'falseswipe')).toBe(false);
    expect(plan.notes.join(' ')).toMatch(/Ghost/);
  });
  it('ranks sleep over paralysis over burn/poison and skips immune targets', () => {
    const box = [mon('Parasect', ['spore', 'stunspore', 'poisonpowder'], 40), mon('Ninetales', ['willowisp'], 40), mon('Pikachu', ['thunderwave'], 40)];
    const plan = planCatch(ds, box, { species: sp('Rattata'), level: 20 });
    expect(plan.status.map((s) => s.status)).toEqual(['slp', 'par', 'par', 'brn', 'psn']);
    expect(plan.status[1].moveId).toBe('thunderwave'); // 90% beats Stun Spore's 75%
    const vsGrass = planCatch(ds, box, { species: sp('Oddish'), level: 20 });
    expect(vsGrass.status.some((s) => s.moveId === 'spore' || s.moveId === 'stunspore')).toBe(false);
    expect(statusImmunity(ds, 'thunderwave', ['Ground'])).toBeTruthy();
    expect(statusImmunity(ds, 'willowisp', ['Fire'])).toBeTruthy();
    expect(statusImmunity(ds, 'toxic', ['Steel'])).toBeTruthy();
    expect(statusImmunity(ds, 'thunderwave', ['Electric'])).toBeTruthy();
  });
  it('warns when its ability may block the status', () => {
    const plan = planCatch(ds, [mon('Parasect', ['spore'], 40)], { species: sp('Drowzee'), level: 20 });
    expect(plan.status[0].mayFail).toMatch(/Insomnia/);
  });
});

describe('matching the game encounter card', () => {
  it('finds the species from the card name, forms either way round', () => {
    expect(speciesByCardName(ds, 'Doduo')?.id).toBe(sp('Doduo'));
    expect(speciesByCardName(ds, 'Nidoran♀')?.id).toBe(sp('Nidoran♀'));
    expect(speciesByCardName(ds, 'Not A Mon')).toBeUndefined();
  });
  it('maps the page title to the explore map where it spawns', () => {
    const m = mapForCard(ds, 'Grasslands 3', sp('Doduo'));
    expect(m?.mapId).toBe('verdant-trail');
    expect(mapForCard(ds, 'Power Plant 2', sp('Pikachu'))?.mapId).toBe('power-plant');
  });
});

describe('after the plan', () => {
  it('False Swipe + sleep leaves 1 HP asleep', () => {
    const plan = planCatch(ds, [mon('Scyther', ['falseswipe'], 40), mon('Parasect', ['spore'], 40)], { species: sp('Rattata'), level: 20 });
    expect(afterPlan(plan, { hpPct: 100 })).toEqual({ hpFrac: 0.01, status: 'slp', label: 'False Swipe + sleep' });
  });
  it('a sized hit counts only its minimum roll, and an existing status is kept', () => {
    const plan = planCatch(ds, [mon('Pidgey', ['tackle', 'gust'], 12)], { species: sp('Onix'), level: 30 });
    const a = afterPlan(plan, { hpPct: 100, status: 'par' });
    expect(a.hpFrac).toBeCloseTo(1 - plan.weaken[0].minPct / 100);
    expect(a.status).toBe('par');
    expect(a.label).toBe('weaken');
  });
  it('changes nothing with an empty plan', () => {
    expect(afterPlan({ weaken: [], status: [], risky: [], notes: [] }, { hpPct: 60 })).toEqual({ hpFrac: 0.6, status: undefined, label: '' });
  });
});
