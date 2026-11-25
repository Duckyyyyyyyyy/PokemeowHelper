import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import { TATE_LIZA_LOG } from './fixtures/battle/tateLizaLog';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset, NpcMon } from '../src/shared/types';
import { parseLog } from '../src/content/battleReader';
import { boxToCalc, npcToCalc } from '../src/engine/damage';
import { Lookahead, type LookMon } from '../src/engine/lookahead';
import { adviseTurn } from '../src/engine/turnAdvisor';

// When NPCs heal is a guess from a player's report (2026-11-25): under about half HP and at risk of a KO, usually.
const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const sp = (n: string) => Object.values(ds.species).find((s) => s.name === n)!;
const box = (moves: string[]): BoxMon => ({ uid: 'game:2', gameId: '2', source: 'game', species: 9, level: 70, moves, nature: 'Hardy', ability: 'Torrent', ivs: iv(15), evs: iv(0) });
const mine = (moves: string[]): LookMon => ({ name: 'Blastoise', calc: boxToCalc(ds, box(moves)), moves });
const foe = (n: string, lv: number, pct: number): LookMon => {
  const calc = npcToCalc(ds, { species: sp(n).id, name: n, level: lv, moves: ['bodyslam'], baseStats: sp(n).baseStats } as NpcMon);
  calc.originalCurHP = Math.max(1, Math.round((calc.maxHP() * pct) / 100));
  return { name: n, calc, moves: ['bodyslam'] };
};

describe('battle log: items the NPC used', () => {
  it('both wordings seen live', () => {
    expect(parseLog([{ text: 'Lt. Surge used Super Potion on opponent’s Voltorb!', turn: 2 }], 'Lt. Surge').npcItems).toEqual(['superpotion']);
    expect(parseLog(TATE_LIZA_LOG, 'Tate & Liza').npcItems).toEqual(['hyperpotion']);
  });

  it('not a move, not your own item, and nothing without the trainer name', () => {
    const lines = ['Lt. Surge’s Voltorb used Tackle!', 'You used Super Potion on Gloom!', 'Scrafty used Crunch on Tate & Liza’s Claydol!'].map((text) => ({ text, turn: 1 }));
    expect(parseLog(lines, 'Lt. Surge').npcItems).toEqual([]);
    expect(parseLog(lines, 'Tate & Liza').npcItems).toEqual([]);
    expect(parseLog([{ text: 'Lt. Surge used Super Potion on opponent’s Voltorb!', turn: 2 }]).npcItems).toEqual([]);
  });
});

describe('the NPC may heal', () => {
  const may = (pct: number) => new Lookahead({ ds, mine: [mine(['surf'])], foes: [foe('Golem', 55, pct)] }).mayHeal();
  it('under half HP and at risk of a KO', () => {
    expect(may(30)).toBe(true);
    expect(may(45)).toBe(true);
    expect(may(60)).toBe(false);
  });
  it('no hit of yours can KO: no', () => {
    expect(new Lookahead({ ds, mine: [{ ...mine(['bite']), calc: boxToCalc(ds, { ...box(['bite']), level: 5 }) }], foes: [foe('Golem', 55, 30)] }).mayHeal()).toBe(false);
  });
});

describe('turn advice', () => {
  const snap = (hpPct: number, npcItems?: string[]): BattleSnapshot => ({
    v: 2, at: 0, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 4,
    player: { name: 'Blastoise', level: 70, hp: 200, maxHp: 218 },
    opponent: { name: 'Golem', level: 55, item: 'Sitrus Berry', hpPct },
    moves: [{ name: 'Surf', pp: 15, maxPp: 15, disabled: false }],
    bench: [{ name: 'Blastoise', level: 70, hp: 200, maxHp: 218, active: true, fainted: false }],
    opponentTeam: [{ name: 'Golem', level: 55, hpPct, active: true, fainted: false }],
    boosts: { player: {}, opponent: {} }, log: [], events: [], ...(npcItems ? { npcItems } : {}),
  });
  const note = (s: BattleSnapshot) => adviseTurn(ds, s, [box(['surf'])]).notes.find((n) => /may use/.test(n));
  it('warns, labelled as a guess, with what is left (Brock rematch: 2 Full Restores)', () => {
    expect(note(snap(30))).toMatch(/Brock may use Full Restore on Golem now \(2 healing items left\)\. A guess/);
    expect(note(snap(30, ['fullrestore']))).toMatch(/1 healing item left/);
  });
  it('only a warning: the rows do not change', () => {
    const rows = (s: BattleSnapshot) => adviseTurn(ds, s, [box(['surf'])]).actions;
    expect(rows(snap(30))).toEqual(rows(snap(30, ['fullrestore', 'fullrestore'])));
  });
  it('no warning at high HP or when the log shows both were used', () => {
    expect(note(snap(80))).toBeUndefined();
    expect(note(snap(30, ['fullrestore', 'fullrestore']))).toBeUndefined();
  });
});
