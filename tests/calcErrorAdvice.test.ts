// A damage calc that throws must show as "calc error" (row flag + note), never as "No effect".
import { describe, expect, it, vi } from 'vitest';

vi.mock('@smogon/calc', async (importOriginal) => {
  const real = await importOriginal<typeof import('@smogon/calc')>();
  return {
    ...real,
    calculate: (...args: Parameters<typeof real.calculate>) => {
      if (args[3].name === 'Zen Headbutt' || args[3].name === 'Hydro Pump') throw new TypeError('boom (test)');
      return real.calculate(...args);
    },
  };
});

import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { adviseTurn } from '../src/engine/turnAdvisor';

const ds = structuredClone(fixture) as unknown as Dataset;
ds.species[376] = { id: 376, name: 'Metagross', types: ['Steel', 'Psychic'], baseStats: { hp: 80, atk: 135, def: 130, spa: 95, spd: 90, spe: 70 }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
const box: BoxMon[] = [{ uid: 'm', source: 'game', species: 376, level: 69, moves: ['zenheadbutt', 'meteormash'], nature: 'Adamant' }];
const snap: BattleSnapshot = {
  v: 2, at: 1, status: 'active', kind: 'wild', turn: 1,
  player: { name: 'Metagross', level: 69, hp: 213, maxHp: 213 }, opponent: { name: 'Lapras', level: 60 },
  moves: [{ name: 'Zen Headbutt', pp: 15, maxPp: 15, disabled: false }, { name: 'Meteor Mash', pp: 10, maxPp: 10, disabled: false }],
  bench: [], opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], events: [],
};

describe('calc errors in the Battle tab advice', () => {
  it('flags the failing move row as a calc error (not scored, not "No effect") and adds a note', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = adviseTurn(ds, snap, box, { lookahead: 0 });
    const zen = a.actions.find((x) => x.moveId === 'zenheadbutt')!;
    expect(zen.calcError).toBe(true);
    expect(zen.score).toBeNull();
    expect(zen.reason).toMatch(/Calc error: boom/);
    expect(zen.reason).not.toMatch(/No effect/);
    // Arena HUD tiles: the failed row keeps its game slot and has no damage facts to misread.
    expect(zen.slot).toBe(snap.moves.findIndex((m) => m.name === zen.label));
    expect(zen.facts).toBeUndefined();
    expect(a.actions.find((x) => x.moveId === 'meteormash')!.score).toBeGreaterThan(0);
    expect(a.calcErrors?.length).toBeGreaterThan(0);
    expect(a.notes[0]).toMatch(/^Calc error: the damage calc failed/);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('marks their best hit when one of their moves failed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = adviseTurn(ds, snap, box, { lookahead: 0 });
    // The guessed Lapras set has Hydro Pump (mocked to throw): its best hit is shown, flagged as uncertain.
    expect(a.calcErrors?.some((e) => e.moveId === 'hydropump')).toBe(true);
    expect(a.threat?.name).not.toBe('Hydro Pump');
    expect(a.threat?.calcError).toBe(true);
    warn.mockRestore();
  });
});
