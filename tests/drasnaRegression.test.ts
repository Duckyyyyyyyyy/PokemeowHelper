// Regression for 0.11.0: vs E4 Drasna's Dragalge every damaging move read 0 "No effect on this target".
// Suspected cause (mechanism reproduced, the live nature string not seen): a nature string
// @smogon/calc does not know. The stats still compute, but the calc throws on every normal hit while
// writing its description (`nature.plus`); immunities and fixed-damage moves (Night Shade) return
// before that. moveDamage swallowed the throw as "no damage". The real wiki set is not in the repo
// fixture: the set below is modelled on the screenshot.
import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, Npc, NpcMon } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { Generations, Pokemon } from '@smogon/calc';
import { boxToCalc, calcErrorCount, makeField, moveDamage, npcToCalc, takeCalcErrors, tryMoveDamage, validNature } from '../src/engine/damage';
import { adviseTurn } from '../src/engine/turnAdvisor';
import { FRONTIER_RULES, battleRulesFor, rulesFor } from '../src/engine/rules';
import { suggestTeam } from '../src/engine/teamSuggest';
import { defeatPlan } from '../src/engine/wildDefeat';

const ds = structuredClone(fixture) as unknown as Dataset;
const add = (id: number, name: string, types: string[], b: number[]) => {
  ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
};
add(376, 'Metagross', ['Steel', 'Psychic'], [80, 135, 130, 95, 90, 70]);
add(691, 'Dragalge', ['Poison', 'Dragon'], [65, 75, 90, 97, 123, 44]);
add(608, 'Lampent', ['Ghost', 'Fire'], [60, 40, 60, 95, 60, 55]);

const perfect = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
/** A Dragalge set modelled on the screenshot (Lv 63, 168 HP), with a nature string the calc does not know. */
const dragalge = (nature = 'Random'): NpcMon => ({
  species: 691, name: 'Dragalge', level: 63, gender: 'F', moves: ['sludgebomb', 'dragonpulse', 'surf', 'toxic'],
  ability: 'Poison Point', nature, item: null, baseStats: ds.species[691].baseStats, ivs: perfect, evs: zero,
});
const lorelei = ds.npcs.find((n) => n.id === 'challenge:kanto-lorelei')!;
const drasna = (nature?: string): Npc => ({
  ...structuredClone(lorelei), id: 'challenge:kalos-drasna', name: 'Drasna', group: 'Kalos', levelCap: 70,
  variants: [{ ...structuredClone(lorelei.variants[0]), levelCap: 70, team: [dragalge(nature)] }],
});
const metagross: BoxMon = { uid: 'meta', gameId: '1', source: 'game', species: 376, level: 69, moves: ['shadowclaw', 'zenheadbutt', 'meteormash'], nature: 'Adamant', item: 'twistedspoon', ivs: perfect, evs: zero };
const lampent: BoxMon = { uid: 'lamp', gameId: '2', source: 'game', species: 608, level: 64, moves: ['nightshade', 'flamethrower'], nature: 'Modest', ivs: perfect, evs: zero };

const withDrasna = (nature?: string) => ({ ...ds, npcs: [...ds.npcs, drasna(nature)] }) as Dataset;
const snap: BattleSnapshot = {
  v: 2, at: 1, status: 'active', kind: 'elite-four', opponentName: 'Drasna', turn: 2,
  player: { name: 'Metagross', level: 69, hp: 213, maxHp: 213, item: 'Twisted Spoon' },
  opponent: { name: 'Dragalge', level: 63, hp: 168, maxHp: 168 },
  moves: [{ name: 'Shadow Claw', pp: 15, maxPp: 15, disabled: false }, { name: 'Zen Headbutt', pp: 15, maxPp: 15, disabled: false }, { name: 'Meteor Mash', pp: 10, maxPp: 10, disabled: false }],
  bench: [
    { name: 'Metagross', level: 69, hp: 213, maxHp: 213, active: true, fainted: false },
    { name: 'Lampent', level: 64, hp: 150, maxHp: 150, active: false, fainted: false },
  ],
  opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], events: [],
};

