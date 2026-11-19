// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Generations, Move, Pokemon, calculate } from '@smogon/calc';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, NpcTeamVariant } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { boxToCalc, duel, moveDamage, npcToCalc } from '../src/engine/damage';
import { GEN3, gen3Issues, gen3TypeTable, gen3View } from '../src/engine/gen3';
import { FRONTIER_RULES, NORMAL_RULES, TOWER_RULES, battleRulesFor, dsFor, rulesFor } from '../src/engine/rules';
import { FACILITIES, brainLevel, facilityOf, frontierEntry, itemClause, withLevel } from '../src/engine/frontier';
import { enduranceScore, runSummary, sustainBonus, towerEndurance, updateRun } from '../src/engine/towerPlan';
import { suggestTeam } from '../src/engine/teamSuggest';
import { typeEffectiveness } from '../src/engine/typeChart';
import { adviseTurn } from '../src/engine/turnAdvisor';
import { readBattle } from '../src/content/battleReader';

const ds = structuredClone(fixture) as unknown as Dataset;
const g3 = gen3View(ds);
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon => ({
  uid: `${name}-${level}-${extra.uid ?? ''}`, species: sp(name), level, moves, source: 'game', nature: 'Hardy',
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...extra,
});
const anabel = ds.npcs.find((n) => n.id === 'frontier:tower')!;
const whirl = ds.npcs.find((n) => n.id === 'tower:whirl-tower')!;

describe('Gen III damage (Battle Frontier)', () => {
  it('matches the raw @smogon/calc gen 3 numbers', () => {
    // Raw calc, gen 3: Lv50 Timid 252 SpA Gengar Shadow Ball vs Lv50 Alakazam = 108–128 (uses ATTACK: Ghost is physical).
    const raw = calculate(GEN3, new Pokemon(GEN3, 'Gengar', { level: 50, nature: 'Timid', evs: { spa: 252 } }), new Pokemon(GEN3, 'Alakazam', { level: 50 }), new Move(GEN3, 'Shadow Ball'));
    expect(raw.range()).toEqual([108, 128]);
    const me = boxToCalc(g3, mon('Gengar', 50, ['shadowball'], { nature: 'Timid', evs: { spa: 252 } }));
    const foe = boxToCalc(g3, mon('Alakazam', 50));
    const d = moveDamage(g3, me, foe, 'shadowball')!;
    expect([d.lo, d.hi]).toEqual([108, 128]);
    // Same Pokémon under Gen 9 rules: Shadow Ball is special there, from 130 SpA.
    const d9 = moveDamage(ds, boxToCalc(ds, mon('Gengar', 50, [], { nature: 'Timid', evs: { spa: 252 } })), boxToCalc(ds, mon('Alakazam', 50)), 'shadowball')!;
    expect(d9.hi).toBeGreaterThan(d.hi);
  });

  it('uses Gen III move power and stats (Ice Beam 95)', () => {
    const raw = calculate(GEN3, new Pokemon(GEN3, 'Lapras', { level: 50, nature: 'Modest', evs: { spa: 252 } }), new Pokemon(GEN3, 'Dragonite', { level: 50 }), new Move(GEN3, 'Ice Beam'));
    const d = moveDamage(g3, boxToCalc(g3, mon('Lapras', 50, [], { nature: 'Modest', evs: { spa: 252 } })), boxToCalc(g3, mon('Dragonite', 50)), 'icebeam')!;
    expect([d.lo, d.hi]).toEqual(raw.range());
    expect(g3.moves.icebeam.power).toBe(95);
  });

  it('runs the calc in gen 3 only for the Frontier view', () => {
    expect(boxToCalc(g3, mon('Gengar', 50)).gen.num).toBe(3);
    expect(boxToCalc(ds, mon('Gengar', 50)).gen.num).toBe(9);
    expect(dsFor(ds, FRONTIER_RULES)).toBe(g3); // memoized
    expect(dsFor(ds, TOWER_RULES)).toBe(ds);
  });

  it('crits are ×2 in Gen III', () => {
    const atk = new Pokemon(GEN3, 'Snorlax', { level: 50 });
    const def = new Pokemon(GEN3, 'Snorlax', { level: 50 });
    const plain = calculate(GEN3, atk, def, new Move(GEN3, 'Body Slam')).range()[1];
    const crit = calculate(GEN3, atk, def, new Move(GEN3, 'Body Slam', { isCrit: true })).range()[1];
    expect(crit / plain).toBeGreaterThan(1.9);
  });
});

