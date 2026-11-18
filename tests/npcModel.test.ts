import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { boxToCalc, makeField, npcToCalc } from '../src/engine/damage';
import { predictNpcMove } from '../src/engine/npcModel';

const ds = structuredClone(fixture) as unknown as Dataset;
ds.species[387] = { id: 387, name: 'Turtwig', types: ['Grass'], baseStats: { hp: 55, atk: 68, def: 64, spa: 45, spd: 55, spe: 31 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
const iv = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const mon = (species: number, level: number): BoxMon => ({ uid: 'x', source: 'game', species, level, moves: [], nature: 'Hardy', ivs: iv(15), evs: iv(0) });
const field = makeField('singles');

describe('NPC move guess', () => {
  const brock = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0];
  const onix = brock.team[1]; // bind / rock throw / screech / rock tomb

  it('probabilities add up to 1, strongest damaging move first (Onix used Rock Tomb 3 of 4 times in the real battle)', () => {
    const g = predictNpcMove(ds, npcToCalc(ds, onix), boxToCalc(ds, mon(387, 14)), onix.moves, { field });
    expect(g.reduce((s, x) => s + x.prob, 0)).toBeCloseTo(1, 6);
    expect(['Rock Tomb', 'Rock Throw']).toContain(g[0].name);
    expect(g.find((x) => x.name === 'Screech')!.prob).toBeLessThan(g[0].prob);
  });

  it('a move that would KO becomes very likely', () => {
    const me = boxToCalc(ds, mon(387, 14));
    me.originalCurHP = 3;
    const g = predictNpcMove(ds, npcToCalc(ds, onix), me, onix.moves, { field });
    expect(g[0].ko).toBe('sure');
    expect(g[0].prob).toBeGreaterThan(0.3);
  });

  it('its first move on the field is likely a status move (seen live 4/4), later ones are mostly attacks', () => {
    const me = boxToCalc(ds, mon(387, 14));
    const first = predictNpcMove(ds, npcToCalc(ds, onix), me, onix.moves, { field, firstMove: true });
    const later = predictNpcMove(ds, npcToCalc(ds, onix), me, onix.moves, { field, usedThisBattle: ['screech'] });
    const screech = (g: typeof first) => g.find((x) => x.name === 'Screech')!.prob;
    const plain = predictNpcMove(ds, npcToCalc(ds, onix), me, onix.moves, { field });
    expect(screech(first)).toBeGreaterThan(1.5 * screech(plain));
    expect(screech(later)).toBeLessThan(screech(plain)); // not repeated
    expect(['Rock Tomb', 'Rock Throw']).toContain(later[0].name);
    // A status move that is useless now (you already have a status) is not boosted.
    const lance = ds.npcs.find((n) => n.id === 'challenge:kanto-lance')!.variants[0].team[2];
    const tw = predictNpcMove(ds, npcToCalc(ds, lance), boxToCalc(ds, mon(387, 50)), lance.moves, { field, firstMove: true, myStatus: 'par' });
    expect(tw.find((x) => x.name === 'Thunder Wave')!.prob).toBeLessThan(0.05);
  });

  it('a self-boost like Double Team can come again (Raichu and Pikachu each used it twice live), until maxed', () => {
    const pikachu = ds.npcs.find((n) => n.id === 'challenge:ltsurge')!.variants[0].team[1];
    const me = boxToCalc(ds, mon(387, 28));
    const dt = (g: ReturnType<typeof predictNpcMove>) => g.find((x) => x.name === 'Double Team')!.prob;
    const afterOne = predictNpcMove(ds, npcToCalc(ds, pikachu), me, pikachu.moves, { field, usedThisBattle: ['doubleteam'], foeBoosts: { evasion: 1 } });
    expect(dt(afterOne)).toBeGreaterThan(0.15); // was ~11% live, and it came again
    const maxed = predictNpcMove(ds, npcToCalc(ds, pikachu), me, pikachu.moves, { field, usedThisBattle: Array(6).fill('doubleteam'), foeBoosts: { evasion: 6 } });
    expect(dt(maxed)).toBeLessThan(0.02);
    // Screech on you still is not repeated.
    const voltorb = ds.npcs.find((n) => n.id === 'challenge:ltsurge')!.variants[0].team[0];
    const v = predictNpcMove(ds, npcToCalc(ds, voltorb), me, voltorb.moves, { field, usedThisBattle: ['screech'] });
    expect(v.find((x) => x.name === 'Screech')!.prob).toBeLessThan(0.15);
  });

  it('does not expect a status move on a Pokémon that already has a status', () => {
    const lance = ds.npcs.find((n) => n.id === 'challenge:kanto-lance')!.variants[0];
    const dragonair = lance.team[2]; // has Thunder Wave
    const me = boxToCalc(ds, mon(387, 50));
    const fresh = predictNpcMove(ds, npcToCalc(ds, dragonair), me, dragonair.moves, { field });
    const para = predictNpcMove(ds, npcToCalc(ds, dragonair), me, dragonair.moves, { field, myStatus: 'par' });
    const tw = (g: typeof fresh) => g.find((x) => x.name === 'Thunder Wave')!.prob;
    expect(tw(para)).toBeLessThan(tw(fresh) / 5);
  });
});