describe('Drasna regression: Metagross vs Dragalge (unknown nature in the wiki set)', () => {
  it('the calc library throws on a normal hit with that nature, but not on Night Shade (the 0.11.0 symptom)', () => {
    const g = Generations.get(9);
    const foe = new Pokemon(g, 'Dragalge', { level: 63, nature: 'Random' as never });
    const me = boxToCalc(ds, metagross);
    expect(tryMoveDamage(ds, me, foe, 'zenheadbutt', makeField('singles')).error).toMatch(/plus/);
    expect(moveDamage(ds, boxToCalc(ds, lampent), foe, 'nightshade', makeField('singles'))!.maxPct).toBeGreaterThan(0);
    takeCalcErrors();
  });

  it('npcToCalc drops an unknown nature (neutral), so damage computes', () => {
    expect(validNature('Random')).toBeUndefined();
    expect(validNature('modest')).toBe('Modest');
    const foe = npcToCalc(ds, dragalge());
    const me = boxToCalc(ds, metagross);
    const zen = moveDamage(ds, me, foe, 'zenheadbutt', makeField('singles'))!;
    const mash = moveDamage(ds, me, foe, 'meteormash', makeField('singles'))!;
    const claw = moveDamage(ds, me, foe, 'shadowclaw', makeField('singles'))!;
    expect(zen.maxPct).toBeGreaterThan(mash.maxPct); // super effective vs neutral
    expect(mash.maxPct).toBeGreaterThan(0);
    expect(claw.maxPct).toBeGreaterThan(0);
  });

  for (const nature of ['Random', 'Modest']) {
    it(`Battle tab advice scores every attack (nature "${nature}")`, () => {
      const a = adviseTurn(withDrasna(nature), snap, [metagross, lampent]);
      expect(a.npc?.name).toBe('Drasna');
      for (const id of ['shadowclaw', 'zenheadbutt', 'meteormash']) {
        const row = a.actions.find((x) => x.moveId === id)!;
        expect(row.reason, id).not.toMatch(/No effect/);
        expect(row.score, id).toBeGreaterThan(0);
        expect(row.calcError).toBeUndefined();
      }
      // Their best hit is a real one (Steel is immune to Sludge Bomb, not to Surf/Dragon Pulse).
      expect(a.threat?.name).not.toBe('Sludge Bomb');
      expect(a.threat!.maxPct).toBeGreaterThan(0);
      const sw = a.actions.find((x) => x.kind === 'switch' && /Lampent/.test(x.label))!;
      expect(sw.reason).not.toMatch(/Takes ~0%/);
      expect(a.calcErrors).toBeUndefined();
      expect(a.notes.some((n) => /Calc error/.test(n))).toBe(false);
    });
  }

  it('Team tab: the suggestion beats Drasna instead of scoring every 1v1 as a loss', () => {
    const res = suggestTeam(withDrasna(), [metagross, lampent], drasna().variants[0]);
    const meta = res.ranked.find((c) => c.mon.uid === 'meta')!;
    expect(meta.pairs[0].duel?.mine?.maxPct ?? 0).toBeGreaterThan(0);
    expect(meta.avg).toBeGreaterThan(0);
  });

  it('Explore Defeat: a box Pokémon with an unknown nature still gets damage', () => {
    const box: BoxMon[] = [{ ...metagross, nature: 'Random' }];
    const plan = defeatPlan(ds, box, { v: 1, at: 1, view: 'intro', name: 'Geodude', level: 12, shiny: false, balls: [], lead: { name: 'Metagross', level: 69, hp: 213, maxHp: 213 } });
    const moves = plan.options[0]?.moves ?? [];
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => (m.score ?? 0) > 0)).toBe(true);
  });
});

describe('only Frontier NPCs get the Gen III ruleset', () => {
  it('rulesFor / battleRulesFor: every non-Frontier NPC stays Gen 9, even with the Gen III switch left on', () => {
    for (const npc of withDrasna().npcs) {
      for (const kind of [undefined, 'gym', 'elite-four', 'frontier', 'tower']) {
        const r = battleRulesFor(npc.category, kind, true);
        expect(r.gen === 3, `${npc.id} (${npc.category}) kind=${kind}`).toBe(npc.category === 'frontier');
      }
      expect(rulesFor(npc.category).gen === 3).toBe(npc.category === 'frontier');
    }
    expect(battleRulesFor('elite-four', 'elite-four', true)).not.toBe(FRONTIER_RULES);
  });

  it('a matched E4 battle with the switch on scores Gen 9 moves (Shadow Claw, Zen Headbutt exist)', () => {
    const a = adviseTurn(withDrasna(), snap, [metagross], { gen3: true });
    expect(a.notes.some((n) => /Gen III/.test(n))).toBe(false);
    expect(a.actions.find((x) => x.moveId === 'shadowclaw')!.score).toBeGreaterThan(0);
  });
});

describe('calc errors are visible, never "No effect"', () => {
  it('tryMoveDamage and the error log report a throw (and warn once in the console)', () => {
    takeCalcErrors();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = Generations.get(9);
    const foe = new Pokemon(g, 'Dragalge', { level: 63, nature: 'Bogus' as never });
    const before = calcErrorCount();
    const r = tryMoveDamage(ds, boxToCalc(ds, metagross), foe, 'meteormash', makeField('singles'));
    tryMoveDamage(ds, boxToCalc(ds, metagross), foe, 'meteormash', makeField('singles'));
    expect(r.d).toBeNull();
    expect(r.error).toBeTruthy();
    expect(calcErrorCount()).toBe(before + 2);
    expect(warn).toHaveBeenCalledTimes(1); // same failure logged once
    expect(takeCalcErrors()).toHaveLength(2);
    warn.mockRestore();
  });
});
