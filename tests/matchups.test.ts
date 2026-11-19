import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { hardestFoes, outcomeOf, suggestTeam } from '../src/engine/teamSuggest';

const ds = fixture as unknown as Dataset;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const box = (name: string, level: number): BoxMon => ({ uid: name, species: sp(name), moves: [], level });

describe('matchups in words, big rosters', () => {
  const tower = ds.npcs.find((n) => n.id === 'tower:whirl-tower')!.variants[0];
  const mons = ['Pikachu', 'Raichu', 'Venusaur', 'Electrode', 'Magnezone', 'Golem'].filter((n) => Object.values(ds.species).some((s) => s.name === n)).map((n) => box(n, 100));
  const res = suggestTeam(ds, mons, tower, { levelCap: tower.levelCap });

  it('the Whirl Tower has 20 Pokémon: the hardest list covers all, hardest first', () => {
    expect(tower.team.length).toBe(20);
    const rows = hardestFoes(res.team, tower.team.length, true);
    expect(rows.length).toBe(20);
    expect(new Set(rows.map((r) => r.index)).size).toBe(20);
    for (let i = 1; i < rows.length; i++) expect(rows[i].wins).toBeGreaterThanOrEqual(rows[i - 1].wins);
    for (const r of rows) {
      expect(r.best).toBeDefined();
      expect(r.wins).toBeLessThanOrEqual(res.team.length);
    }
  });

  it('outcome words follow the duel when there is one', () => {
    const p = res.team[0].pairs[0];
    const o = outcomeOf(p, true);
    expect(['win', 'close', 'lose']).toContain(o);
    if (p.duel) expect(o === 'win').toBe(p.duel.win);
  });
});
