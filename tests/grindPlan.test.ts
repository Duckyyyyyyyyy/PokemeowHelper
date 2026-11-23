import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { grindLadder, ladderLevels, teamGrindPlan } from '../src/engine/grindPlan';
import { suggestTeam, outcomeOf } from '../src/engine/teamSuggest';

const ds = fixture as unknown as Dataset;
const npc = (id: string) => ds.npcs.find((n) => n.id === id)!;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const PERFECT = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon =>
  ({ uid: `${name}-${level}`, species: sp(name), level, moves, source: 'game', ivs: PERFECT, evs: {}, ...extra });

const KOGA = npc('challenge:koga').variants[0]; // cap 48: Koffing 37, Muk 39, Koffing 37, Weezing 43

describe('grind ladder', () => {
  const evo = structuredClone(ds);
  const [c1, c2, c3] = [sp('Charmander'), sp('Charmeleon'), sp('Charizard')];
  evo.species[c1].evolvesTo = [{ to: c2, methods: ['Level 16 or higher'], level: 16 }];
  evo.species[c2].evolvesTo = [{ to: c3, methods: ['Level 36 or higher'], level: 36 }];

  it('levels: now, every 5, each evolution level, and exactly the target', () => {
    expect(ladderLevels(evo, mon('Charmander', 12), 12, 48)).toEqual([12, 15, 16, 20, 25, 30, 35, 36, 40, 45, 48]);
    expect(ladderLevels(ds, mon('Psyduck', 40), 40, 48)).toEqual([40, 45, 48]);
  });

  it('shows where it evolves and how its wins change on the way to the cap', () => {
    const lad = grindLadder(evo, mon('Charmander', 12, ['scratch', 'ember']), KOGA)!;
    expect(lad.from).toBe(12);
    expect(lad.target).toBe(48);
    expect(lad.steps.find((r) => r.level === 16)?.evolvedTo).toBe(c2);
    expect(lad.steps.find((r) => r.level === 36)?.evolvedTo).toBe(c3);
    expect(lad.steps[lad.steps.length - 1].level).toBe(48);
    // Wins only from the rung's own pairs, by the card header's rule.
    for (const r of lad.all) expect(r.won).toEqual(r.pairs.map((p, j) => (outcomeOf(p) === 'win' ? j : -1)).filter((j) => j >= 0));
    expect(lad.all[lad.all.length - 1].won.length).toBeGreaterThan(lad.start.won.length);
    // A step's "gained" names are exactly the wins new since the rung before.
    for (let i = 1; i < lad.all.length; i++) {
      const before = lad.all[i - 1].won;
      expect(lad.all[i].gained).toEqual(lad.all[i].won.filter((j) => !before.includes(j)).map((j) => KOGA.team[j].name));
    }
  });

  it('no ladder at or above the fight level, or with no level', () => {
    expect(grindLadder(ds, mon('Psyduck', 48, ['watergun']), KOGA)).toBeNull();
    expect(grindLadder(ds, { ...mon('Psyduck', 30), level: undefined }, KOGA)).toBeNull();
  });
});

describe('team grind plan', () => {
  const box = [mon('Psyduck', 20, ['watergun', 'confusion']), mon('Abra', 18, ['teleport']), mon('Geodude', 22, ['tackle'])];
  const ready = suggestTeam(ds, box, KOGA, { levelCap: 48 });
  const ladders = new Map(ready.team.map((c) => [c.mon.uid, grindLadder(ds, c.mon, KOGA)!]).filter(([, l]) => l) as [string, NonNullable<ReturnType<typeof grindLadder>>][]);
  const plan = teamGrindPlan(ready.team, ladders, KOGA, ds);

  it('starts from the card header count and only moves up', () => {
    const header = KOGA.team.filter((_, j) => ready.team.some((c) => outcomeOf(c.pairs[j]) === 'win')).length;
    expect(plan.now).toBe(header);
    let last = plan.now;
    for (const s of plan.steps) {
      expect(s.answers).toBeGreaterThan(last);
      expect(s.toLevel).toBeGreaterThan(s.from);
      expect(s.toLevel).toBeLessThanOrEqual(48);
      expect(s.beats.length).toBe(s.answers - last);
      last = s.answers;
    }
    expect(last + plan.unreachable.length).toBe(KOGA.team.length);
  });

  it('a step names a level on that member\'s ladder where the team really gains', () => {
    for (const s of plan.steps) expect(ladders.get(s.uid)!.all.some((r) => r.level === s.toLevel)).toBe(true);
  });
});
