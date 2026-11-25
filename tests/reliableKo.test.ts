import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset } from '../src/shared/types';
import { adviseTurn } from '../src/engine/turnAdvisor';

const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const snorlax: BoxMon = { uid: 'game:1', gameId: '1', source: 'game', species: 143, level: 70, moves: ['bodyslam'], nature: 'Hardy', ability: 'Thick Fat', ivs: iv(15), evs: iv(0) };
const blastoise = (moves: string[]): BoxMon => ({ uid: 'game:2', gameId: '2', source: 'game', species: 9, level: 66, moves, nature: 'Hardy', ability: 'Torrent', item: 'mysticwater', ivs: iv(15), evs: iv(0) });

const snap: BattleSnapshot = {
  v: 2, at: 0, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 4,
  player: { name: 'Snorlax', level: 70, hp: 60, maxHp: 329 },
  opponent: { name: 'Golem', level: 55, item: 'Sitrus Berry', hpPct: 57 },
  moves: [{ name: 'Body Slam', pp: 15, maxPp: 15, disabled: false }],
  bench: [
    { name: 'Snorlax', level: 70, hp: 60, maxHp: 329, active: true, fainted: false },
    { name: 'Blastoise', level: 66, hp: 198, maxHp: 198, active: false, fainted: false },
  ],
  opponentTeam: [{ name: 'Golem', level: 55, hpPct: 57, active: true, fainted: false }],
  boosts: { player: {}, opponent: {} }, log: [], events: [],
};
const sw = (moves: string[], s = snap) => adviseTurn(ds, s, [snorlax, blastoise(moves)]).actions.find((a) => a.kind === 'switch')!;

describe('a sure KO beats a stronger move that can miss', () => {
  it('both KO: the switch is rated with the 100% accurate move', () => {
    expect(sw(['waterpulse', 'hydropump']).score!).toBeGreaterThan(sw(['hydropump']).score!);
    expect(sw(['waterpulse', 'hydropump']).score!).toBeGreaterThanOrEqual(sw(['waterpulse']).score!);
  });

  it('the reason and the plan name that move', () => {
    const a = sw(['waterpulse', 'hydropump']);
    expect(a.reason).toMatch(/then Water Pulse/);
    expect(a.line).toMatch(/Water Pulse KOs Golem/);
  });

  it('only the strong move KOs: it is still the pick', () => {
    expect(sw(['bite', 'hydropump']).reason).toMatch(/then Hydro Pump/);
  });

  it('the reason and the plan name the same move, also when the sure KO has recoil', () => {
    const a = sw(['hydropump', 'wavecrash']);
    expect(a.line).toContain(a.reason.match(/then (.+?) [0-9]/)![1]);
  });

  it('Wave Crash (100%, recoil) is never rated below Hydro Pump alone', () => {
    // The value that orders the rows. The number shown may dip 2-3 points: recoil counts in the exchange with Golem.
    expect(sw(['hydropump', 'wavecrash']).rank!).toBeGreaterThanOrEqual(sw(['hydropump']).rank!);
  });
});
