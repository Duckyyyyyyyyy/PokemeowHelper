// @vitest-environment happy-dom
// Cross-feature checks for the 0.11 merge: lookahead × Battle Frontier/Tower × doubles × battle items.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Move, Pokemon, calculate } from '@smogon/calc';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { readBattle } from '../src/content/battleReader';
import { boxToCalc, damageRolls } from '../src/engine/damage';
import { GEN3, gen3View } from '../src/engine/gen3';
import { runLookahead, type LookMon } from '../src/engine/lookahead';
import { CRIT_TABLE, CRIT_TABLE_GEN3, critInfo } from '../src/engine/moveEffects';
import { adviseTurn, type TurnAdvice } from '../src/engine/turnAdvisor';

const ds = structuredClone(fixture) as unknown as Dataset;
ds.species[546] = { id: 546, name: 'Cottonee', types: ['Grass', 'Fairy'], baseStats: { hp: 40, atk: 27, def: 60, spa: 37, spd: 50, spe: 66 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
const g3 = gen3View(ds);
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon => ({
  uid: `${name}-${level}`, species: sp(name), level, moves, source: 'game', nature: 'Hardy', ivs: iv(31), evs: iv(0), ...extra,
});
const fixtureHtml = (f: string) => readFileSync(resolve(__dirname, 'fixtures/battle', f), 'utf8');
const read = (f: string) => {
  document.body.innerHTML = fixtureHtml(f);
  return readBattle(document, 1)!;
};
const brock = read('brock-turn3.reconstructed.html');
const cottonee: BoxMon[] = [
  { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: iv(0) },
];
const hurt = (s: BattleSnapshot, pct: number): BattleSnapshot => ({ ...s, player: { ...s.player!, hp: Math.round(s.player!.maxHp! * pct) } });
/** The lookahead ran: its KO odds are on the damaging move rows (the cheap path leaves them out). */
const lookedAhead = (a: TurnAdvice) => a.actions.some((x) => x.kind === 'move' && x.koChance !== undefined);
const items = (a: TurnAdvice) => a.actions.filter((x) => x.kind === 'item');
const bag = new Map([['potion', 3], ['superpotion', 2]]);

describe('Frontier + lookahead: the search uses Gen III damage and crits', () => {
  const gengar = mon('Gengar', 50, ['shadowball'], { nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 0 } });
  const alakazam = mon('Alakazam', 50, ['psychic']);

  it('damageRolls (the lookahead calc) follows the attacker generation, crits included', () => {
    const raw = calculate(GEN3, new Pokemon(GEN3, 'Gengar', { level: 50, nature: 'Timid', evs: { spa: 252 } }), new Pokemon(GEN3, 'Alakazam', { level: 50 }), new Move(GEN3, 'Shadow Ball'));
    const rolls = damageRolls(g3, boxToCalc(g3, gengar), boxToCalc(g3, alakazam), 'shadowball')!;
    expect([rolls[0], rolls[rolls.length - 1]]).toEqual(raw.range());
    const rawCrit = calculate(GEN3, new Pokemon(GEN3, 'Gengar', { level: 50, nature: 'Timid', evs: { spa: 252 } }), new Pokemon(GEN3, 'Alakazam', { level: 50 }), new Move(GEN3, 'Shadow Ball', { isCrit: true }));
    const crit = damageRolls(g3, boxToCalc(g3, gengar), boxToCalc(g3, alakazam), 'shadowball', undefined, true)!;
    expect([crit[0], crit[crit.length - 1]]).toEqual(rawCrit.range());
    // Gen 9 (special Shadow Ball from 130 SpA) differs.
    const r9 = damageRolls(ds, boxToCalc(ds, gengar), boxToCalc(ds, alakazam), 'shadowball')!;
    expect(r9[r9.length - 1]).not.toBe(rolls[rolls.length - 1]);
  });

  it('Gen III crit table: 1/16 at stage 0 and ×2, vs 1/24 and ×1.5 in Gen 9', () => {
    const c3 = critInfo(g3, boxToCalc(g3, gengar), boxToCalc(g3, alakazam), 'shadowball');
    expect(c3).toMatchObject({ chance: CRIT_TABLE_GEN3.chance[0], mul: 2, always: false });
    expect(c3.chance).toBeCloseTo(1 / 16);
    const c9 = critInfo(ds, boxToCalc(ds, gengar), boxToCalc(ds, alakazam), 'shadowball');
    expect(c9).toMatchObject({ chance: CRIT_TABLE.chance[0], mul: 1.5 });
  });

  it('the lookahead engine plays Gen III numbers (crit odds and KO odds)', () => {
    const L = (d: Dataset, m: BoxMon): LookMon => ({ name: d.species[m.species].name, calc: boxToCalc(d, m), moves: m.moves });
    const on = runLookahead({ ds: g3, mine: [L(g3, gengar)], foes: [L(g3, alakazam)], depth: 2 });
    const off = runLookahead({ ds, mine: [L(ds, gengar)], foes: [L(ds, alakazam)], depth: 2 });
    expect(on.engine.hitOdds(0, 'shadowball')!.crit).toBeCloseTo(1 / 16);
    expect(off.engine.hitOdds(0, 'shadowball')!.crit).toBeCloseTo(1 / 24);
  });

  it('adviseTurn with the Gen III switch still looks ahead, with Gen III data (no Fairy move scored)', () => {
    const snap = { ...brock, kind: undefined, opponentName: 'Frontier Trainer' };
    const a = adviseTurn(ds, snap, cottonee, { gen3: true, items: bag });
    expect(a.notes.some((n) => /Gen III/.test(n))).toBe(true);
    expect(lookedAhead(a)).toBe(true);
    expect(a.actions.find((x) => x.moveId === 'fairywind')?.score ?? null).toBeNull();
    // Frontier: no Bag items, even with a bag.
    expect(items(a)).toEqual([]);
  });
});

describe('Battle Tower: carry-over HP, no item rows, lookahead still on', () => {
  const tower = (pct: number) => hurt({ ...brock, kind: 'tower', opponentName: 'Tower Trainer' }, pct);

  it('no item rows with medicine in the bag, and the Tower note', () => {
    const a = adviseTurn(ds, tower(0.3), cottonee, { items: bag });
    expect(items(a)).toEqual([]);
    expect(a.notes.some((n) => /Battle Towers/.test(n))).toBe(true);
    expect(lookedAhead(a)).toBe(true);
    // The same battle outside a Tower offers the Potion.
    const gym = adviseTurn(ds, hurt({ ...brock, kind: undefined, opponentName: 'Someone' }, 0.3), cottonee, { items: bag });
    expect(items(gym).length).toBeGreaterThan(0);
  });

  it('the lookahead reads the carried-over HP: their KO odds rise as your HP drops', () => {
    const full = adviseTurn(ds, tower(1), cottonee);
    const low = adviseTurn(ds, tower(0.05), cottonee);
    expect(full.threat?.koChance).toBeTypeOf('number');
    expect(low.threat!.koChance!).toBeGreaterThan(full.threat!.koChance!);
  });

  it('a move carried over at 0 PP is out of the lookahead rows', () => {
    const snap = tower(1);
    const noPp = { ...snap, moves: snap.moves.map((m) => (/mega drain/i.test(m.name) ? { ...m, pp: 0, disabled: true } : m)) };
    const a = adviseTurn(ds, noPp, cottonee);
    const md = a.actions.find((x) => x.moveId === 'megadrain')!;
    expect(md.score).toBeNull();
    expect(md.koChance).toBeUndefined();
    expect(lookedAhead(a)).toBe(true);
  });
});

describe('doubles: the singles lookahead never runs', () => {
  const tl = read('tate-liza-doubles-turn1.reconstructed.html');

  it('a doubles snapshot forced through adviseTurn stays on the one-turn projection', () => {
    expect(tl.format).toBe('doubles');
    const a = adviseTurn(ds, tl, []);
    expect(lookedAhead(a)).toBe(false);
    expect(a.actions.every((x) => x.line === undefined && x.koChance === undefined)).toBe(true);
    expect(a.threat?.koChance).toBeUndefined();
  });

  it('the same reader output marked singles does look ahead (the gate is the doubles check)', () => {
    const a = adviseTurn(ds, brock, cottonee);
    expect(lookedAhead(a)).toBe(true);
  });
});

describe('doubles under Gen III rules (smoke)', () => {
  it('adviseDoubles with the Gen III switch still scores rows', async () => {
    const { adviseDoubles } = await import('../src/engine/doublesAdvisor');
    const tl = read('tate-liza-doubles-turn1.reconstructed.html');
    const on = adviseDoubles(ds, { ...tl, kind: undefined, opponentName: 'Frontier Pair' }, [], { gen3: true, movesByMon: { slowbro: ['Surf', 'Psychic'] } });
    expect(on.mine[0]?.actions.some((x) => x.score !== null)).toBe(true);
  });
});

describe('itemAdvisor under lookahead', () => {
  it('item rows are still offered, rebased onto the lookahead scale (same gain over the best attack)', () => {
    const snap = hurt(brock, 0.3);
    const cheap = adviseTurn(ds, snap, cottonee, { items: bag, lookahead: 0 });
    const deep = adviseTurn(ds, snap, cottonee, { items: bag });
    expect(lookedAhead(deep)).toBe(true);
    const bestMove = (a: TurnAdvice) => Math.max(...a.actions.filter((x) => x.kind === 'move').map((x) => x.score ?? -1));
    const ci = items(cheap);
    const di = items(deep);
    expect(di.map((x) => x.label)).toEqual(ci.map((x) => x.label));
    expect(di.length).toBeGreaterThan(0);
    for (let i = 0; i < ci.length; i++) {
      const gainCheap = ci[i].score! - bestMove(cheap);
      const gainDeep = di[i].score! - bestMove(deep);
      // Clamped at 0–100 and rounded; otherwise the same gain over plan A.
      if (di[i].score! > 0 && di[i].score! < 100) expect(Math.abs(gainDeep - gainCheap)).toBeLessThanOrEqual(1);
    }
  });

  it('a self-KO move (Explosion) does not drag item rows down (plan A = moves the lookahead plays)', () => {
    const geo: BoxMon[] = [{ ...mon('Graveler', 25, ['explosion', 'tackle']), uid: 'geo' }];
    // Explosion KOs the Onix at 9 HP now (its one-turn score is ~100 before the self-KO cap); Tackle doesn't.
    const s2: BattleSnapshot = {
      ...brock, player: { ...brock.player!, name: 'Graveler', level: 25, item: undefined, hp: 21, maxHp: 70 }, opponent: { ...brock.opponent!, hp: 9 },
      moves: [{ name: 'Explosion', pp: 5, maxPp: 5, disabled: false }, { name: 'Tackle', pp: 35, maxPp: 35, disabled: false }],
    };
    const cheap = adviseTurn(ds, s2, geo, { items: bag, lookahead: 0 });
    const deep = adviseTurn(ds, s2, geo, { items: bag });
    const tackle = (a: TurnAdvice) => a.actions.find((x) => x.moveId === 'tackle')!.score!;
    expect(items(deep).length).toBeGreaterThan(0);
    for (const it of items(deep)) {
      const c = items(cheap).find((x) => x.label === it.label)!;
      if (it.score! > 0 && it.score! < 100) expect(Math.abs((it.score! - tackle(deep)) - (c.score! - tackle(cheap)))).toBeLessThanOrEqual(1);
    }
  });

  it('no medicine in Player Battles under lookahead either', () => {
    const a = adviseTurn(ds, hurt({ ...brock, kind: 'player battle' }, 0.3), cottonee, { items: bag });
    expect(items(a)).toEqual([]);
  });
});
