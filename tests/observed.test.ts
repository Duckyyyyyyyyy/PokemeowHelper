// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { readBattle } from '../src/content/battleReader';
import { MAX_OBSERVED, npcKey, obsKey, observedForNpc, observedMoves, recordObserved, type ObservedStore } from '../src/engine/observed';
import { accuracyStageMul, adviseTurn, matchNpc } from '../src/engine/turnAdvisor';
import { boxToCalc, makeField, npcToCalc } from '../src/engine/damage';
import { guessNpcSwitch } from '../src/engine/npcModel';

const ds = structuredClone(fixture) as unknown as Dataset;
const add = (id: number, name: string, types: string[], b: number[]) => {
  ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
};
add(546, 'Cottonee', ['Grass', 'Fairy'], [40, 27, 60, 37, 50, 66]);
add(387, 'Turtwig', ['Grass'], [55, 68, 64, 45, 55, 31]);
add(532, 'Timburr', ['Fighting'], [75, 80, 55, 25, 35, 35]);
add(674, 'Pancham', ['Fighting'], [67, 82, 62, 46, 48, 43]);
add(841, 'Flapple', ['Grass', 'Dragon'], [70, 110, 80, 95, 60, 70]);

document.body.innerHTML = readFileSync(resolve(__dirname, 'fixtures/battle/brock-turn3.reconstructed.html'), 'utf8');
const snap = readBattle(document, 1)!;
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const box: BoxMon[] = [
  { uid: 'game:1', gameId: '1', source: 'game', species: 546, level: 18, moves: ['fairywind', 'stunspore', 'megadrain', 'razorleaf'], nature: 'Modest', ivs: iv(20), evs: iv(0) },
];
const BROCK = 'challenge:brock#firstbattle';

describe('battle-observed NPC moves', () => {
  const store = recordObserved(ds, {}, snap, 1000);

  it('records the opponent’s moves per trainer, team variant, Pokémon and level', () => {
    expect(npcKey(matchNpc(ds, snap), snap)).toBe(BROCK);
    expect(store[obsKey(BROCK, 'Geodude', 12)]).toMatchObject({ name: 'Geodude', level: 12, moves: ['defensecurl'], lastSeen: 1000 });
    expect(store[obsKey(BROCK, 'Onix', 14)].moves).toEqual(['screech']);
    // Your own moves are not recorded.
    expect(Object.values(store).flatMap((o) => o.moves)).not.toContain('megadrain');
  });

  it('is idempotent: the same snapshot twice changes nothing (panel reloads, repeated storage events)', () => {
    expect(recordObserved(ds, store, snap, 2000)).toBe(store);
  });

  it('a rematch (other variant) is kept apart from the first battle', () => {
    expect(observedMoves(store, 'challenge:brock#rematch', 'Onix', 61)).toEqual([]);
    expect(observedMoves(store, BROCK, 'Onix', 14)).toEqual(['screech']);
    expect(observedMoves(store, BROCK, 'Onix', 99)).toEqual(['screech']); // other level: falls back to any level
  });

  it('groups by Pokémon for the NPC tab', () => {
    const brock = ds.npcs.find((n) => n.id === 'challenge:brock')!;
    expect(observedForNpc(store, brock, brock.variants[0]).get('onix')).toEqual(['screech']);
    expect(observedForNpc(store, brock, brock.variants[1]).size).toBe(0);
  });

  it('skips Struggle, and moves called by Metronome-like moves', () => {
    const ev = (move: string) => ({ idx: 50, side: 'opponent' as const, mon: 'Onix', move, stages: { attacker: {}, target: {} } });
    const s1 = recordObserved(ds, store, { ...snap, events: [ev('Struggle')] });
    expect(s1).toBe(store);
    const metronomeDs = structuredClone(ds);
    metronomeDs.npcs.find((n) => n.id === 'challenge:brock')!.variants[0].team[1].moves = ['metronome', 'rockthrow'];
    expect(recordObserved(metronomeDs, {}, { ...snap, events: [ev('Earthquake')] })).toEqual({});
    expect(Object.keys(recordObserved(metronomeDs, {}, { ...snap, events: [ev('Rock Throw')] }))).toHaveLength(1);
  });

  it('keeps at most MAX_OBSERVED Pokémon, dropping the oldest', () => {
    const big: ObservedStore = {};
    for (let i = 0; i < MAX_OBSERVED; i++) big[`old|${i}|1`] = { name: `x${i}`, moves: ['tackle'], lastSeen: i };
    const next = recordObserved(ds, big, snap, 10_000);
    expect(Object.keys(next)).toHaveLength(MAX_OBSERVED);
    expect(next['old|0|1']).toBeUndefined();
    expect(next[obsKey(BROCK, 'Onix', 14)]).toBeDefined();
  });

  it('drops wild/player-battle entries before Gym/League ones, even newer ones', () => {
    const big: ObservedStore = { [obsKey(BROCK, 'Golem', 55)]: { name: 'Golem', moves: ['earthquake'], lastSeen: 0 } };
    for (let i = 0; i < MAX_OBSERVED; i++) big[`name:wild${i}#|x|1`] = { name: `x${i}`, moves: ['tackle'], lastSeen: 100 + i };
    const next = recordObserved(ds, big, snap, 10_000);
    expect(Object.keys(next)).toHaveLength(MAX_OBSERVED);
    expect(next[obsKey(BROCK, 'Golem', 55)]).toBeDefined();
    expect(next[obsKey(BROCK, 'Onix', 14)]).toBeDefined();
  });

  it('Transform/Mimic users: moves outside their set are not recorded', () => {
    const tds = structuredClone(ds);
    tds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0].team[1].moves = ['transform'];
    const ev = { idx: 50, side: 'opponent' as const, mon: 'Onix', move: 'Mega Drain', stages: { attacker: {}, target: {} } };
    expect(recordObserved(tds, {}, { ...snap, events: [ev] })).toEqual({});
  });
});

