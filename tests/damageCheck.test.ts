import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BattleEvent, BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { checkEvent, newEvents } from '../src/engine/damageCheck';
import { boxToCalc } from '../src/engine/damage';

const ds = structuredClone(fixture) as unknown as Dataset;
ds.species[387] = { id: 387, name: 'Turtwig', types: ['Grass'], baseStats: { hp: 55, atk: 68, def: 64, spa: 45, spd: 55, spe: 31 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const zero = iv(0);
const turtwig = (n: number): BoxMon => ({ uid: 'game:t', gameId: 't', source: 'game', species: 387, level: 14, moves: ['tackle', 'razorleaf'], nature: 'Hardy', ivs: iv(n), evs: zero });

// Battle 1, turn 4 (real): Turtwig 41/41 HP comes in, Onix (Lv14, 38/38) uses Rock Tomb for 12.
const before: BattleSnapshot = {
  v: 2, at: 0, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 4,
  player: { name: 'Turtwig', level: 14, hp: 41, maxHp: 41 },
  opponent: { name: 'Onix', level: 14, hp: 38, maxHp: 38 },
  moves: [{ name: 'Tackle', disabled: false }, { name: 'Razor Leaf', disabled: false }],
  bench: [{ name: 'Turtwig', level: 14, hp: 41, maxHp: 41, active: true, fainted: false }],
  opponentTeam: [{ name: 'Geodude', level: 12, hp: 0, maxHp: 35, active: false, fainted: true }, { name: 'Onix', level: 14, hp: 38, maxHp: 38, active: true, fainted: false }],
  boosts: { player: {}, opponent: {} }, log: [], events: [],
};
const rockTomb: BattleEvent = { idx: 12, turn: 4, side: 'opponent', mon: 'Onix', move: 'Rock Tomb', target: 'Turtwig', damage: 12, stages: { attacker: {}, target: {} } };

describe('calc check against the real battle log', () => {
  it('the page’s 41 max HP pins Turtwig’s HP IV to 12–18 (mainline HP formula)', () => {
    const hp = [0, 11, 12, 18, 19, 31].map((n) => boxToCalc(ds, turtwig(n)).maxHP());
    expect(hp).toEqual([39, 40, 41, 41, 42, 43]);
  });

  it('Onix Rock Tomb → Turtwig: the real 12 damage is inside the calc range', () => {
    const c = checkEvent(ds, [turtwig(15)], before, rockTomb)!;
    expect(c).toMatchObject({ attacker: 'Onix', target: 'Turtwig', damage: 12, capped: false });
    expect(c.lo).toBeLessThanOrEqual(12);
    expect(c.hi).toBeGreaterThanOrEqual(12);
    expect(c.verdict).toBe('ok');
  });

  it('a wrong set shows up as a set mismatch, not a formula miss', () => {
    expect(checkEvent(ds, [turtwig(31)], before, rockTomb)!.verdict).toBe('set-mismatch');
  });

  it('skips hits it cannot judge: Pokémon not in your box, misses, unusual wording', () => {
    expect(checkEvent(ds, [], before, rockTomb)).toBeNull();
    expect(checkEvent(ds, [turtwig(15)], before, { ...rockTomb, missed: true })).toBeNull();
    expect(checkEvent(ds, [turtwig(15)], before, { ...rockTomb, unusual: true })).toBeNull();
  });

  it('a KO hit only needs to be at most the calc maximum (game number is cut at the HP left)', () => {
    const low = { ...before, player: { ...before.player!, hp: 5 } };
    const c = checkEvent(ds, [turtwig(15)], low, { ...rockTomb, damage: 5, targetFainted: true })!;
    expect(c).toMatchObject({ capped: true, verdict: 'ok' });
  });

  it('new events only within the same battle', () => {
    const next = { ...before, turn: 5, events: [rockTomb] };
    expect(newEvents(before, next)).toEqual([rockTomb]);
    expect(newEvents(next, next)).toEqual([]);
    expect(newEvents({ ...next, opponentName: 'Misty' }, { ...next, events: [rockTomb, { ...rockTomb, idx: 20 }] })).toEqual([]);
    expect(newEvents(null, next)).toEqual([]);
  });
});
