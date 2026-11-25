import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { runLookahead } from '../src/engine/lookahead';
import { boxToCalc, makeField } from '../src/engine/damage';

const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const mon = (name: string, level: number, hpPct: number) => {
  const s = Object.values(ds.species).find((x) => x.name === name)!;
  const c = boxToCalc(ds, { uid: name, source: 'game', species: s.id, level, moves: [], nature: 'Hardy', ivs: iv(15), evs: iv(0) } as BoxMon);
  c.originalCurHP = Math.max(1, Math.round((c.maxHP() * hpPct) / 100));
  return c;
};

describe('a foe that drains back more HP than it had at the start of the search', () => {
  it('does not crash when every line loses (found by the 2026-11-25 simulation audit)', () => {
    const r = runLookahead({
      ds, field: makeField('singles'),
      mine: [
        { name: 'Geodude', calc: mon('Geodude', 20, 100), moves: ['tackle'] },
        { name: 'Onix', calc: mon('Onix', 20, 100), moves: ['tackle'] },
      ],
      foes: [{ name: 'Venusaur', calc: mon('Venusaur', 70, 10), moves: ['gigadrain'] }],
      depth: 3,
    });
    for (const v of r.values) {
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(v.line ?? '').not.toMatch(/undefined/);
    }
  });
});
