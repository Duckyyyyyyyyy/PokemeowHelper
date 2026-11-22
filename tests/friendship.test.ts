// Friendship (your side only), from the game's Battle Simulator guide (2026-11-22):
// ≥180: 10% to survive a KO hit at 1 HP (15% at ≥220, 20% at 255); 255: crit chance ×2, their moves −10 accuracy.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/wiki-mini.json';
import type { BoxMon, Dataset, NpcMon } from '../src/shared/types';
import type { BattleSnapshot } from '../src/shared/battle';
import { boxToCalc, npcToCalc } from '../src/engine/damage';
import { Lookahead, runLookahead, type LookMon } from '../src/engine/lookahead';
import { friendshipApplies, friendshipSurvival } from '../src/engine/friendship';
import { adviseTurn } from '../src/engine/turnAdvisor';
import { toBoxMons, type RawCollectionMon } from '../src/data/boxSync';

const ds = structuredClone(fixture) as unknown as Dataset;
const sp = (n: string) => Object.values(ds.species).find((s) => s.name === n)!;
const mine = (n: string, lv: number, moves: string[]): BoxMon => ({ uid: n, species: sp(n).id, level: lv, moves, source: 'game', nature: 'Hardy' });
const npc = (n: string, lv: number, moves: string[]): NpcMon => ({ species: sp(n).id, name: n, level: lv, moves, baseStats: sp(n).baseStats });
/** `hp`: HP points left (not %). */
const L = (m: BoxMon, hp: number | undefined, friendship?: number): LookMon => {
  const calc = boxToCalc(ds, m);
  if (hp !== undefined) calc.originalCurHP = hp;
  return { name: ds.species[m.species].name, calc, moves: m.moves, friendship };
};
const F = (m: NpcMon): LookMon => ({ name: m.name, calc: npcToCalc(ds, m), moves: m.moves });
const machamp = () => mine('Machamp', 56, ['brickbreak']);
const threat = (foeMoves: string[], friendship?: number, hp = 4) =>
  new Lookahead({ ds, mine: [L(machamp(), hp, friendship)], foes: [F(npc('Snorlax', 50, foeMoves))] }).threatOdds().ko;

describe('friendship: survival chance by level', () => {
  it('0 below 180, 10% at 180, 15% at 220, 20% at 255', () => {
    expect([0, 179, 180, 219, 220, 254, 255].map(friendshipSurvival)).toEqual([0, 0, 0.1, 0.1, 0.15, 0.15, 0.2]);
    expect(friendshipSurvival(undefined)).toBe(0);
  });
});

describe('friendship: lookahead KO odds on you', () => {
  it('a sure KO (Body Slam, 100 acc) becomes 90% / 85% / 72% at 180 / 220 / 255 (survival, and −10 accuracy at 255)', () => {
    expect(threat(['bodyslam'])).toBeCloseTo(1, 5);
    expect(threat(['bodyslam'], 0)).toBeCloseTo(1, 5);
    expect(threat(['bodyslam'], 180)).toBeCloseTo(0.9, 5);
    expect(threat(['bodyslam'], 220)).toBeCloseTo(0.85, 5);
    expect(threat(['bodyslam'], 255)).toBeCloseTo(0.8 * 0.9, 5);
  });

  it('moves that never miss (Swift) keep their accuracy at 255: only the survival applies', () => {
    expect(threat(['swift'], 255)).toBeCloseTo(0.8, 5);
  });

  it('no survival roll when already at 1 HP (guess)', () => {
    expect(threat(['swift'], 255, 1)).toBeCloseTo(1, 5);
  });

  it('the search plays out the survival branch: your attack scores higher, with only a few more nodes', () => {
    const go = (f?: number) => runLookahead({ ds, depth: 2, mine: [L(machamp(), 4, f)], foes: [F(npc('Snorlax', 50, ['swift']))] });
    const base = go();
    const friend = go(220);
    expect(friend.values[0].score).toBeGreaterThan(base.values[0].score);
    expect(friend.engine.nodes).toBeLessThan(base.engine.nodes * 3 + 20);
  });
});

describe('friendship 255: their status moves lose 10 accuracy too', () => {
  it('Thunder Wave (90) lands 90% → 80% (subtractive points, a guess)', () => {
    const land = (f?: number) => {
      const e = new Lookahead({ ds, mine: [L(machamp(), undefined, f)], foes: [F(npc('Snorlax', 50, ['thunderwave']))] });
      const kids = (e as unknown as { act(s: unknown, side: 0 | 1, id: string, first: boolean): { p: number; s: { st: string[] } }[] }).act(e.root, 1, 'thunderwave', true);
      return kids.filter((k) => k.s.st[0] === 'par').reduce((x, k) => x + k.p, 0);
    };
    expect(land()).toBeCloseTo(0.9, 5);
    expect(land(254)).toBeCloseTo(0.9, 5);
    expect(land(255)).toBeCloseTo(0.8, 5);
  });
});