describe('Gen III type split and data', () => {
  it('the move type decides physical/special', () => {
    expect(g3.moves.shadowball.category).toBe('Physical');
    expect(g3.moves.crunch.category).toBe('Special');
    expect(g3.moves.earthquake.category).toBe('Physical');
    expect(g3.moves.surf.category).toBe('Special');
    expect(ds.moves.shadowball.category).toBe('Special'); // the game data is untouched
  });

  it('has no Fairy: Clefairy is Normal, Charm is Normal, Steel resists Ghost and Dark', () => {
    expect(g3.species[35].types).toEqual(['Normal']);
    expect(g3.moves.charm.type).toBe('Normal');
    const t = gen3TypeTable();
    expect(t.Fairy).toBeUndefined();
    expect(typeEffectiveness(t, 'Ghost', ['Steel'])).toBe(0.5);
    expect(typeEffectiveness(t, 'Dark', ['Steel'])).toBe(0.5);
    expect(typeEffectiveness(ds.types, 'Ghost', ['Steel'])).toBe(1);
  });

  it('drops later moves from scoring instead of mis-scoring them', () => {
    expect(g3.moves.moonblast).toBeUndefined();
    expect(g3.moves.playrough).toBeUndefined();
    const me = boxToCalc(g3, mon('Clefable', 50));
    expect(moveDamage(g3, me, boxToCalc(g3, mon('Machamp', 50)), 'moonblast')).toBeNull();
    const d = duel(g3, me, ['moonblast', 'bodyslam'], boxToCalc(g3, mon('Machamp', 50)), ['crosschop']);
    expect(d.mine?.moveId).not.toBe('moonblast');
  });

  it('maps a later ability to the Gen III one (Gengar: Cursed Body → Levitate)', () => {
    const gengar = boxToCalc(g3, mon('Gengar', 50, [], { ability: 'Cursed Body' }));
    expect(gengar.ability).toBe('Levitate');
    expect(moveDamage(g3, boxToCalc(g3, mon('Dugtrio', 50)), gengar, 'earthquake')?.hi ?? 0).toBe(0);
  });

  it('ignores later held items in the calc and flags them', () => {
    expect(boxToCalc(g3, mon('Gengar', 50, [], { item: 'lifeorb' })).item).toBeUndefined();
    expect(boxToCalc(g3, mon('Gengar', 50, [], { item: 'leftovers' })).item).toBe('Leftovers');
    const issues = gen3Issues(ds, mon('Gengar', 50, ['shadowball', 'hex'], { item: 'lifeorb', ability: 'Cursed Body' }));
    expect(issues.map((i) => i.kind).sort()).toEqual(['ability', 'item', 'move']);
    expect(issues.every((i) => !i.blocking)).toBe(true);
  });

  it('blocks later species and (guessed) restricted ones', () => {
    expect(gen3Issues(ds, mon('Magnezone', 50)).some((i) => i.kind === 'species' && i.blocking)).toBe(true);
    expect(gen3Issues(ds, mon('Mewtwo', 50)).some((i) => i.kind === 'restricted' && i.blocking)).toBe(true);
    expect(gen3Issues(ds, mon('Dragonite', 50))).toEqual([]);
  });
});

