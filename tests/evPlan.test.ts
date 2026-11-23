import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import {
  EV_MAX_STAT, EV_MAX_TOTAL, STATS, attackSide, evPlanFor, koCount, npcEvBattles, npcEvTotal, spreadCandidates, wildEvSpots,
} from '../src/engine/evPlan';

const base = fixture as unknown as Dataset;
const sp = (name: string) => Object.values(base.species).find((s) => s.name === name)!.id;
const PERFECT = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (name: string, level: number, moves: string[], evs: Partial<StatTable> = {}): BoxMon =>
  ({ uid: `${name}-${level}`, species: sp(name), level, moves, source: 'game', ivs: PERFECT, evs });
const y = (p: Partial<StatTable>): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p });

// Yields as the wiki's EV Training table gives them (same numbers as the user's League rematch sheet).
const ds = structuredClone(base);
const YIELDS: Record<string, Partial<StatTable>> = {
  Golem: { def: 3 }, Relicanth: { hp: 1, def: 1 }, Omastar: { def: 2 }, Onix: { def: 1 }, Kabutops: { atk: 2 }, Rampardos: { atk: 2 },
  Zubat: { spe: 1 }, Geodude: { def: 1 }, Machamp: { atk: 3 },
};
for (const [n, v] of Object.entries(YIELDS)) ds.species[sp(n)].evYield = y(v);
ds.wild = {
  moonStone: [],
  maps: [
    { id: 'caves', name: 'Caves', theme: 'rock', levels: [20, 30], description: '', encounters: [
      { species: sp('Zubat'), rarity: 'common', method: 'walking', levels: [20, 25], day: 0.3, night: 0.3, labels: [], sections: [] },
      { species: sp('Geodude'), rarity: 'common', method: 'walking', levels: [20, 25], day: 0.3, night: 0.3, labels: [], sections: [] },
      { species: sp('Onix'), rarity: 'rare', method: 'walking', levels: [25, 30], day: 0.05, night: 0.05, labels: [], sections: [] },
    ] },
    { id: 'mtn', name: 'Mt. Ember', theme: 'fire', levels: [30, 40], description: '', encounters: [
      { species: sp('Golem'), rarity: 'rare', method: 'walking', levels: [35, 40], day: 0.05, night: 0.05, labels: [], sections: [] },
      { species: sp('Geodude'), rarity: 'common', method: 'walking', levels: [30, 35], day: 0.2, night: 0.2, labels: [], sections: [] },
    ] },
  ],
} as unknown as Dataset['wild'];

describe('EV yields per NPC battle', () => {
  it('Brock rematch: 1 HP, 4 Atk, 7 Def per win (golden, from the League rematch sheet)', () => {
    const rematch = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[1];
    expect(npcEvTotal(ds, rematch)).toEqual(y({ hp: 1, atk: 4, def: 7 }));
  });
  it('unknown yields (no EV data synced) give undefined, not zeros', () => {
    expect(npcEvTotal(base, ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[1])).toBeUndefined();
  });
  it('best NPC battles for a stat, most per win first', () => {
    const top = npcEvBattles(ds, 'def', 3);
    expect(top[0]).toMatchObject({ label: 'Rematch', amount: 7 });
    expect(top[0].npc.id).toBe('challenge:brock');
  });
});

describe('wild EV spots', () => {
  it('most of the stat first, then the commonest; maps merged', () => {
    const def = wildEvSpots(ds, 'def', 3);
    expect(def.map((s) => [s.name, s.amount])).toEqual([['Golem', 3], ['Geodude', 1], ['Onix', 1]]);
    expect(def[1].maps).toEqual(['Caves', 'Mt. Ember']);
    expect(wildEvSpots(ds, 'spe', 3).map((s) => s.name)).toEqual(['Zubat']);
    expect(wildEvSpots(base, 'spe', 3)).toEqual([]);
  });
  it('knockouts needed: plain, Power item (+8 each), Macho Brace (x2)', () => {
    expect(koCount(252, 1)).toEqual({ plain: 252, power: 28, brace: 126 });
    expect(koCount(252, 3)).toEqual({ plain: 84, power: 23, brace: 42 });
  });
});

describe('EV spread advice', () => {
  it('every spread stays within 252 per stat and 510 total', () => {
    for (const c of spreadCandidates(['atk', 'spa'])) {
      expect(STATS.every((k) => c.evs[k] <= EV_MAX_STAT)).toBe(true);
      expect(STATS.reduce((s, k) => s + c.evs[k], 0)).toBeLessThanOrEqual(EV_MAX_TOTAL);
    }
  });
  it('attack side from the damaging moves it uses', () => {
    expect(attackSide(ds, mon('Machamp', 40, ['karatechop', 'lowkick']))).toEqual(['atk']);
    expect(attackSide(ds, mon('Psyduck', 40, ['watergun', 'confusion']))).toEqual(['spa']);
  });
  it('scores the spreads vs the NPC and lists what to change from the current EVs', () => {
    const v = ds.npcs.find((n) => n.id === 'challenge:koga')!.variants[0];
    const m = mon('Machamp', 40, ['karatechop', 'lowkick'], { hp: 40, spd: 100 });
    const p = evPlanFor(ds, m, v);
    expect(p.best).toBe(p.ranked[0]);
    expect(p.best.wins).toBeGreaterThanOrEqual(p.now.wins);
    for (const r of p.ranked.slice(1)) expect(r.wins * 1000 + r.avg).toBeLessThanOrEqual(p.best.wins * 1000 + p.best.avg);
    // Changes take the current EVs to the best spread exactly.
    const after = { ...p.now.evs };
    for (const c of p.changes) {
      expect(c.from).toBe(p.now.evs[c.stat]);
      after[c.stat] = c.to;
    }
    expect(after).toEqual(p.best.evs);
    // Already holding the best spread: nothing to change, no improvement claimed.
    const done = evPlanFor(ds, { ...m, evs: p.best.evs }, v);
    expect(done.changes).toEqual([]);
    expect(done.improves).toBe(false);
  });
});