describe('friendship 255: your crit chance doubles', () => {
  it('1/24 → 1/12 on your hit, unchanged below 255 and for their hits', () => {
    const crit = (f?: number) => new Lookahead({ ds, mine: [L(machamp(), undefined, f)], foes: [F(npc('Snorlax', 50, ['bodyslam']))] }).hitOdds(0, 'brickbreak')!.crit;
    expect(crit()).toBeCloseTo(1 / 24, 5);
    expect(crit(254)).toBeCloseTo(1 / 24, 5);
    expect(crit(255)).toBeCloseTo(1 / 12, 5);
    const theirs = new Lookahead({ ds, mine: [L(machamp(), undefined, 255)], foes: [F(npc('Snorlax', 50, ['bodyslam']))] }).hitOdds(1, 'bodyslam')!.crit;
    expect(theirs).toBeCloseTo(1 / 24, 5);
  });
});

describe('friendship: which battles have it', () => {
  it.each([
    ['gym', undefined, false, true],
    ['elite-four', undefined, false, true],
    ['league', undefined, false, true],
    ['tower', undefined, false, true],
    ['mega', undefined, false, true],
    ['wild', undefined, false, true],
    [undefined, 'gym', false, true],
    ['world-boss', undefined, false, false],
    ['gym', 'boss', false, false],
    ['player', undefined, false, false],
    ['pvp', undefined, false, false],
    ['frontier', undefined, false, false],
    ['gym', undefined, true, false],
    [undefined, undefined, false, false],
    ['something-new', undefined, false, false],
  ] as const)('kind %s, NPC %s, Gen III %s → %s', (kind, category, gen3, want) => {
    expect(friendshipApplies(kind, category, gen3)).toBe(want);
  });
});

describe('friendship: box sync', () => {
  const raw = (id: string, extra: Partial<RawCollectionMon>): RawCollectionMon => ({ id, species: 1, level: 20, moves: [], ...extra });
  it('keeps the friendship number (0–255) from /api/collection; missing or odd values stay undefined', () => {
    const [a, b, c, d] = toBoxMons(ds, [raw('a', { friendship: 220 }), raw('b', {}), raw('c', { friendship: 'x' as unknown as number }), raw('d', { friendship: 300 })]);
    expect(a.friendship).toBe(220);
    expect(b.friendship).toBeUndefined();
    expect(c.friendship).toBeUndefined();
    expect(d.friendship).toBe(255);
  });
});

describe('friendship in the Battle tab advice', () => {
  const box = (friendship?: number, source: BoxMon['source'] = 'game'): BoxMon[] => [{ ...machamp(), source, friendship }];
  const snap = (kind: string): BattleSnapshot => ({
    v: 2, at: 1, status: 'active', kind, turn: 1, opponentName: 'Nobody',
    player: { name: 'Machamp', level: 56, hp: 4, maxHp: 200 }, opponent: { name: 'Snorlax', level: 50 },
    moves: [{ name: 'Brick Break', pp: 15, maxPp: 15, disabled: false }],
    bench: [], opponentTeam: [], boosts: { player: {}, opponent: {} }, log: [], events: [],
  });

  it('notes the effect and marks the threat with the survival chance', () => {
    const a = adviseTurn(ds, snap('gym'), box(220));
    expect(a.notes.some((n) => /^Friendship 220: 15% to survive a KO hit at 1 HP/.test(n))).toBe(true);
    expect(a.threat?.survive).toBeCloseTo(0.15, 5);
    expect(a.threat?.koChance).toBeLessThan(0.9);
  });

  it('forced switch: the "Send in" row gets the survival chance of the Pokémon coming in', () => {
    const base = snap('gym');
    const s = { ...base, player: { ...base.player!, hp: 0 }, bench: [{ name: 'Snorlax', level: 50, hp: 30, maxHp: 200, active: false, fainted: false }] };
    const b = [...box(), { ...mine('Snorlax', 50, ['bodyslam']), uid: 'snor', friendship: 255 }];
    const row = adviseTurn(ds, s, b).actions.find((a) => a.kind === 'switch')!;
    expect(row.threat?.survive).toBeCloseTo(0.2, 5);
  });

  it('nothing in a Player Battle or a World Boss battle', () => {
    for (const kind of ['player', 'world-boss']) {
      const a = adviseTurn(ds, snap(kind), box(255));
      expect(a.notes.some((n) => /Friendship/.test(n))).toBe(false);
      expect(a.threat?.survive).toBeUndefined();
    }
  });

  it('asks for a box sync only for a synced Pokémon without friendship', () => {
    const hint = (b: BoxMon[]) => adviseTurn(ds, snap('gym'), b, { lookahead: 0 }).notes.filter((n) => /Sync your box to use Friendship effects/.test(n)).length;
    expect(hint(box(undefined))).toBe(1);
    expect(hint(box(100))).toBe(0);
    expect(hint(box(undefined, 'manual'))).toBe(0);
  });
});
