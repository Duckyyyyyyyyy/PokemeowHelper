import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { boxToCalc, duel, npcToCalc } from '../src/engine/damage';
import { scorePair, suggestTeam } from '../src/engine/teamSuggest';
import { suggestMoveset } from '../src/engine/moveset';
import { CHALLENGE_RULES, NORMAL_RULES, TOWER_RULES, rulesFor } from '../src/engine/rules';
import { teamToText } from '../src/ui/teamPrefs';

const ds = structuredClone(fixture) as unknown as Dataset;
ds.species[292] = {
  id: 292, name: 'Shedinja', types: ['Bug', 'Ghost'], baseStats: { hp: 1, atk: 90, def: 45, spa: 30, spd: 30, spe: 40 },
  abilities: [{ id: 'wonderguard', name: 'Wonder Guard', hidden: false }], levelMoves: [], machineMoves: [], eggMoves: [],
};
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon => ({
  uid: name, species: sp(name), level, moves, source: 'game', nature: 'Hardy',
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ...extra,
});
const lance = ds.npcs.find((n) => n.id === 'challenge:kanto-lance')!;
const v = lance.variants[0];
const dragonair = v.team[1]; // Hyper Beam (Normal) + Outrage (Dragon): neither is super effective on Bug/Ghost

describe('challenge rules', () => {
  it('follows the wiki: special rules in World Boss and Mega Chamber battles, no Bag medicine in towers', () => {
    expect(rulesFor('boss')).toBe(CHALLENGE_RULES);
    expect(rulesFor('mega')).toBe(CHALLENGE_RULES);
    expect(rulesFor('gym')).toBe(NORMAL_RULES); // not League battles (the old assumption)
    expect(rulesFor('elite-four')).toBe(NORMAL_RULES);
    expect(rulesFor('tower')).toBe(TOWER_RULES);
    expect(TOWER_RULES.bagItems).toBe(false);
    expect(rulesFor(undefined)).toBe(NORMAL_RULES);
  });

  it('NPC attacks ignore Wonder Guard under challenge rules', () => {
    const shed = mon('Shedinja', 60, ['shadowball'], { ability: 'Wonder Guard' });
    const me = boxToCalc(ds, shed);
    const foe = npcToCalc(ds, dragonair);
    const normal = duel(ds, me, shed.moves, foe, dragonair.moves);
    expect(normal.theirs?.maxPct ?? 0).toBe(0);
    expect(normal.win).toBe(true);
    const challenge = duel(ds, me, shed.moves, foe, dragonair.moves, undefined, CHALLENGE_RULES);
    expect(challenge.theirs!.maxPct).toBeGreaterThan(0);
    expect(challenge.win).toBe(false);
    // The calc Pokémon itself keeps its ability (only the NPC's view of it changes).
    expect(me.ability).toBe('Wonder Guard');
    // Type view too: Outrage is no longer blocked.
    expect(scorePair(ds, shed, dragonair).worstTaken.mult).toBe(0);
    expect(scorePair(ds, shed, dragonair, CHALLENGE_RULES).worstTaken.mult).toBe(1);
  });

  it('never suggests a banned move', () => {
    const lapras = mon('Lapras', 70, ['sheercold']);
    const s = suggestMoveset(ds, lapras, v, { rules: CHALLENGE_RULES });
    expect(s.moves.map((m) => m.moveId)).not.toContain('sheercold');
  });
});

describe('locks and exclusions', () => {
  const box = [mon('Lapras', 62, ['icebeam', 'surf']), mon('Pikachu', 30, ['thunderbolt']), mon('Shedinja', 30, ['shadowball'])];

  it('a locked Pokémon is always on the team, even when it scores worse', () => {
    const free = suggestTeam(ds, box, v, { size: 1 });
    expect(free.team[0].mon.uid).toBe('Lapras');
    const pinned = suggestTeam(ds, box, v, { size: 1, locked: ['Pikachu'] });
    expect(pinned.team.map((c) => c.mon.uid)).toEqual(['Pikachu']);
    expect(pinned.team[0].locked).toBe(true);
  });

  it('an excluded Pokémon is never suggested and says why', () => {
    const res = suggestTeam(ds, box, v, { excluded: ['Lapras'] });
    expect(res.team.map((c) => c.mon.uid)).not.toContain('Lapras');
    expect(res.ranked.find((c) => c.mon.uid === 'Lapras')!.reason).toBe('Excluded by you');
  });

  it('a lock does not override the level cap', () => {
    const res = suggestTeam(ds, box, v, { levelCap: 50, locked: ['Lapras'] });
    expect(res.team.map((c) => c.mon.uid)).not.toContain('Lapras');
    expect(res.ranked.find((c) => c.mon.uid === 'Lapras')!.locked).toBe(true);
  });
});

it('exports the team as Showdown-style text', () => {
  const text = teamToText(ds, [mon('Lapras', 62, ['icebeam', 'surf'], { ability: 'Water Absorb', nature: 'Modest' })], 'vs Lance');
  expect(text).toBe('// vs Lance\n\nLapras\nAbility: Water Absorb\nLevel: 62\nModest Nature\n- Ice Beam\n- Surf');
});
