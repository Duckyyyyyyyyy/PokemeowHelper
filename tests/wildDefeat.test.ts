import { describe, expect, it } from 'vitest';
import mini from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import type { WildSnapshot } from '../src/shared/wild';
import { defeatPlan, wildBattleSnapshot, wildOpponent, wildParty } from '../src/engine/wildDefeat';

const ds = mini as unknown as Dataset;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, moves: string[], level: number): BoxMon => ({ uid: name, species: sp(name), moves, level, source: 'game' });
const wild = (extra: Partial<WildSnapshot> = {}): WildSnapshot => ({
  v: 1, at: 1, view: 'intro', name: 'Geodude', level: 12, shiny: false, balls: [],
  lead: { name: 'Squirtle', level: 20, hp: 50, maxHp: 50 }, ...extra,
});

describe('wild opponent for the Battle engine', () => {
  it('keeps exact HP, or turns an HP-bar read into a 0–100 scale', () => {
    expect(wildOpponent(wild({ hp: 20, maxHp: 34, status: 'par' }))).toMatchObject({ name: 'Geodude', level: 12, hp: 20, maxHp: 34, status: 'par' });
    expect(wildOpponent(wild({ hpPct: 42.4 }))).toMatchObject({ hp: 42, maxHp: 100 });
    expect(wildOpponent(wild())).not.toHaveProperty('hp');
  });

  it('builds a singles snapshot with no trainer, your moves from the box', () => {
    const box = [mon('Squirtle', ['watergun', 'tackle', 'tailwhip'], 20)];
    const snap = wildBattleSnapshot(ds, box, wild(), wildParty(wild())[0]);
    expect(snap).toMatchObject({ status: 'active', kind: 'wild', format: 'singles' });
    expect(snap.opponentName).toBeUndefined();
    expect(snap.player).toMatchObject({ name: 'Squirtle', level: 20, hp: 50, maxHp: 50 });
    expect(snap.moves.map((m) => m.name)).toEqual(expect.arrayContaining(['Water Gun', 'Tackle']));
  });

  it('uses the battle move buttons for the active Pokémon when the battle runs', () => {
    const w = wild({ view: 'battle', moves: [{ name: 'Bubble', disabled: false }, { name: 'Bite', disabled: true }] });
    const snap = wildBattleSnapshot(ds, [mon('Squirtle', ['watergun'], 20)], w, wildParty(w)[0]);
    expect(snap.moves.map((m) => m.name)).toEqual(['Bubble']);
  });
});

describe('party order and fainted Pokémon', () => {
  it('puts the active one first and falls back to the lead', () => {
    const w = wild({ party: [
      { name: 'Pidgey', level: 15, hp: 40, maxHp: 40, active: false, fainted: false },
      { name: 'Squirtle', level: 20, hp: 50, maxHp: 50, active: true, fainted: false },
    ] });
    expect(wildParty(w).map((r) => r.name)).toEqual(['Squirtle', 'Pidgey']);
    expect(wildParty(wild()).map((r) => r.name)).toEqual(['Squirtle']);
  });

  it('skips fainted Pokémon in the plan', () => {
    const w = wild({ party: [
      { name: 'Squirtle', level: 20, hp: 0, maxHp: 50, active: true, fainted: true },
      { name: 'Bulbasaur', level: 20, hp: 45, maxHp: 45, active: false, fainted: false },
    ] });
    const plan = defeatPlan(ds, [mon('Squirtle', ['watergun'], 20), mon('Bulbasaur', ['vinewhip', 'tackle'], 20)], w);
    expect(plan.options.map((o) => o.member.name)).toEqual(['Bulbasaur']);
  });
});

describe('picking moves to defeat it', () => {
  it('ranks super-effective moves first and guesses the wild moves from its learnset at its level', () => {
    const box = [mon('Squirtle', ['tackle', 'watergun', 'tailwhip'], 20)];
    const plan = defeatPlan(ds, box, wild());
    const best = plan.options[0].moves[0];
    expect(best.label).toBe('Water Gun');
    expect(best.eff).toBe('×4');
    expect(best.minPct).toBeGreaterThan(0);
    expect(plan.options[0].guessed).toBe(false);
    // Geodude's guess: only damaging level-up moves it knows by Lv 12.
    const geo = ds.species[sp('Geodude')];
    const learnable = new Set(geo.levelMoves.filter(([, l]) => l <= 12).map(([id]) => id));
    expect(plan.foe!.moves.length).toBeGreaterThan(0);
    expect(plan.foe!.moves.every((id) => learnable.has(id) && ds.moves[id].category !== 'Status')).toBe(true);
    expect(plan.options[0].threat).toBeDefined();
  });

  it('reports a KO from low live HP', () => {
    const box = [mon('Squirtle', ['watergun'], 20)];
    const plan = defeatPlan(ds, box, wild({ hpPct: 5 }));
    expect(plan.options[0].moves[0].ko).toBe('sure');
  });

  it('has no options when every Pokémon is down', () => {
    expect(defeatPlan(ds, [], wild({ lead: { name: 'Squirtle', level: 20, hp: 0, maxHp: 50 } })).options).toEqual([]);
  });

  it('guesses moves from the learnset for a team member that is not in your box', () => {
    const plan = defeatPlan(ds, [], wild({ lead: { name: 'Charmander', level: 20, hp: 45, maxHp: 45 } }));
    expect(plan.options[0].guessed).toBe(true);
    expect(plan.options[0].moves.length).toBeGreaterThan(0);
  });
});
