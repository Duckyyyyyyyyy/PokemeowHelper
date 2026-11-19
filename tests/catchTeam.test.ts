import { describe, expect, it } from 'vitest';
import mini from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import type { RosterMon } from '../src/shared/battle';
import type { WildSnapshot } from '../src/shared/wild';
import { teamCatchPlan } from '../src/engine/catchTeam';

const ds = mini as unknown as Dataset;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, moves: string[], level: number): BoxMon => ({ uid: name, species: sp(name), moves, level, source: 'game' });
const member = (name: string, level: number, extra: Partial<RosterMon> = {}): RosterMon => ({ name, level, active: false, fainted: false, ...extra });
const live = (party: RosterMon[], extra: Partial<WildSnapshot> = {}): WildSnapshot => ({
  v: 1, at: 1, view: 'battle', name: 'Rattata', level: 10, shiny: false, balls: [], party, ...extra,
});
const rattata = { species: sp('Rattata'), level: 10 };

// The box holds strong catchers that are NOT on the team: they must not lead the plan.
const box = [
  mon('Scyther', ['falseswipe'], 40),
  mon('Breloom', ['spore'], 40),
  mon('Pidgey', ['tackle'], 8),
  mon('Bulbasaur', ['vinewhip', 'sleeppowder'], 10),
  mon('Squirtle', ['watergun', 'tackle'], 8),
  mon('Machamp', ['karatechop'], 60),
];

describe('catch plan from the team you carry', () => {
  it('lists your team first, active first, and keeps the box picks apart', () => {
    const w = live([member('Pidgey', 8), member('Bulbasaur', 10, { active: true, hp: 30, maxHp: 31 }), member('Squirtle', 8)]);
    const p = teamCatchPlan(ds, box, w, rattata);
    expect(p.source).toBe('team');
    expect(p.members.map((r) => r.name)).toEqual(['Bulbasaur', 'Pidgey', 'Squirtle']);
    const team = new Set(['Pidgey', 'Bulbasaur', 'Squirtle']);
    expect(p.team.weaken.length).toBeGreaterThan(0);
    expect(p.team.weaken.every((o) => team.has(o.monName))).toBe(true);
    expect(p.team.weaken[0].monName).toBe('Bulbasaur');
    expect(p.memberOf[p.team.weaken[0].uid]).toMatchObject({ name: 'Bulbasaur', active: true, hp: 30 });
    expect(p.team.status[0]).toMatchObject({ monName: 'Bulbasaur', moveName: 'Sleep Powder' });
    // The box's False Swipe and Spore stay in the box list.
    expect(p.box.weaken.some((o) => o.moveId === 'falseswipe')).toBe(true);
    expect(p.box.status.some((o) => o.moveId === 'spore')).toBe(true);
    expect(p.team.weaken.some((o) => o.moveId === 'falseswipe')).toBe(false);
  });

  it('skips fainted team members', () => {
    const w = live([member('Bulbasaur', 10, { active: true, hp: 0, maxHp: 31, fainted: true }), member('Squirtle', 8)]);
    const p = teamCatchPlan(ds, box, w, rattata);
    expect(p.members.map((r) => r.name)).toEqual(['Squirtle']);
    expect([...p.team.weaken, ...p.team.status].some((o) => o.monName === 'Bulbasaur')).toBe(false);
    expect(p.notes.join(' ')).toContain('Fainted, left out: Bulbasaur');
  });

  it('says plainly when no one on the team has a safe hit, with the gentlest hit and its KO chance', () => {
    // Machamp Lv 60 vs a Lv 10 Rattata at 20% HP: every hit can KO.
    const w = live([member('Machamp', 60, { active: true })]);
    const p = teamCatchPlan(ds, box, w, rattata, { hpPct: 20 });
    expect(p.team.weaken).toEqual([]);
    expect(p.weakenHint).toMatch(/^No safe hit on your team\. Gentlest: Machamp Karate Chop \d+–\d+% \(\d+% chance to KO it\)\.$/);
    expect(p.statusHint).toBe('No one on your team can put a status on it.');
  });

  it('suggests switching when only a benched member has the move', () => {
    const w = live([member('Machamp', 60, { active: true }), member('Bulbasaur', 10)]);
    const p = teamCatchPlan(ds, box, w, rattata, { hpPct: 20 });
    expect(p.statusHint).toBe('Machamp has no status move for it: switch to Bulbasaur (Sleep Powder, sleep).');
  });

  it('falls back to the box, with a note, when the team is not readable', () => {
    const p = teamCatchPlan(ds, box, null, rattata);
    expect(p.source).toBe('box');
    expect(p.notes[0]).toMatch(/team isn't readable/);
    expect(p.box.weaken[0].moveId).toBe('falseswipe');
  });
});
