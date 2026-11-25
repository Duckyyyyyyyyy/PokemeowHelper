import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, NpcMon } from '../src/shared/types';
import { boxToCalc, npcToCalc } from '../src/engine/damage';
import { runLookahead, type LookMon, type RootValue } from '../src/engine/lookahead';

// Battle audit 2026-11-25 (scripts/audit): the leaf counted only the active Pokémon's HP and capped every line
// that lost a Pokémon, so switching was overrated. It now counts both teams, over the whole battle.
const ds = structuredClone(fixture) as unknown as Dataset;
const sp = (n: string) => Object.values(ds.species).find((s) => s.name === n)!;
const at = <T extends LookMon>(m: T, pct: number): T => {
  m.calc.originalCurHP = Math.max(1, Math.round((m.calc.maxHP() * pct) / 100));
  return m;
};
const mine = (n: string, lv: number, moves: string[], pct = 100): LookMon =>
  at({ name: n, calc: boxToCalc(ds, { uid: n, species: sp(n).id, level: lv, moves, source: 'game', nature: 'Hardy' } as BoxMon), moves }, pct);
const foe = (n: string, lv: number, moves: string[], pct = 100): LookMon =>
  at({ name: n, calc: npcToCalc(ds, { species: sp(n).id, name: n, level: lv, moves, baseStats: sp(n).baseStats } as NpcMon), moves }, pct);
const id = (v: RootValue) => (v.action.kind === 'move' ? v.action.moveId : `switch:${v.action.to}`);
const run = (m: LookMon[], f: LookMon[]) => [...runLookahead({ ds, mine: m, foes: f }).values].sort((a, b) => b.score - a.score);

describe('switch scoring counts the whole team', () => {
  it('a hurt Pokémon that KOs for sure stays in, a fresh teammate does not get the KO', () => {
    const v = run(
      [mine('Vaporeon', 50, ['surf', 'bite'], 30), mine('Snorlax', 55, ['bodyslam', 'earthquake'])],
      [foe('Golem', 45, ['tackle'], 15), foe('Pikachu', 45, ['quickattack'])],
    );
    expect(id(v[0])).toBe('surf');
  });

  it('a Pokémon about to faint goes down instead of a teammate taking a big hit to save it', () => {
    // Snorlax (3% HP) falls to anything; Blastoise comes in free after it, or takes Earthquake switching in.
    const v = run(
      [mine('Snorlax', 45, ['bodyslam'], 3), mine('Blastoise', 45, ['waterpulse'])],
      [foe('Golem', 50, ['earthquake'], 60)],
    );
    expect(id(v[0])).not.toMatch(/^switch/);
  });

  it('but a healthy Pokémon that can do nothing still switches to the one that wins', () => {
    const v = run(
      [mine('Pikachu', 45, ['thundershock']), mine('Vaporeon', 45, ['surf'])],
      [foe('Golem', 45, ['earthquake', 'rockslide'])],
    );
    expect(id(v[0])).toBe('switch:1');
  });

  it('a sure KO now beats a weaker move with the KO a turn later', () => {
    const v = run(
      [mine('Vaporeon', 50, ['surf', 'bite']), mine('Snorlax', 50, ['bodyslam'])],
      [foe('Golem', 45, ['tackle'], 40), foe('Gengar', 50, ['shadowball']), foe('Pikachu', 50, ['thunderbolt'])],
    );
    expect(id(v[0])).toBe('surf');
    expect(v.find((x) => id(x) === 'bite')!.rank).toBeLessThan(v[0].rank);
  });

  it('the scores keep the order of the ranking value', () => {
    const v = run(
      [mine('Machamp', 50, ['brickbreak', 'crosschop', 'rockslide'], 60), mine('Vaporeon', 50, ['surf'], 50), mine('Gengar', 50, ['shadowball'], 80)],
      [foe('Snorlax', 50, ['bodyslam'], 70), foe('Golem', 50, ['earthquake'])],
    );
    for (let i = 1; i < v.length; i++) expect(v[i - 1].rank).toBeGreaterThanOrEqual(v[i].rank);
  });
});
