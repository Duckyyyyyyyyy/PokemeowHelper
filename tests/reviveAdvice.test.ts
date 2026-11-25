import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset } from '../src/shared/types';
import { adviseTurn } from '../src/engine/turnAdvisor';

const ds = structuredClone(fixture) as unknown as Dataset;
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const snorlax: BoxMon = { uid: 'game:1', gameId: '1', source: 'game', species: 143, level: 70, moves: ['bodyslam'], nature: 'Hardy', ability: 'Thick Fat', ivs: iv(15), evs: iv(0) };
const blastoise: BoxMon = { uid: 'game:2', gameId: '2', source: 'game', species: 9, level: 70, moves: ['surf'], nature: 'Hardy', ability: 'Torrent', ivs: iv(15), evs: iv(0) };
const pikachu: BoxMon = { uid: 'game:3', gameId: '3', source: 'game', species: 25, level: 20, moves: ['thundershock'], nature: 'Hardy', ability: 'Static', ivs: iv(15), evs: iv(0) };
const box = [snorlax, blastoise, pikachu];
const down = (name: string, level: number) => ({ name, level, hp: 0, maxHp: 200, active: false, fainted: true });

// Brock's rematch: Golem is out, five more to come.
const at = (hp: number, bench: BattleSnapshot['bench'], over: Partial<BattleSnapshot> = {}): BattleSnapshot => ({
  v: 2, at: 0, status: 'active', kind: 'gym', opponentName: 'Brock', turn: 4,
  player: { name: 'Snorlax', level: 70, hp, maxHp: 329 },
  opponent: { name: 'Golem', level: 55, item: 'Sitrus Berry', hpPct: 57 },
  moves: [{ name: 'Body Slam', pp: 15, maxPp: 15, disabled: false }],
  bench: [{ name: 'Snorlax', level: 70, hp, maxHp: 329, active: true, fainted: false }, ...bench],
  opponentTeam: [{ name: 'Golem', level: 55, hpPct: 57, active: true, fainted: false }],
  boosts: { player: {}, opponent: {} }, log: [], events: [], ...over,
});
const advise = (s: BattleSnapshot, items = new Map([['revive', 2]])) => adviseTurn(ds, s, box, { items }).actions;
const revive = (s: BattleSnapshot) => advise(s).find((a) => a.label.startsWith('Revive'));

describe('Revive', () => {
  it('your last Pokémon is about to fall and a fainted one could beat their team: Revive first', () => {
    const a = advise(at(60, [down('Blastoise', 70)]));
    expect(a[0].label).toBe('Revive on Blastoise');
    expect(a[0].score!).toBeGreaterThanOrEqual(55); // was 36 with the flat 25-point cut: "Weak"
  });

  it('brings back the one that helps most, not the first in the list', () => {
    expect(revive(at(60, [down('Pikachu', 20), down('Blastoise', 70)]))!.label).toBe('Revive on Blastoise');
  });

  it('a battle you win anyway: attacking stays clearly above it', () => {
    const won = at(329, [down('Blastoise', 70)], {
      opponent: { name: 'Golem', level: 55, hpPct: 5 },
      opponentTeam: [{ name: 'Golem', level: 55, hpPct: 5, active: true, fainted: false }, ...['Relicanth', 'Omastar', 'Onix', 'Kabutops', 'Rampardos'].map((name) => ({ name, level: 55, hp: 0, active: false, fainted: true }))],
    });
    const a = advise(won);
    expect(a[0].label).toBe('Body Slam');
    expect(a.find((x) => x.label.startsWith('Revive'))!.score!).toBeLessThanOrEqual(50);
  });

  it('attack first when you can KO and stay safe: the Revive can wait a turn', () => {
    const s = at(329, [down('Blastoise', 70)], { opponent: { name: 'Golem', level: 55, hpPct: 15 }, opponentTeam: [{ name: 'Golem', level: 55, hpPct: 15, active: true, fainted: false }] });
    expect(advise(s)[0].label).toBe('Body Slam');
  });

  it('a fainted Pokémon that does nothing against them is not worth the turn', () => {
    expect(revive(at(250, [down('Pikachu', 20)]))!.score!).toBeLessThan(advise(at(250, [down('Pikachu', 20)]))[0].score!);
  });
});