describe('rule lookup', () => {
  it('Frontier = Gen III rules without Bag items; Battle Towers stay Gen 9', () => {
    expect(rulesFor('frontier')).toBe(FRONTIER_RULES);
    expect(FRONTIER_RULES).toMatchObject({ gen: 3, bagItems: false });
    expect(rulesFor('tower')).toBe(TOWER_RULES);
    expect(TOWER_RULES.gen).toBeUndefined();
  });

  it('places a live battle by NPC, then arena kind, then the manual switch', () => {
    expect(battleRulesFor('gym', 'frontier', false)).toBe(NORMAL_RULES); // the matched NPC wins
    expect(battleRulesFor(undefined, 'battle-pike', false)).toBe(FRONTIER_RULES);
    expect(battleRulesFor(undefined, 'tower', false)).toBe(TOWER_RULES);
    expect(battleRulesFor(undefined, undefined, true)).toBe(FRONTIER_RULES);
    expect(battleRulesFor(undefined, undefined, false)).toBe(NORMAL_RULES);
  });

  it('knows the facility of a Frontier Brain', () => {
    const f = facilityOf(anabel)!;
    expect(f).toBe(FACILITIES.tower);
    expect(f).toMatchObject({ register: 3, restored: true, carryOver: false });
    expect(FACILITIES.pike.carryOver).toBe(true);
    expect(FACILITIES.pyramid.heldItems).toBe(false);
    expect(FACILITIES.dome.battleWith).toBe(2);
    expect(facilityOf(whirl)).toBeUndefined();
  });

  it('Brain level: 50, or Open Level = highest registered, minimum 60', () => {
    expect(brainLevel('lv50', 100)).toBe(50);
    expect(brainLevel('open', 45)).toBe(60);
    expect(brainLevel('open', 78)).toBe(78);
    const v = withLevel(anabel.variants[0], 60);
    expect(v.team.every((m) => m.level === 60)).toBe(true);
    expect(npcToCalc(g3, v.team[0]).level).toBe(60);
  });
});

describe('Frontier team suggestion: eligibility and clauses', () => {
  const f = FACILITIES.tower;
  const v = withLevel(anabel.variants[0], 50);

  it('Level 50 blocks Pokémon above 50 and later-generation ones', () => {
    expect(frontierEntry(ds, mon('Dragonite', 55), f, 'lv50').blocking.length).toBe(1);
    expect(frontierEntry(ds, mon('Dragonite', 55), f, 'open').blocking).toEqual([]);
    expect(frontierEntry(ds, mon('Magnezone', 50), f, 'open').blocking.length).toBe(1);
    expect(frontierEntry(ds, mon('Dragonite', 50, [], { item: 'leftovers' }), FACILITIES.pyramid, 'lv50').notes[0]).toMatch(/without a held item/);
  });

  it('picks 3, one per species, and skips blocked Pokémon', () => {
    const box = [
      mon('Snorlax', 50, ['bodyslam', 'earthquake'], { uid: 'a' }),
      mon('Snorlax', 50, ['bodyslam', 'earthquake'], { uid: 'b' }),
      mon('Gengar', 50, ['shadowball', 'thunderbolt'], { uid: 'c' }),
      mon('Machamp', 50, ['crosschop', 'rockslide'], { uid: 'd' }),
      mon('Lapras', 50, ['icebeam', 'surf'], { uid: 'e' }),
      mon('Magnezone', 50, ['thunderbolt'], { uid: 'f' }),
    ];
    const blocked = new Map(box.flatMap((m) => {
      const e = frontierEntry(ds, m, f, 'lv50');
      return e.blocking.length ? [[m.uid, e.blocking[0]] as [string, string]] : [];
    }));
    const res = suggestTeam(ds, box, v, { rules: FRONTIER_RULES, size: f.register, uniqueSpecies: true, blocked });
    expect(res.team).toHaveLength(3);
    expect(new Set(res.team.map((c) => c.mon.species)).size).toBe(3);
    expect(res.team.some((c) => c.mon.uid === 'f')).toBe(false);
    expect(res.ranked.find((c) => c.mon.uid === 'f')?.reason).toMatch(/Generation I–III/);
  });

  it('flags a held item used twice (item clause)', () => {
    expect(itemClause(ds, [mon('Snorlax', 50, [], { item: 'leftovers' }), mon('Lapras', 50, [], { item: 'leftovers' })])).toEqual(['Leftovers']);
    expect(itemClause(ds, [mon('Snorlax', 50, [], { item: 'leftovers' })])).toEqual([]);
  });
});

