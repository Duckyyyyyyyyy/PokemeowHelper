import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BattleSnapshot } from '../src/shared/battle';
import type { BoxMon, Dataset } from '../src/shared/types';
import { parseLog } from '../src/content/battleReader';
import { adviseTurn } from '../src/engine/turnAdvisor';
import { Lookahead } from '../src/engine/lookahead';
import { boxToCalc, makeField } from '../src/engine/damage';

const ds = structuredClone(fixture) as unknown as Dataset;
// Species the trimmed fixture lacks (base stats = mainline).
const add = (id: number, name: string, types: string[], b: number[]) => {
  ds.species[id] = { id, name, types, baseStats: { hp: b[0], atk: b[1], def: b[2], spa: b[3], spd: b[4], spe: b[5] }, abilities: [], levelMoves: [], machineMoves: [], eggMoves: [] };
};
add(289, 'Slaking', ['Normal'], [150, 160, 100, 95, 65, 100]);
const iv = (n: number) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const slaking = (ability = 'Truant'): BoxMon => ({ uid: 'game:1', gameId: '1', source: 'game', species: 289, level: 74, moves: ['throatchop', 'slash'], nature: 'Hardy', ability, ivs: iv(15), evs: iv(0) });
const snorlax: BoxMon = { uid: 'game:2', gameId: '2', source: 'game', species: 143, level: 70, moves: ['bodyslam', 'crunch'], nature: 'Hardy', ability: 'Thick Fat', ivs: iv(15), evs: iv(0) };

// Real log of a Brock rematch (2026-11-25): Slaking moved on turns 1 and 3 and loafed on turn 2.
const LOG = [
  ['Go, Slaking!'], ['Brock sent out Golem!'],
  ['Slaking used Mega Kick!', 1], ["Slaking's attack missed.", 1], ['Brock’s Golem used Earthquake! It dealt 82 damage.', 1],
  ['Truant: Slaking is loafing around!', 2], ['Brock’s Golem used Earthquake! It dealt 78 damage.', 2],
  ["Slaking used Mega Kick! It's not very effective. It dealt 88 damage.", 3], ['Brock’s Golem used Earthquake! It dealt 82 damage.', 3],
].map(([text, turn]) => ({ text: text as string, turn: turn as number | undefined }));

const at = (turn: number, over: Partial<BattleSnapshot> = {}): BattleSnapshot => {
  const { boosts, events } = parseLog(LOG.filter((l) => (l.turn ?? 0) < turn), 'Brock');
  return {
    v: 2, at: 0, status: 'active', kind: 'gym', opponentName: 'Brock', turn,
    player: { name: 'Slaking', level: 74, hp: 245, maxHp: 321 },
    opponent: { name: 'Golem', level: 55, item: 'Sitrus Berry', hpPct: 57 },
    moves: ['Throat Chop', 'Slash'].map((name) => ({ name, pp: 10, maxPp: 10, disabled: false })),
    bench: [
      { name: 'Slaking', level: 74, hp: 245, maxHp: 321, active: true, fainted: false },
      { name: 'Snorlax', level: 70, hp: 329, maxHp: 329, active: false, fainted: false },
    ],
    opponentTeam: [{ name: 'Golem', level: 55, hpPct: 57, active: true, fainted: false }],
    boosts, log: [], events, ...over,
  };
};
const chop = (s: BattleSnapshot, b = slaking()) => adviseTurn(ds, s, [b, snorlax]).actions.find((a) => a.label === 'Throat Chop')!;

describe('Truant', () => {
  it('turn after it moved: the moves are marked as loafing, with no KO facts', () => {
    const a = chop(at(4));
    expect(a.reason).toMatch(/loafs around this turn \(Truant\)/);
    expect(a.facts).toBeUndefined();
    expect(a.koChance ?? 0).toBe(0);
  });

  it('turn after it loafed, and the first turn: it can move', () => {
    for (const t of [1, 3]) {
      expect(chop(at(t)).reason).not.toMatch(/loafs/);
      expect(chop(at(t)).facts).toBeDefined();
    }
  });

  it('switched out and back in: it can move at once', () => {
    expect(chop(at(6)).reason).not.toMatch(/loafs/);
  });

  it('without Truant nothing changes', () => {
    expect(chop(at(4), slaking('Vital Spirit')).reason).not.toMatch(/loafs/);
  });

  it('a Truant attacker is worth less in the lookahead than the same one without it', () => {
    for (const t of [3, 4]) expect(chop(at(t)).score!).toBeLessThan(chop(at(t), slaking('Vital Spirit')).score!);
  });

  it('switching out of a loaf turn gains on staying in, compared with a turn it can move', () => {
    const gap = (t: number) => {
      const a = adviseTurn(ds, at(t), [slaking(), snorlax]).actions;
      return a.find((x) => x.kind === 'switch')!.score! - Math.max(...a.filter((x) => x.kind === 'move').map((x) => x.score!));
    };
    expect(gap(4)).toBeGreaterThan(gap(3));
  });

  it('the engine alternates: a loaf turn deals nothing, the next one hits', () => {
    const mk = (loaf: boolean) => new Lookahead({
      ds, field: makeField('singles'),
      mine: [{ name: 'Slaking', calc: boxToCalc(ds, slaking()), moves: ['slash'] }],
      foes: [{ name: 'Snorlax', calc: boxToCalc(ds, snorlax), moves: ['crunch'] }],
      loafing: { me: loaf },
    });
    expect(mk(true).hitOdds(0, 'slash')!.ko).toBe(0);
    const act = mk(false).run(1)[0].score;
    const loaf = mk(true).run(1)[0].score;
    expect(act).toBeGreaterThan(loaf);
    // Two turns contain exactly one hit either way, so the line names the loaf in both.
    expect(mk(true).line({ kind: 'move', moveId: 'slash' }, 2)).toMatch(/^Slaking loafs → Slash/);
    expect(mk(false).line({ kind: 'move', moveId: 'slash' }, 2)).toMatch(/^Slash → Slaking loafs/);
  });
});
