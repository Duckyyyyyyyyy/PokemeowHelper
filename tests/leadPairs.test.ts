import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { suggestTeam } from '../src/engine/teamSuggest';
import { leadPairs } from '../src/engine/leadPairs';

const ds = structuredClone(fixture) as unknown as Dataset;
const tate = ds.npcs.find((n) => n.name === 'Tate & Liza')!.variants[0];
const brock = ds.npcs.find((n) => n.name === 'Brock')!.variants[0];
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (uid: string, name: string, moves: string[]): BoxMon => ({ uid, species: sp(name), level: 45, moves, source: 'manual' });

describe('Team tab: doubles lead pairs', () => {
  const box = [
    mon('g', 'Golem', ['earthquake', 'rockslide', 'protect']),
    mon('c', 'Charizard', ['flamethrower', 'airslash', 'tailwind']),
    mon('s', 'Slowbro', ['surf', 'psychic']),
  ];
  const res = suggestTeam(ds, box, tate, { levelCap: tate.levelCap });

  it('rates pairs, crediting Earthquake next to a Flying partner and flagging a partner it hits', () => {
    const pairs = leadPairs(ds, res.team, tate, tate.levelCap);
    expect(pairs.length).toBe(3);
    const name = (p: (typeof pairs)[number]) => [p.a, p.b].map((c) => ds.species[c.mon.species].name).sort().join('+');
    const gc = pairs.find((p) => name(p) === 'Charizard+Golem')!;
    expect(gc.why.join(' ')).toMatch(/Golem's Earthquake can't hurt Charizard/);
    const gs = pairs.find((p) => name(p) === 'Golem+Slowbro')!;
    expect(gs.why.join(' ')).toMatch(/Earthquake also hits Slowbro|Surf also hits Golem/);
    expect(gc.why.join(' ')).toMatch(/Protect next to a spread move/);
    // Sorted best first, scores in range.
    expect(pairs[0].score).toBeGreaterThanOrEqual(pairs[1].score);
    for (const p of pairs) expect(p.score).toBeGreaterThanOrEqual(0);
  });

  it('singles NPCs get no pairs', () => {
    expect(leadPairs(ds, suggestTeam(ds, box, brock).team, brock)).toEqual([]);
  });
});