describe('Battle Tower: endurance and carry-over', () => {
  const v: NpcTeamVariant = whirl.variants[0];

  it('values HP kept and sustain over a bare win', () => {
    const win = (hpLeftPct: number) => ({ score: 0, bestHit: { mult: 1 }, worstTaken: { mult: 1 }, duel: { mine: null, theirs: null, youFirst: true, win: true, hpLeftPct, score: 0 } });
    expect(enduranceScore(win(90), 0)).toBeGreaterThan(enduranceScore(win(20), 0));
    expect(enduranceScore(win(50), 10)).toBeGreaterThan(enduranceScore(win(50), 0));
    expect(sustainBonus(mon('Snorlax', 100, ['rest', 'bodyslam'], { item: 'leftovers' }))).toBe(13);
    expect(sustainBonus(mon('Snorlax', 100, ['bodyslam']))).toBe(0);
  });

  it('budgets the team HP over all 20 opponents', () => {
    const box = [mon('Snorlax', 100, ['bodyslam', 'earthquake']), mon('Jolteon', 100, ['thunderbolt', 'shadowball']), mon('Exeggutor', 100, ['gigadrain', 'psychic'])];
    const res = suggestTeam(ds, box, v, { rules: TOWER_RULES, endurance: true });
    const e = towerEndurance(res.team, v);
    expect(e.rows).toHaveLength(v.team.length);
    expect(e.budget).toBe(300);
    expect(e.total).toBe(e.spent.reduce((s, x) => s + x, 0));
  });

  const base = (over: Partial<BattleSnapshot>): BattleSnapshot => ({
    v: 2, at: 1, status: 'active', kind: 'tower', opponentName: 'Kimono Girl Zuki', turn: 1, moves: [], bench: [], opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], ...over,
  });

  it('remembers beaten opponents and your HP/PP across the attempt, and resets on a new one', () => {
    let run = updateRun(null, base({
      turn: 3, opponentTeam: [{ name: 'Golduck', active: false, fainted: true }],
      player: { name: 'Snorlax', hp: 300, maxHp: 400 }, moves: [{ name: 'Body Slam', pp: 2, maxPp: 24, disabled: false }],
      bench: [{ name: 'Jolteon', hp: 100, maxHp: 300, active: false, fainted: false }],
    }), whirl.id);
    // A later read whose team bar no longer lists Golduck still remembers it.
    run = updateRun(run, base({ turn: 9, opponentTeam: [{ name: 'Seaking', active: false, fainted: true }], player: { name: 'Snorlax', hp: 200, maxHp: 400 } }), whirl.id);
    expect(run.beaten).toEqual(['Golduck', 'Seaking']);
    const s = runSummary(run, v);
    expect(s).toMatchObject({ beaten: 2, total: 20, alive: 2 });
    expect(s.left).toHaveLength(18);
    expect(s.teamHpPct).toBe(43); // (200 + 100) / (400 + 300)
    expect(s.lowPp[0]).toMatch(/Body Slam \(Snorlax\) 2\/24/);
    // Turn counter went back: a new attempt.
    const fresh = updateRun(run, base({ turn: 1 }), whirl.id);
    expect(fresh.beaten).toEqual([]);
  });
});

describe('Battle tab under Gen III rules', () => {
  it('scores with Gen III data when switched on (no Fairy moves)', () => {
    document.body.innerHTML = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
    const snap = readBattle(document, 1)!;
    const local = structuredClone(ds);
    local.species[546] = { id: 546, name: 'Cottonee', types: ['Grass', 'Fairy'], baseStats: { hp: 40, atk: 27, def: 60, spa: 37, spd: 50, spe: 66 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
    const box: BoxMon[] = [{ uid: 'c', source: 'game', species: 546, level: 18, moves: ['fairywind', 'megadrain'], nature: 'Modest' }];
    const on = adviseTurn(local, snap, box, { gen3: true });
    expect(on.notes.some((n) => /Gen III/.test(n))).toBe(true);
    expect(on.actions.find((a) => a.moveId === 'fairywind')?.score ?? null).toBeNull();
    const off = adviseTurn(local, snap, box);
    expect(off.notes.some((n) => /Gen III/.test(n))).toBe(false);
  });
});

it('the calc library knows gen 3', () => {
  expect(Generations.get(3).num).toBe(3);
});
