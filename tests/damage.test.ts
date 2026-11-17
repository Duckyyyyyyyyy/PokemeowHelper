import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import { boxToCalc, duel, makeField, moveDamage, npcToCalc } from '../src/engine/damage';
import { scoreAgainstTeam, scorePair, suggestTeam } from '../src/engine/teamSuggest';
import { suggestMoveset } from '../src/engine/moveset';

const ds = structuredClone(fixture) as unknown as Dataset;
const npc = (id: string) => ds.npcs.find((n) => n.id === id)!;
const sp = (name: string) => Object.values(ds.species).find((s) => s.name === name)!.id;
const mon = (name: string, level: number, moves: string[] = [], extra: Partial<BoxMon> = {}): BoxMon => ({
  uid: name, species: sp(name), level, moves, source: 'game',
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Hardy', ...extra,
});

describe('stats match the game', () => {
  it('reproduces the in-game stats of a real synced Pokémon (Timburr Lv16 Modest)', () => {
    // Values read from the game on 2026-11-18: box API (IVs/EVs/nature) and the Pokémon's stat panel.
    ds.species[534] = { id: 534, name: 'Timburr', types: ['Fighting'], baseStats: { hp: 75, atk: 80, def: 55, spa: 25, spd: 35, spe: 35 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
    const p = boxToCalc(ds, { uid: 't', species: 534, level: 16, moves: [], source: 'game', nature: 'Modest',
      ivs: { hp: 7, atk: 22, def: 9, spa: 19, spd: 28, spe: 26 }, evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } });
    expect(p.stats).toEqual({ hp: 51, atk: 30, def: 24, spa: 17, spd: 20, spe: 20 });
  });
  it('uses the game base stats even when the calc dex differs', () => {
    const copy = structuredClone(ds);
    copy.species[sp('Pikachu')].baseStats = { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 };
    const p = boxToCalc(copy, mon('Pikachu', 50));
    expect(p.stats.spe).toBeGreaterThan(boxToCalc(ds, mon('Pikachu', 50)).stats.spe);
  });
});

describe('damage and duels', () => {
  const lance = npc('challenge:kanto-lance').variants[0];
  const dragonite = lance.team.find((m) => m.name === 'Dragonite')!;

  it('Ice Beam from a strong Lapras OHKOs Lance’s Dragonite', () => {
    const d = moveDamage(ds, boxToCalc(ds, mon('Lapras', 62, [], { nature: 'Modest', evs: { spa: 252 } })), npcToCalc(ds, dragonite), 'icebeam');
    expect(d!.minPct).toBeGreaterThan(100);
    expect(d!.hitsToKO).toBe(1);
  });

  it('a low-level type counter loses the duel (level matters now)', () => {
    const blaine = npc('challenge:blaine').variants[0];
    const strongest = [...blaine.team].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
    const geodude = mon('Geodude', 15, ['rockthrow']);
    const typeOnly = scorePair(ds, geodude, strongest).score;
    const res = duel(ds, boxToCalc(ds, geodude), ['rockthrow'], npcToCalc(ds, strongest), strongest.moves, makeField('singles'));
    expect(res.win).toBe(false);
    expect(res.score).toBeLessThan(typeOnly);
  });

  it('team suggestion in damage mode prefers the higher-level counter', () => {
    const blaine = npc('challenge:blaine').variants[0];
    const box = [mon('Geodude', 15, ['rockthrow']), mon('Golduck', 52, ['surf', 'psychic'])];
    const res = suggestTeam(ds, box, blaine, { levelCap: 52 });
    expect(res.ranked[0].mon.uid).toBe('Golduck');
    expect(res.ranked[0].pairs[0].duel).toBeDefined();
    for (const c of res.ranked) for (const p of c.pairs) expect(p.score).toBeGreaterThanOrEqual(0);
  });

  it('every NPC set in the fixture can be built and calculated', () => {
    const probe = mon('Mewtwo', 70, ['psychic', 'icebeam']);
    for (const n of ds.npcs) for (const v of n.variants) {
      const pairs = scoreAgainstTeam(ds, probe, v);
      expect(pairs).toHaveLength(v.team.length);
      pairs.forEach((p) => expect(Number.isFinite(p.score)).toBe(true));
    }
  });
});

describe('moveset suggestion', () => {
  it('suggests at most 4 damaging moves and never does worse than the current set', () => {
    const lance = npc('challenge:kanto-lance').variants[0];
    const b = mon('Lapras', 62, ['bodyslam', 'growl']);
    const s = suggestMoveset(ds, b, lance);
    expect(s.moves.length).toBeGreaterThan(0);
    expect(s.moves.length).toBeLessThanOrEqual(4);
    expect(s.coverage).toBeGreaterThanOrEqual(s.currentCoverage);
    expect(s.moves.map((m) => m.type)).toContain('Ice');
    for (const m of s.moves) expect(ds.moves[m.moveId].category).not.toBe('Status');
  });
  it('only uses level-up moves at or below the Pokémon’s level', () => {
    const brock = npc('challenge:brock').variants[0];
    const s = suggestMoveset(ds, mon('Bulbasaur', 10), brock, { allowTM: false });
    for (const m of s.moves) if (m.source === 'level') expect(m.level!).toBeLessThanOrEqual(10);
    expect(s.moves.every((m) => m.source !== 'tm')).toBe(true);
  });
});
