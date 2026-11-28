import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, StatTable } from '../src/shared/types';
import { autoRole, evStatus, foeSpeeds, leanPlan, mainSide, natureAgainst, roleSpread, speedVerdict, trainRow } from '../src/engine/evRoles';
import { npcToCalc } from '../src/engine/damage';
import { statsAtLevel } from '../src/engine/potential';

const ds = fixture as unknown as Dataset;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const PERFECT = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (name: string, level: number, o: Partial<BoxMon> = {}): BoxMon =>
  ({ uid: `${name}-${level}`, species: sp(name), level, moves: [], source: 'game', ivs: PERFECT, evs: {}, ...o });
const y = (p: Partial<StatTable>): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p });

describe('roles from base stats (heuristic)', () => {
  it('walls: low attack, high defence', () => {
    expect(autoRole(ds, mon('Onix', 40))).toBe('pwall');
    expect(autoRole(ds, mon('Tentacruel', 40))).toBe('swall');
  });
  it('fast at base Speed 80+, bulky below', () => {
    expect(autoRole(ds, mon('Alakazam', 40, { moves: ['psychic'] }))).toBe('fast');
    expect(autoRole(ds, mon('Gengar', 40, { moves: ['shadowball'] }))).toBe('fast');
    expect(autoRole(ds, mon('Snorlax', 40, { moves: ['bodyslam'] }))).toBe('bulky');
  });
  it('attack side follows its damaging moves', () => {
    expect(mainSide(ds, mon('Arcanine', 50, { moves: ['flareblitz', 'extremespeed'] }))).toBe('atk');
    expect(mainSide(ds, mon('Arcanine', 50, { moves: ['flamethrower'] }))).toBe('spa');
  });
  it('spreads stay within 510', () => {
    for (const r of ['fast', 'bulky', 'pwall', 'swall'] as const) {
      const s = roleSpread(r, 'spa');
      expect(Object.values(s).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(510);
    }
    expect(roleSpread('fast', 'spa')).toEqual(y({ spa: 252, spe: 252 }));
  });
});

describe('EV status against a role', () => {
  const fastAtk = roleSpread('fast', 'atk');
  it('unknown when EVs are not known (typed by hand)', () => {
    expect(evStatus(mon('Arcanine', 50, { evs: undefined, source: 'manual' }), fastAtk).state).toBe('unknown');
  });
  it('done when every target stat is reached', () => {
    expect(evStatus(mon('Arcanine', 50, { evs: { atk: 252, spe: 252, hp: 6 } }), fastAtk).state).toBe('done');
  });
  it('grind lists what to raise', () => {
    const s = evStatus(mon('Arcanine', 50, { evs: { atk: 40, spe: 24 } }), fastAtk);
    expect(s.state).toBe('grind');
    expect(s.need).toBe(212 + 228);
    expect(s.raise).toEqual([{ stat: 'atk', from: 40, to: 252 }, { stat: 'spe', from: 24, to: 252 }]);
  });
  it('reset lowers only the overflow past 510, not all the extra', () => {
    const s = evStatus(mon('Arcanine', 50, { evs: { hp: 140, atk: 180 } }), fastAtk);
    expect(s.state).toBe('reset');
    expect(s.lower).toEqual([{ stat: 'hp', from: 140, to: 6 }]);
  });
  it('later below Lv 25 with work left', () => {
    expect(evStatus(mon('Pikachu', 14, { evs: { spe: 20 } }), roleSpread('fast', 'spa')).state).toBe('later');
  });
  it('low level: done stays done, and an overflow is later, not reset', () => {
    expect(evStatus(mon('Pikachu', 14, { evs: { spa: 252, spe: 252 } }), roleSpread('fast', 'spa')).state).toBe('done');
    const s = evStatus(mon('Pikachu', 14, { evs: { atk: 252, spe: 252 } }), roleSpread('fast', 'spa'));
    expect(s.state).toBe('later');
    expect(s.lower.length).toBeGreaterThan(0);
  });
});

describe('Train row role', () => {
  const gengar = mon('Gengar', 55, { moves: ['shadowball'], evs: {} });
  it('auto when nothing is saved', () => {
    const r = trainRow(ds, gengar, 'own', {});
    expect([r.role, r.auto]).toEqual(['fast', true]);
    expect(r.target).toEqual(y({ spa: 252, spe: 252 }));
  });
  it('a saved role beats auto', () => {
    const r = trainRow(ds, gengar, 'own', { [gengar.uid]: 'swall' });
    expect([r.role, r.auto]).toEqual(['swall', false]);
  });
  it('a role chip beats the saved role', () => {
    expect(trainRow(ds, gengar, 'bulky', { [gengar.uid]: 'swall' }).role).toBe('bulky');
  });
});

describe('nature against the role', () => {
  it('flags a nature that lowers a stat the role trains', () => {
    expect(natureAgainst('Modest', roleSpread('fast', 'atk'))).toBe('atk');
    expect(natureAgainst('Brave', roleSpread('fast', 'atk'))).toBe('spe');
  });
  it('ignores neutral, unknown and harmless natures', () => {
    expect(natureAgainst('Jolly', roleSpread('fast', 'atk'))).toBeNull();
    expect(natureAgainst('Hardy', roleSpread('fast', 'atk'))).toBeNull();
    expect(natureAgainst('random', roleSpread('fast', 'atk'))).toBeNull();
    expect(natureAgainst(undefined, roleSpread('fast', 'atk'))).toBeNull();
  });
});

describe('Lean: fewest Spe EVs to move first', () => {
  const arc = mon('Arcanine', 80, { nature: 'Jolly', moves: ['flareblitz'] });
  const speAt = (e: number) => statsAtLevel(ds, { ...arc, evs: { spe: e } }, 80).spe;

  it('passes the fastest foe it can reach with the fewest EVs (multiple of 4)', () => {
    const foes = [{ name: 'Slow', spe: speAt(0) - 10 }, { name: 'Target', spe: speAt(100) }, { name: 'Too fast', spe: speAt(252) + 5 }];
    const plan = leanPlan(ds, arc, 80, foes)!;
    expect(plan.foe.name).toBe('Target');
    const e = plan.spread.spe;
    expect(e % 4).toBe(0);
    expect(speAt(e)).toBeGreaterThan(foes[1].spe);
    expect(speAt(e - 4)).toBeLessThanOrEqual(foes[1].spe);
    expect(plan.spread.atk).toBe(252);
    expect(Object.values(plan.spread).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(510);
  });
  it('null when no foe needs Spe EVs or none can be passed', () => {
    expect(leanPlan(ds, arc, 80, [{ name: 'Slow', spe: speAt(0) - 1 }])).toBeNull();
    expect(leanPlan(ds, arc, 80, [{ name: 'Fast', spe: speAt(252) }])).toBeNull();
  });
  it('a tie is not moving first', () => {
    expect(speedVerdict(100, 100)).toBe('tie');
    expect(speedVerdict(101, 100)).toBe('faster');
  });
});

it('foe speeds come from the same calc as the damage scorer', () => {
  const v = ds.npcs.find((n) => n.id === 'challenge:brock')!.variants[0];
  expect(foeSpeeds(ds, v).map((f) => f.spe)).toEqual(v.team.map((n) => npcToCalc(ds, n).stats.spe));
});
