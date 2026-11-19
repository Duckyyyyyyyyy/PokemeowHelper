import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { parseLog } from '../src/content/battleReader';
import { checkDoublesEvent } from '../src/engine/damageCheck';
import { TATE_LIZA_LOG } from './fixtures/battle/tateLizaLog';

const ds = structuredClone(fixture) as unknown as Dataset;

/**
 * Real turn 2 (Tate & Liza, 2026-11-19): Slowbro (+1 SpA) used Surf; Xatu (+2 SpD) took 36.
 * Slowbro's exact IVs are not known (screen: Lv 45, 144 max HP → HP IV ~9); a mid set is used.
 * The point: 36 is inside the doubles (×0.75) range and below the singles minimum.
 */
const slowbro: BoxMon = { uid: 's', species: 80, level: 45, moves: ['calmmind', 'surf', 'slackoff', 'psychic'], source: 'game', nature: 'Hardy', ivs: { hp: 9, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 }, evs: {} };

const before: BattleSnapshot = {
  v: 2, at: 1, status: 'active', kind: 'gym', format: 'doubles', opponentName: 'Tate & Liza', turn: 2,
  player: { name: 'Slowbro', level: 45, hp: 120, maxHp: 144 }, opponent: { name: 'Claydol', level: 41, hp: 4, maxHp: 112 },
  moves: [], bench: [], opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [],
  actives: {
    player: [{ name: 'Slowbro', level: 45, hp: 120, maxHp: 144, position: 1 }, { name: 'Scrafty', level: 45, hp: 95, maxHp: 122, position: 2 }],
    opponent: [{ name: 'Claydol', level: 41, hp: 4, maxHp: 112, position: 1 }, { name: 'Xatu', level: 41, hp: 117, maxHp: 117, position: 2 }],
  },
  movesFor: 'Slowbro',
};

describe('doubles calc check (real log)', () => {
  const surf = parseLog(TATE_LIZA_LOG, 'Tate & Liza').events.find((e) => e.move === 'Surf')!;

  it('checks each Pokémon hit by a spread move, with the ×0.75 reduction', () => {
    const checks = checkDoublesEvent(ds, [slowbro], before, surf);
    const xatu = checks.find((c) => c.target === 'Xatu')!;
    expect(xatu).toMatchObject({ attacker: 'Slowbro', move: 'Surf', damage: 36, spread: true, verdict: 'ok' });
    expect(xatu.lo).toBeLessThanOrEqual(36);
    // Claydol had 4 HP left: the 4 is capped by its HP, judged as a KO.
    expect(checks.find((c) => c.target === 'Claydol')).toMatchObject({ damage: 4, capped: true, verdict: 'ok' });
    // Scrafty (your ally) is not in the box: not judged.
    expect(checks.some((c) => c.target === 'Scrafty')).toBe(false);
  });

  it('single-target hits use the named target', () => {
    const ev = parseLog(TATE_LIZA_LOG, 'Tate & Liza').events.find((e) => e.move === 'Crunch')!;
    expect(ev).toMatchObject({ target: 'Claydol', targetSide: 'opponent', damage: 86 });
    // Scrafty is not in this test box: no check, no crash.
    expect(checkDoublesEvent(ds, [slowbro], before, ev)).toEqual([]);
  });
});