describe('turn advice uses battle-observed moves', () => {
  it('"seen in earlier battles" leaves out moves already used in this battle', () => {
    const observed = recordObserved(ds, {}, snap);
    expect(adviseTurn(ds, snap, box, { observed }).seenBefore).toBeUndefined(); // Screech was used this battle
  });

  it('known wiki set: a move seen before but not in the wiki set becomes a possible threat (set not overwritten)', () => {
    const observed: ObservedStore = { [obsKey(BROCK, 'Onix', 14)]: { name: 'Onix', level: 14, moves: ['stoneedge'], lastSeen: 1 } };
    const a = adviseTurn(ds, snap, box, { observed });
    expect(a.foe?.known).toBe(true);
    expect(a.foe?.mon.moves).not.toContain('stoneedge');
    expect(a.seenBefore).toEqual(['stoneedge']);
    expect(a.threat?.name).toBe('Stone Edge');
    expect(a.notes.join(' ')).toMatch(/seen using Stone Edge, which is not in the wiki set/);
    expect(adviseTurn(ds, snap, box).threat?.name).not.toBe('Stone Edge');
  });

  it('guessed set (trainer not in the wiki): moves seen in earlier battles fill the set first', () => {
    const stranger: BattleSnapshot = { ...snap, opponentName: 'Hiker Nobody', events: [] };
    const key = npcKey(undefined, stranger);
    const observed: ObservedStore = { [obsKey(key, 'Onix', 14)]: { name: 'Onix', level: 14, moves: ['earthquake'], lastSeen: 1 } };
    const a = adviseTurn(ds, stranger, box, { observed });
    expect(a.foe?.known).toBe(false);
    expect(a.foe?.mon.moves[0]).toBe('earthquake');
  });
});

describe('accuracy and evasion stages', () => {
  it('uses the Gen 5+ multipliers', () => {
    expect(accuracyStageMul(0)).toBe(1);
    expect(accuracyStageMul(1)).toBeCloseTo(4 / 3);
    expect(accuracyStageMul(-1)).toBeCloseTo(3 / 4);
    expect(accuracyStageMul(-6)).toBeCloseTo(1 / 3);
    expect(accuracyStageMul(9)).toBe(3);
  });

  it('their Evasion +1 lowers the score of your attacks (live: Kingdra used Double Team)', () => {
    const calm = adviseTurn(ds, snap, box);
    const evasive = adviseTurn(ds, { ...snap, boosts: { ...snap.boosts, opponent: { ...snap.boosts.opponent, evasion: 1 } } }, box);
    const md = (x: typeof calm) => x.actions.find((a) => a.label === 'Mega Drain')!;
    expect(md(evasive).reason).toMatch(/~75% to hit/);
    expect(md(evasive).score!).toBeLessThanOrEqual(md(calm).score!);
    // The worst-case threat is unchanged (stages only affect your hit chance here).
    expect(evasive.threat).toEqual(calm.threat);
  });

  it('a move with no accuracy value counts as always hitting (no NaN scores)', () => {
    const nds = structuredClone(ds);
    delete (nds.moves.megadrain as { accuracy?: unknown }).accuracy;
    const a = adviseTurn(nds, { ...snap, boosts: { ...snap.boosts, opponent: { evasion: 2 } } }, box);
    const md = a.actions.find((x) => x.label === 'Mega Drain')!;
    expect(Number.isFinite(md.score)).toBe(true);
    expect(md.reason).not.toMatch(/to hit/);
  });
});

describe('NPC switch guess', () => {
  const field = makeField('singles');
  const brock = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0];
  const me = boxToCalc(ds, { ...box[0], level: 19 });
  const onix = npcToCalc(ds, brock.team[1]);

  it('flags a switch when you KO it, it can’t KO you, and a teammate resists your hit (live: Juan pulled Whiscash)', () => {
    const flapple = npcToCalc(ds, { species: 841, name: 'Flapple', level: 14, moves: ['tackle'], baseStats: ds.species[841].baseStats });
    const g = guessNpcSwitch(ds, onix, me, ['megadrain', 'razorleaf'], brock.team[1].moves, [{ name: 'Flapple', calc: flapple }], field);
    expect(g?.to).toBe('Flapple');
    expect(g?.reason).toMatch(/can't win this 1v1/);
  });

  it('no guess when no teammate takes the hit better', () => {
    const geodude = npcToCalc(ds, brock.team[0]);
    expect(guessNpcSwitch(ds, onix, me, ['megadrain'], brock.team[1].moves, [{ name: 'Geodude', calc: geodude }], field)).toBeUndefined();
  });

  it('no guess when you cannot KO it', () => {
    const flapple = npcToCalc(ds, { species: 841, name: 'Flapple', level: 14, moves: ['tackle'], baseStats: ds.species[841].baseStats });
    expect(guessNpcSwitch(ds, onix, me, ['tackle'], brock.team[1].moves, [{ name: 'Flapple', calc: flapple }], field)).toBeUndefined();
  });
});
